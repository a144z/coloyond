import {
  Connection,
  PublicKey,
  SystemProgram,
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
import { assertVerifiedEtfManifest, ETF_SHARE_DECIMALS, type VerifiedEtfManifest } from "./manifest.js";
import { ETF_DEVNET_TOKEN_PROGRAM } from "./devnet-read.js";

export type WalletSignableTransaction = Transaction | VersionedTransaction;

export type WalletTransactionSigner = {
  publicKey: PublicKey | null;
  signTransaction(transaction: WalletSignableTransaction): Promise<WalletSignableTransaction>;
};

export type WalletNoTokenBalanceAction = "initialize" | "prepare_accounts" | "pause" | "poke" | "resume_propose" | "resume_execute" | "resume_cancel";

export type WalletAtaPreparationTarget = Readonly<{
  owner: string;
  mint: string;
  associatedAccount: string;
  decimals: number;
}>;

const CLASSIC_TOKEN_PROGRAM_ID = new PublicKey(ETF_DEVNET_TOKEN_PROGRAM);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const VERIFIED_ATA_PLANS = new WeakSet<object>();

/** Derives the only ATA preparation targets accepted by the wallet-submit path. */
export function deriveWalletAtaPreparationPlan(
  context: VerifiedEtfManifest,
  owner: PublicKey,
  mints: readonly PublicKey[],
): readonly WalletAtaPreparationTarget[] {
  assertVerifiedEtfManifest(context);
  if (!Array.isArray(mints) || mints.length === 0 || mints.length > context.config.assets.length + 1) {
    fail("wallet_submit_no_token_action_invalid");
  }
  const admitted = new Map<string, number>([
    ...context.config.assets.map((asset) => [asset.mint.toBase58(), asset.decimals] as const),
    [context.addresses.shareMint.toBase58(), ETF_SHARE_DECIMALS],
  ]);
  const seen = new Set<string>();
  const plan = mints.map((mint) => {
    const mintText = mint.toBase58();
    const decimals = admitted.get(mintText);
    if (decimals === undefined || seen.has(mintText) || !context.config.assets.every((asset) => asset.tokenProgram.equals(CLASSIC_TOKEN_PROGRAM_ID))) {
      fail("wallet_submit_no_token_action_invalid");
    }
    seen.add(mintText);
    const [associated] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), CLASSIC_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return Object.freeze({ owner: owner.toBase58(), mint: mintText, associatedAccount: associated.toBase58(), decimals });
  });
  Object.freeze(plan);
  VERIFIED_ATA_PLANS.add(plan);
  return plan;
}

export type WalletAttemptRecord = {
  signature: string;
  state: ReceiptState;
  trackedTokenAccounts: TrackedTokenAccount[];
  receipt: RpcTransactionReceipt | null;
  noTokenBalanceAction?: WalletNoTokenBalanceAction;
  requirePostStateReadback?: boolean;
  postStateVerified?: boolean;
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
  | "wallet_submit_journal_write_failed"
  | "wallet_submit_no_token_action_invalid"
  | "wallet_submit_post_state_verifier_required";

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
  reason: WalletSubmissionErrorCode | "submission_outcome_unresolved" | "post_state_unresolved" | null;
  postStateVerified: boolean | null;
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
    attempt.receipt.manualRetryAllowed === true &&
    (attempt.requirePostStateReadback !== true || attempt.postStateVerified === true);
}

function resultFromAttempt(operationId: string, attempt: WalletAttemptRecord): WalletSubmissionResult {
  return {
    operationId,
    signature: attempt.signature,
    state: attempt.state,
    receipt: attempt.receipt,
    retryAllowed: retryIsAllowed(attempt),
    automaticResendAllowed: false,
    reason: attempt.state === "unknown"
      ? attempt.receipt !== null && attempt.postStateVerified === false ? "post_state_unresolved" : "submission_outcome_unresolved"
      : null,
    postStateVerified: attempt.requirePostStateReadback === true ? attempt.postStateVerified === true : null,
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
    postStateVerified: null,
  };
}

async function reconcileAndPersist(
  connection: Connection,
  journal: WalletSubmissionJournal,
  operation: WalletOperationRecord,
  commitment: Extract<Commitment, "confirmed" | "finalized">,
  postStateVerifier?: (result: WalletSubmissionResult) => Promise<boolean>,
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
      current.noTokenBalanceAction !== undefined,
    );
  } catch {
    return unresolvedResult(operation.operationId, current.signature);
  }
  if (receipt.state === "unknown") {
    const updated: WalletAttemptRecord = {
      ...current,
      state: "unknown",
      receipt,
      ...(current.requirePostStateReadback === true ? { postStateVerified: false } : {}),
    };
    let persisted = false;
    try {
      persisted = await journal.replaceLatest(operation.operationId, current.signature, updated);
    } catch {
      persisted = false;
    }
    return persisted ? resultFromAttempt(operation.operationId, updated) : unresolvedResult(operation.operationId, current.signature);
  }

  let postStateVerified = current.requirePostStateReadback !== true;
  if (current.requirePostStateReadback === true && postStateVerifier !== undefined) {
    const candidate: WalletAttemptRecord = { ...current, state: receipt.state, receipt, postStateVerified: false };
    try {
      postStateVerified = await postStateVerifier(resultFromAttempt(operation.operationId, candidate));
    } catch {
      postStateVerified = false;
    }
  }
  const verifiedState = current.requirePostStateReadback === true && !postStateVerified ? "unknown" : receipt.state;
  const updated: WalletAttemptRecord = { ...current, state: verifiedState, receipt, ...(current.requirePostStateReadback === true ? { postStateVerified } : {}) };
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
      postStateVerified: current.requirePostStateReadback === true ? false : null,
    };
  }
  return resultFromAttempt(operation.operationId, updated);
}

const NO_TOKEN_BALANCE_DISCRIMINATORS: Readonly<Record<Exclude<WalletNoTokenBalanceAction, "prepare_accounts">, readonly number[]>> = {
  initialize: [95, 180, 10, 172, 84, 174, 232, 40],
  pause: [221, 2, 34, 100, 217, 178, 42, 15],
  poke: [46, 24, 16, 107, 212, 9, 17, 5],
  resume_propose: [101, 206, 195, 58, 159, 84, 16, 59],
  resume_execute: [62, 120, 18, 234, 169, 77, 91, 35],
  resume_cancel: [214, 159, 34, 123, 49, 111, 127, 76],
};

function isNoTokenBalanceInstruction(transaction: WalletSignableTransaction, action: Exclude<WalletNoTokenBalanceAction, "prepare_accounts">, programId: PublicKey): boolean {
  if (!(transaction instanceof Transaction) || transaction.instructions.length !== 1) return false;
  const [instruction] = transaction.instructions;
  if (!instruction || !instruction.programId.equals(programId)) return false;
  const expected = NO_TOKEN_BALANCE_DISCRIMINATORS[action];
  return instruction.data.length >= expected.length && expected.every((byte, index) => instruction.data[index] === byte);
}

function isIdempotentAtaPreparation(
  transaction: WalletSignableTransaction,
  payer: PublicKey,
  programId: PublicKey,
  plan: readonly WalletAtaPreparationTarget[],
): boolean {
  if (!VERIFIED_ATA_PLANS.has(plan as object) || !(transaction instanceof Transaction) || plan.length === 0 || transaction.instructions.length !== plan.length || !programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) return false;
  const seen = new Set<string>();
  for (let index = 0; index < plan.length; index += 1) {
    const target = plan[index]!;
    const instruction = transaction.instructions[index]!;
    let owner: PublicKey;
    let mint: PublicKey;
    let associated: PublicKey;
    try {
      owner = new PublicKey(target.owner);
      mint = new PublicKey(target.mint);
      associated = new PublicKey(target.associatedAccount);
    } catch {
      return false;
    }
    const [derived] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), CLASSIC_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    if (!owner.equals(payer) || !associated.equals(derived) || seen.has(associated.toBase58()) ||
        !Number.isInteger(target.decimals) || target.decimals < 0 || target.decimals > 9 ||
        !instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) ||
        instruction.data.length !== 1 || instruction.data[0] !== 1 || instruction.keys.length !== 6) return false;
    const expected = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: derived, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    if (instruction.keys.some((meta, metaIndex) => {
      const expectedMeta = expected[metaIndex]!;
      return !meta.pubkey.equals(expectedMeta.pubkey) || meta.isSigner !== expectedMeta.isSigner || meta.isWritable !== expectedMeta.isWritable;
    })) return false;
    seen.add(associated.toBase58());
  }
  return true;
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
  noTokenBalanceAction?: WalletNoTokenBalanceAction;
  noTokenProgramId?: PublicKey;
  ataPreparationPlan?: readonly WalletAtaPreparationTarget[];
  requirePostStateReadback?: boolean;
  postStateVerifier?: (result: WalletSubmissionResult) => Promise<boolean>;
}): Promise<WalletSubmissionResult> {
  const { connection, signer, transaction, journal, operationId } = options;
  if (operationId.trim() === "") fail("wallet_submit_invalid_operation_id");
  if (options.trackedTokenAccounts.length === 0) {
    if (options.noTokenBalanceAction === undefined || options.noTokenProgramId === undefined) fail("wallet_submit_tracked_accounts_invalid");
    if (options.noTokenBalanceAction === "prepare_accounts") {
      if (options.ataPreparationPlan === undefined || signer.publicKey === null || !isIdempotentAtaPreparation(transaction, signer.publicKey, options.noTokenProgramId, options.ataPreparationPlan)) fail("wallet_submit_no_token_action_invalid");
    } else if (options.ataPreparationPlan !== undefined || !isNoTokenBalanceInstruction(transaction, options.noTokenBalanceAction, options.noTokenProgramId)) {
      fail("wallet_submit_no_token_action_invalid");
    }
  } else if (options.noTokenBalanceAction !== undefined || options.noTokenProgramId !== undefined || options.ataPreparationPlan !== undefined) {
    fail("wallet_submit_no_token_action_invalid");
  }
  if (options.requirePostStateReadback === true && options.postStateVerifier === undefined) fail("wallet_submit_post_state_verifier_required");
  if (options.noTokenBalanceAction !== undefined && options.requirePostStateReadback !== true) fail("wallet_submit_post_state_verifier_required");
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
        prior.noTokenBalanceAction !== undefined,
      );
    } catch {
      fail("wallet_submit_retry_not_authorized");
    }
    let postStateVerified = prior.requirePostStateReadback !== true;
    const retryCandidate: WalletAttemptRecord = {
      ...prior,
      state: verifiedReceipt.state,
      receipt: verifiedReceipt,
      ...(prior.requirePostStateReadback === true ? { postStateVerified: false } : {}),
    };
    if (verifiedReceipt.state !== "unknown" && prior.requirePostStateReadback === true && options.postStateVerifier !== undefined) {
      try {
        postStateVerified = await options.postStateVerifier(resultFromAttempt(operationId, retryCandidate));
      } catch {
        postStateVerified = false;
      }
    }
    const verifiedPrior: WalletAttemptRecord = {
      ...retryCandidate,
      ...(prior.requirePostStateReadback === true ? { postStateVerified } : {}),
      state: prior.requirePostStateReadback === true && !postStateVerified ? "unknown" : verifiedReceipt.state,
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
    ...(options.noTokenBalanceAction === undefined ? {} : { noTokenBalanceAction: options.noTokenBalanceAction }),
    ...(options.requirePostStateReadback === true ? { requirePostStateReadback: true, postStateVerified: false } : {}),
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
  return reconcileAndPersist(connection, journal, committedOperation, options.commitment ?? "confirmed", options.postStateVerifier);
}

/** Reconcile only the signature already stored for this operation; this function never submits. */
export async function reconcileWalletSubmission(options: {
  connection: Connection;
  journal: WalletSubmissionJournal;
  operationId: string;
  commitment?: Extract<Commitment, "confirmed" | "finalized">;
  postStateVerifier?: (result: WalletSubmissionResult) => Promise<boolean>;
}): Promise<WalletSubmissionResult> {
  let operation: WalletOperationRecord | null;
  try {
    operation = await options.journal.read(options.operationId);
  } catch {
    fail("wallet_submit_journal_unavailable");
  }
  if (operation === null || operation.attempts.at(-1) === undefined) fail("wallet_submit_operation_already_attempted");
  return reconcileAndPersist(options.connection, options.journal, operation, options.commitment ?? "confirmed", options.postStateVerifier);
}
