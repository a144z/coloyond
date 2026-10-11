import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Commitment,
} from "@solana/web3.js";
import { ETF_DEVNET_GENESIS_HASH } from "./devnet-read.js";
import {
  reconcileRpcTransactionReceipt,
  type ReceiptState,
  type RpcTransactionReceipt,
  type TrackedTokenAccount,
} from "./receipt.js";

export type WalletSignableTransaction = Transaction | VersionedTransaction;

export type WalletTransactionSigner = {
  publicKey: PublicKey | null;
  signTransaction(transaction: WalletSignableTransaction): Promise<WalletSignableTransaction>;
};

export type WalletAttemptRecord = {
  signature: string;
  state: ReceiptState;
  trackedTokenAccounts: TrackedTokenAccount[];
  receipt: RpcTransactionReceipt | null;
};

export type WalletOperationRecord = {
  operationId: string;
  attempts: WalletAttemptRecord[];
};

/** Implement with durable storage and atomic compare-and-swap semantics. */
export interface WalletSubmissionJournal {
  read(operationId: string): Promise<WalletOperationRecord | null>;
  appendIfLatest(
    operationId: string,
    expectedLatestSignature: string | null,
    attempt: WalletAttemptRecord,
  ): Promise<boolean>;
  replaceLatest(
    operationId: string,
    expectedSignature: string,
    attempt: WalletAttemptRecord,
  ): Promise<boolean>;
}

export type WalletSubmissionErrorCode =
  | "wallet_submit_invalid_operation_id"
  | "wallet_submit_genesis_rpc_unavailable"
  | "wallet_submit_wrong_genesis"
  | "wallet_submit_wallet_unavailable"
  | "wallet_submit_fee_payer_mismatch"
  | "wallet_submit_transaction_invalid"
  | "wallet_submit_tracked_accounts_invalid"
  | "wallet_submit_journal_unavailable"
  | "wallet_submit_operation_already_attempted"
  | "wallet_submit_retry_not_authorized"
  | "wallet_submit_signing_failed"
  | "wallet_submit_signed_message_changed"
  | "wallet_submit_signature_missing"
  | "wallet_submit_signature_reused"
  | "wallet_submit_journal_write_failed";

export class WalletSubmissionError extends Error {
  constructor(readonly code: WalletSubmissionErrorCode) {
    super(code);
    this.name = "WalletSubmissionError";
  }
}

export type WalletSubmissionResult = {
  operationId: string;
  signature: string;
  state: ReceiptState;
  receipt: RpcTransactionReceipt | null;
  retryAllowed: boolean;
  automaticResendAllowed: false;
  reason: WalletSubmissionErrorCode | "submission_outcome_unresolved" | null;
};

function fail(code: WalletSubmissionErrorCode): never {
  throw new WalletSubmissionError(code);
}

function transactionMessage(transaction: WalletSignableTransaction): Uint8Array {
  return transaction instanceof VersionedTransaction
    ? transaction.message.serialize()
    : transaction.serializeMessage();
}

function feePayer(transaction: WalletSignableTransaction): PublicKey | null {
  return transaction instanceof VersionedTransaction
    ? transaction.message.staticAccountKeys[0] ?? null
    : transaction.feePayer ?? null;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = BASE58_ALPHABET[remainder]! + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

function signedBytesAndSignature(transaction: WalletSignableTransaction): { bytes: Uint8Array; signature: string } {
  if (transaction instanceof VersionedTransaction) {
    const signature = transaction.signatures[0];
    if (signature === undefined || signature.length !== 64 || signature.every((byte) => byte === 0)) {
      fail("wallet_submit_signature_missing");
    }
    if (transaction.signatures.some((item) => item.length !== 64 || item.every((byte) => byte === 0))) {
      fail("wallet_submit_signature_missing");
    }
    return { bytes: transaction.serialize(), signature: encodeBase58(signature) };
  }

  try {
    const bytes = transaction.serialize();
    const signature = transaction.signatures.find((item) => item.publicKey.equals(transaction.feePayer!))?.signature;
    if (signature === null || signature === undefined || signature.length !== 64 || signature.every((byte) => byte === 0)) {
      fail("wallet_submit_signature_missing");
    }
    return { bytes, signature: encodeBase58(signature) };
  } catch (error) {
    if (error instanceof WalletSubmissionError) throw error;
    fail("wallet_submit_signature_missing");
  }
}

function retryIsAllowed(attempt: WalletAttemptRecord | undefined): boolean {
  return attempt?.state === "rejected" &&
    attempt.receipt?.state === "rejected" &&
    attempt.receipt.chainOutcome === "rejected" &&
    attempt.receipt.tokenBalancesUnchanged === true &&
    attempt.receipt.manualRetryAllowed === true;
}

function resultFromAttempt(operationId: string, attempt: WalletAttemptRecord): WalletSubmissionResult {
  return {
    operationId,
    signature: attempt.signature,
    state: attempt.state,
    receipt: attempt.receipt,
    retryAllowed: retryIsAllowed(attempt),
    automaticResendAllowed: false,
    reason: attempt.state === "unknown" ? "submission_outcome_unresolved" : null,
  };
}

function unresolvedResult(operationId: string, signature: string): WalletSubmissionResult {
  return {
    operationId,
    signature,
    state: "unknown",
    receipt: null,
    retryAllowed: false,
    automaticResendAllowed: false,
    reason: "submission_outcome_unresolved",
  };
}

async function reconcileAndPersist(
  connection: Connection,
  journal: WalletSubmissionJournal,
  operation: WalletOperationRecord,
  commitment: Extract<Commitment, "confirmed" | "finalized">,
): Promise<WalletSubmissionResult> {
  const current = operation.attempts.at(-1);
  if (current === undefined) fail("wallet_submit_journal_unavailable");

  let receipt: RpcTransactionReceipt;
  try {
    receipt = await reconcileRpcTransactionReceipt(
      connection,
      current.signature,
      current.trackedTokenAccounts,
      commitment,
    );
  } catch {
    return unresolvedResult(operation.operationId, current.signature);
  }
  if (receipt.state === "unknown") {
    return unresolvedResult(operation.operationId, current.signature);
  }

  const updated: WalletAttemptRecord = { ...current, state: receipt.state, receipt };
  let persisted = false;
  try {
    persisted = await journal.replaceLatest(operation.operationId, current.signature, updated);
  } catch {
    persisted = false;
  }
  if (!persisted) {
    return {
      operationId: operation.operationId,
      signature: current.signature,
      state: "unknown",
      receipt: null,
      retryAllowed: false,
      automaticResendAllowed: false,
      reason: "wallet_submit_journal_write_failed",
    };
  }
  return resultFromAttempt(operation.operationId, updated);
}

/** Sign and send once. A durable journal entry is written before the only RPC submission. */
export async function submitWalletTransaction(options: {
  connection: Connection;
  signer: WalletTransactionSigner;
  transaction: WalletSignableTransaction;
  journal: WalletSubmissionJournal;
  operationId: string;
  trackedTokenAccounts: readonly TrackedTokenAccount[];
  retryOfSignature?: string;
  commitment?: Extract<Commitment, "confirmed" | "finalized">;
}): Promise<WalletSubmissionResult> {
  const { connection, signer, transaction, journal, operationId } = options;
  if (operationId.trim() === "") fail("wallet_submit_invalid_operation_id");
  if (options.trackedTokenAccounts.length === 0) fail("wallet_submit_tracked_accounts_invalid");
  const trackedAddresses = new Set<string>();
  try {
    for (const account of options.trackedTokenAccounts) {
      new PublicKey(account.address);
      new PublicKey(account.mint);
      if (trackedAddresses.has(account.address)) fail("wallet_submit_tracked_accounts_invalid");
      trackedAddresses.add(account.address);
    }
  } catch (error) {
    if (error instanceof WalletSubmissionError) throw error;
    fail("wallet_submit_tracked_accounts_invalid");
  }

  let genesis: string;
  try {
    genesis = await connection.getGenesisHash();
  } catch {
    fail("wallet_submit_genesis_rpc_unavailable");
  }
  if (genesis !== ETF_DEVNET_GENESIS_HASH) fail("wallet_submit_wrong_genesis");

  const payer = feePayer(transaction);
  if (signer.publicKey === null) fail("wallet_submit_wallet_unavailable");
  if (payer === null || !payer.equals(signer.publicKey)) fail("wallet_submit_fee_payer_mismatch");

  let unsignedMessage: Uint8Array;
  try {
    unsignedMessage = transactionMessage(transaction);
  } catch {
    fail("wallet_submit_transaction_invalid");
  }

  let existing: WalletOperationRecord | null;
  try {
    existing = await journal.read(operationId);
  } catch {
    fail("wallet_submit_journal_unavailable");
  }

  let prior = existing?.attempts.at(-1);
  if (options.retryOfSignature === undefined) {
    if (prior !== undefined) fail("wallet_submit_operation_already_attempted");
  } else {
    if (prior === undefined || prior.signature !== options.retryOfSignature) {
      fail("wallet_submit_retry_not_authorized");
    }
    let verifiedReceipt: RpcTransactionReceipt;
    try {
      verifiedReceipt = await reconcileRpcTransactionReceipt(
        connection,
        prior.signature,
        prior.trackedTokenAccounts,
        options.commitment ?? "confirmed",
      );
    } catch {
      fail("wallet_submit_retry_not_authorized");
    }
    const verifiedPrior: WalletAttemptRecord = {
      ...prior,
      state: verifiedReceipt.state,
      receipt: verifiedReceipt,
    };
    if (!retryIsAllowed(verifiedPrior)) fail("wallet_submit_retry_not_authorized");
    let persisted = false;
    try {
      persisted = await journal.replaceLatest(operationId, prior.signature, verifiedPrior);
    } catch {
      persisted = false;
    }
    if (!persisted) fail("wallet_submit_journal_write_failed");
    prior = verifiedPrior;
    existing = {
      operationId,
      attempts: [...(existing?.attempts.slice(0, -1) ?? []), verifiedPrior],
    };
  }

  let signed: WalletSignableTransaction;
  try {
    signed = await signer.signTransaction(transaction);
  } catch {
    fail("wallet_submit_signing_failed");
  }
  let signedMessage: Uint8Array;
  try {
    signedMessage = transactionMessage(signed);
  } catch {
    fail("wallet_submit_signed_message_changed");
  }
  if (!feePayer(signed)?.equals(payer) || !sameBytes(signedMessage, unsignedMessage)) {
    fail("wallet_submit_signed_message_changed");
  }
  const signedTransaction = signedBytesAndSignature(signed);
  if (existing?.attempts.some((attempt) => attempt.signature === signedTransaction.signature)) {
    fail("wallet_submit_signature_reused");
  }

  const attempt: WalletAttemptRecord = {
    signature: signedTransaction.signature,
    state: "unknown",
    trackedTokenAccounts: options.trackedTokenAccounts.map((account) => ({ ...account })),
    receipt: null,
  };
  let appended = false;
  try {
    appended = await journal.appendIfLatest(operationId, prior?.signature ?? null, attempt);
  } catch {
    fail("wallet_submit_journal_write_failed");
  }
  if (!appended) fail("wallet_submit_operation_already_attempted");

  try {
    await connection.sendRawTransaction(signedTransaction.bytes, {
      maxRetries: 0,
      skipPreflight: false,
    });
  } catch {
    // A timeout does not prove the transaction was not accepted.
  }

  const committedOperation = await journal.read(operationId).catch(() => null);
  if (committedOperation === null) {
    return { ...unresolvedResult(operationId, signedTransaction.signature), reason: "wallet_submit_journal_unavailable" };
  }
  return reconcileAndPersist(connection, journal, committedOperation, options.commitment ?? "confirmed");
}

/** Reconcile only the signature already stored for this operation; this function never submits. */
export async function reconcileWalletSubmission(options: {
  connection: Connection;
  journal: WalletSubmissionJournal;
  operationId: string;
  commitment?: Extract<Commitment, "confirmed" | "finalized">;
}): Promise<WalletSubmissionResult> {
  let operation: WalletOperationRecord | null;
  try {
    operation = await options.journal.read(options.operationId);
  } catch {
    fail("wallet_submit_journal_unavailable");
  }
  if (operation === null || operation.attempts.at(-1) === undefined) fail("wallet_submit_operation_already_attempted");
  return reconcileAndPersist(options.connection, options.journal, operation, options.commitment ?? "confirmed");
}
