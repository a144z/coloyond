import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
  type SignatureStatus,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { ETF_DEVNET_GENESIS_HASH } from "../src/devnet-read.js";
import {
  reconcileWalletSubmission,
  submitWalletTransaction,
  WalletSubmissionError,
  type WalletOperationRecord,
  type WalletSubmissionJournal,
} from "../src/wallet-submit.js";

const slot = 123;
const tokenAccount = new PublicKey("Vote111111111111111111111111111111111111111");
const mint = new PublicKey("So11111111111111111111111111111111111111112");
const tracked = [{ address: tokenAccount.toBase58(), mint: mint.toBase58() }];

class MemoryJournal implements WalletSubmissionJournal {
  records = new Map<string, WalletOperationRecord>();
  failAppend = false;
  failReplace = false;

  async read(operationId: string): Promise<WalletOperationRecord | null> {
    const record = this.records.get(operationId);
    return record === undefined ? null : structuredClone(record);
  }

  async appendIfLatest(operationId: string, expected: string | null, attempt: WalletOperationRecord["attempts"][number]): Promise<boolean> {
    if (this.failAppend) throw new Error("journal unavailable");
    const current = this.records.get(operationId);
    if ((current?.attempts.at(-1)?.signature ?? null) !== expected) return false;
    this.records.set(operationId, { operationId, attempts: [...(current?.attempts ?? []), structuredClone(attempt)] });
    return true;
  }

  async replaceLatest(operationId: string, expected: string, attempt: WalletOperationRecord["attempts"][number]): Promise<boolean> {
    if (this.failReplace) throw new Error("journal unavailable");
    const current = this.records.get(operationId);
    if (current?.attempts.at(-1)?.signature !== expected) return false;
    this.records.set(operationId, {
      operationId,
      attempts: [...current.attempts.slice(0, -1), structuredClone(attempt)],
    });
    return true;
  }
}

function makeTransaction(payer: PublicKey, blockhash = Keypair.generate().publicKey.toBase58()): Transaction {
  return new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(new TransactionInstruction({
    keys: [{ pubkey: tokenAccount, isSigner: false, isWritable: true }],
    programId: SystemProgram.programId,
    data: Buffer.alloc(0),
  }));
}

function transactionResponse(signature: string, payer: PublicKey, options: { err?: unknown; post?: string } = {}): VersionedTransactionResponse {
  const err = options.err ?? null;
  return {
    transaction: {
      signatures: [signature],
      message: { staticAccountKeys: [payer, tokenAccount] },
    },
    meta: {
      err,
      fee: 5000,
      preTokenBalances: [{ accountIndex: 1, mint: mint.toBase58(), uiTokenAmount: { amount: "100", decimals: 9 } }],
      postTokenBalances: [{ accountIndex: 1, mint: mint.toBase58(), uiTokenAmount: { amount: options.post ?? "100", decimals: 9 } }],
      loadedAddresses: { writable: [], readonly: [] },
    },
    slot,
    blockTime: null,
    version: 0,
  } as unknown as VersionedTransactionResponse;
}

function setup(options: {
  genesis?: string;
  status?: SignatureStatus | null;
  txError?: unknown;
  post?: string;
  sendThrows?: boolean;
} = {}) {
  const keypair = Keypair.generate();
  let status: SignatureStatus | null = options.status === undefined
    ? { slot, confirmations: 1, err: null, confirmationStatus: "confirmed" }
    : options.status;
  let txError = options.txError;
  let post = options.post;
  const sent: { bytes: Uint8Array; options: unknown }[] = [];
  const signer = {
    publicKey: keypair.publicKey,
    calls: 0,
    async signTransaction(tx: Transaction) {
      this.calls += 1;
      tx.partialSign(keypair);
      return tx;
    },
  };
  const connection = {
    getGenesisHash: async () => options.genesis ?? ETF_DEVNET_GENESIS_HASH,
    sendRawTransaction: async (bytes: Uint8Array, sendOptions: unknown) => {
      sent.push({ bytes, options: sendOptions });
      if (options.sendThrows) throw new Error("rpc timeout");
      return "rpc-returned-signature";
    },
    getSignatureStatuses: async ([signature]: string[]) => ({ context: { slot }, value: [status === null ? null : { ...status }] }),
    getTransaction: async (signature: string) => transactionResponse(signature, keypair.publicKey, { err: txError, post }),
  } as unknown as Connection;
  return {
    keypair,
    signer,
    connection,
    journal: new MemoryJournal(),
    sent,
    setStatus(next: SignatureStatus | null) { status = next; },
    setTransaction(next: { err?: unknown; post?: string }) { txError = next.err; post = next.post; },
  };
}

function submitArgs(env: ReturnType<typeof setup>, operationId = "deposit") {
  return {
    connection: env.connection,
    signer: env.signer,
    transaction: makeTransaction(env.keypair.publicKey),
    journal: env.journal,
    operationId,
    trackedTokenAccounts: tracked,
  };
}

async function errorCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof WalletSubmissionError && error.code === code);
}

test("checks Devnet and fee payer before requesting a wallet signature", async () => {
  const wrongCluster = setup({ genesis: "wrong-genesis" });
  await errorCode(submitWalletTransaction(submitArgs(wrongCluster)), "wallet_submit_wrong_genesis");
  assert.equal(wrongCluster.signer.calls, 0);
  assert.equal(wrongCluster.sent.length, 0);

  const wrongPayer = setup();
  await errorCode(submitWalletTransaction({
    ...submitArgs(wrongPayer),
    transaction: makeTransaction(Keypair.generate().publicKey),
  }), "wallet_submit_fee_payer_mismatch");
  assert.equal(wrongPayer.signer.calls, 0);
});

test("sends once with RPC retries disabled and returns confirmed only after RPC reconciliation", async () => {
  const env = setup();
  const result = await submitWalletTransaction(submitArgs(env));
  assert.equal(env.sent.length, 1);
  assert.deepEqual(env.sent[0]?.options, { maxRetries: 0, skipPreflight: false });
  assert.equal(result.state, "confirmed");
  assert.equal(result.receipt?.networkFeeLamports, "5000");
  assert.equal(result.retryAllowed, false);
  assert.equal(result.automaticResendAllowed, false);
  assert.equal(env.journal.records.get("deposit")?.attempts[0]?.signature, result.signature);
});

test("preserves a timed-out signature as unknown and later reconciles without resubmitting", async () => {
  const env = setup({ sendThrows: true, status: null });
  const submitted = await submitWalletTransaction(submitArgs(env));
  assert.equal(submitted.state, "unknown");
  assert.equal(submitted.signature.length > 0, true);
  assert.equal(submitted.retryAllowed, false);
  assert.equal(env.sent.length, 1);

  env.setStatus({ slot, confirmations: 1, err: null, confirmationStatus: "confirmed" });
  const reconciled = await reconcileWalletSubmission({ connection: env.connection, journal: env.journal, operationId: "deposit" });
  assert.equal(reconciled.signature, submitted.signature);
  assert.equal(reconciled.state, "confirmed");
  assert.equal(env.sent.length, 1);
});

test("processed is unresolved and a second submission requires a confirmed unchanged rejection", async () => {
  const env = setup({ status: { slot, confirmations: 0, err: null, confirmationStatus: "processed" } });
  const result = await submitWalletTransaction(submitArgs(env));
  assert.equal(result.state, "unknown");
  assert.equal(result.retryAllowed, false);
  await errorCode(submitWalletTransaction(submitArgs(env)), "wallet_submit_operation_already_attempted");
  assert.equal(env.sent.length, 1);
});

test("confirmed rejection permits a caller-directed new attempt only after complete unchanged token metadata", async () => {
  const rejection = { InstructionError: [0, "Custom"] };
  const env = setup({ status: { slot, confirmations: 1, err: rejection, confirmationStatus: "confirmed" }, txError: rejection });
  const first = await submitWalletTransaction(submitArgs(env));
  assert.equal(first.state, "rejected");
  assert.equal(first.retryAllowed, true);
  assert.equal(first.receipt?.tokenBalancesUnchanged, true);

  const retryArgs = { ...submitArgs(env), transaction: makeTransaction(env.keypair.publicKey), retryOfSignature: first.signature };
  const second = await submitWalletTransaction(retryArgs);
  assert.equal(second.state, "rejected");
  assert.equal(env.sent.length, 2);
  assert.equal(env.journal.records.get("deposit")?.attempts.length, 2);
});

test("a rejected transaction with token changes cannot be retried", async () => {
  const rejection = { InstructionError: [0, "Custom"] };
  const env = setup({ status: { slot, confirmations: 1, err: rejection, confirmationStatus: "confirmed" }, txError: rejection, post: "99" });
  const first = await submitWalletTransaction(submitArgs(env));
  assert.equal(first.state, "unknown");
  assert.equal(first.retryAllowed, false);
  await errorCode(submitWalletTransaction({ ...submitArgs(env), retryOfSignature: first.signature }), "wallet_submit_retry_not_authorized");
  assert.equal(env.sent.length, 1);
});

test("rechecks a stored rejection through RPC before presenting a retry opportunity", async () => {
  const rejection = { InstructionError: [0, "Custom"] };
  const env = setup({ status: { slot, confirmations: 1, err: rejection, confirmationStatus: "confirmed" }, txError: rejection });
  const first = await submitWalletTransaction(submitArgs(env));
  assert.equal(first.retryAllowed, true);

  env.setStatus({ slot, confirmations: 0, err: null, confirmationStatus: "processed" });
  await errorCode(
    submitWalletTransaction({ ...submitArgs(env), retryOfSignature: first.signature }),
    "wallet_submit_retry_not_authorized",
  );
  assert.equal(env.signer.calls, 1);
  assert.equal(env.sent.length, 1);
});

test("does not submit when the signed-message journal write fails", async () => {
  const env = setup();
  env.journal.failAppend = true;
  await errorCode(submitWalletTransaction(submitArgs(env)), "wallet_submit_journal_write_failed");
  assert.equal(env.sent.length, 0);
});

test("a wallet cannot alter the transaction message after confirmation", async () => {
  const env = setup();
  const args = submitArgs(env);
  args.signer.signTransaction = async (tx) => {
    assert.ok(tx instanceof Transaction);
    tx.add(new TransactionInstruction({ keys: [], programId: SystemProgram.programId, data: Buffer.from([1]) }));
    tx.partialSign(env.keypair);
    return tx;
  };
  await errorCode(submitWalletTransaction(args), "wallet_submit_signed_message_changed");
  assert.equal(env.sent.length, 0);
  assert.equal(env.journal.records.size, 0);
});
