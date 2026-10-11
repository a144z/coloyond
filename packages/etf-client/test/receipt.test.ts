import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey, type Connection, type SignatureStatus, type VersionedTransactionResponse } from "@solana/web3.js";
import { reconcileRpcTransactionReceipt, type TrackedTokenAccount } from "../src/receipt.js";

const signature = "1".repeat(64);
const slot = 123;
const owner = "11111111111111111111111111111111";
const tokenAccount = "Vote111111111111111111111111111111111111111";
const mint = "So11111111111111111111111111111111111111112";
const tracked: TrackedTokenAccount[] = [{ address: tokenAccount, mint }];

function transactionResponse(options: {
  pre?: string | null;
  post?: string | null;
  fee?: number;
  err?: unknown;
  responseSignature?: string;
  responseSlot?: number;
} = {}): VersionedTransactionResponse {
  const pre = options.pre === null ? [] : [{ accountIndex: 1, mint, uiTokenAmount: { amount: options.pre ?? "100", decimals: 9 } }];
  const post = options.post === null ? [] : [{ accountIndex: 1, mint, uiTokenAmount: { amount: options.post ?? "80", decimals: 9 } }];
  return {
    transaction: {
      signatures: [options.responseSignature ?? signature],
      message: { staticAccountKeys: [new PublicKey(owner), new PublicKey(tokenAccount)] },
    },
    meta: { err: options.err ?? null, fee: options.fee ?? 5000, preBalances: [10000, 100], postBalances: [5000, 100], preTokenBalances: pre, postTokenBalances: post, loadedAddresses: { writable: [], readonly: [] } },
    slot: options.responseSlot ?? slot,
    blockTime: null,
    version: 0,
  } as unknown as VersionedTransactionResponse;
}

function fakeConnection(options: {
  status?: SignatureStatus | null;
  transaction?: VersionedTransactionResponse | null;
  statusThrows?: boolean;
  transactionThrows?: boolean;
} = {}): { connection: Connection; statusRequests: string[][]; transactionRequests: string[] } {
  const statusRequests: string[][] = [];
  const transactionRequests: string[] = [];
  const connection = {
    getSignatureStatuses: async (signatures: string[]) => {
      statusRequests.push(signatures);
      if (options.statusThrows) throw new Error("rpc timeout");
      return { context: { slot }, value: [options.status === undefined ? { slot, confirmations: 1, err: null, confirmationStatus: "confirmed" } : options.status] };
    },
    getTransaction: async (requestedSignature: string) => {
      transactionRequests.push(requestedSignature);
      if (options.transactionThrows) throw new Error("rpc timeout");
      return options.transaction === undefined ? transactionResponse() : options.transaction;
    },
  } as unknown as Connection;
  return { connection, statusRequests, transactionRequests };
}

test("reconciles confirmed RPC metadata and keeps lamport fee separate from token deltas", async () => {
  const rpc = fakeConnection();
  const receipt = await reconcileRpcTransactionReceipt(rpc.connection, signature, tracked);

  assert.deepEqual(rpc.statusRequests, [[signature]]);
  assert.deepEqual(rpc.transactionRequests, [signature]);
  assert.equal(receipt.state, "confirmed");
  assert.equal(receipt.networkFeeLamports, "5000");
  assert.deepEqual(receipt.accountLamportDeltas, [
    { account: owner, preLamports: "10000", postLamports: "5000", deltaLamports: "-5000" },
    { account: tokenAccount, preLamports: "100", postLamports: "100", deltaLamports: "0" },
  ]);
  assert.deepEqual(receipt.tokenDeltas, [{ account: tokenAccount, accountIndex: 1, mint, decimals: 9, preAmount: "100", postAmount: "80", delta: "-20" }]);
  assert.equal(receipt.tokenBalancesUnchanged, false);
  assert.equal(receipt.automaticResendAllowed, false);
  assert.equal(receipt.manualRetryAllowed, false);
  assert.equal(receipt.limitation, "pool_state_shares_and_fee_counters_require_the_frozen_s5e_idl");
});

test("keeps a submitted or processed signature unresolved and never suggests retry", async () => {
  const rpc = fakeConnection({ status: { slot, confirmations: 0, err: null, confirmationStatus: "processed" } });
  const receipt = await reconcileRpcTransactionReceipt(rpc.connection, signature, tracked);
  assert.equal(receipt.state, "unknown");
  assert.equal(receipt.reason, "signature_not_confirmed");
  assert.equal(receipt.automaticResendAllowed, false);
  assert.equal(receipt.manualRetryAllowed, false);
  assert.deepEqual(rpc.transactionRequests, []);
});

test("missing status or a timed-out status query remains unknown", async (t) => {
  for (const rpc of [fakeConnection({ status: null }), fakeConnection({ statusThrows: true })]) {
    await t.test("unknown status", async () => {
      const receipt = await reconcileRpcTransactionReceipt(rpc.connection, signature, tracked);
      assert.equal(receipt.state, "unknown");
      assert.equal(receipt.networkFeeLamports, null);
      assert.equal(receipt.tokenDeltas, null);
      assert.equal(receipt.manualRetryAllowed, false);
      assert.equal(receipt.automaticResendAllowed, false);
      assert.deepEqual(rpc.statusRequests, [[signature]]);
      assert.deepEqual(rpc.transactionRequests, []);
    });
  }
});

test("reports a confirmed rejection, fee, and unchanged token accounts before permitting manual retry", async () => {
  const rejection = { InstructionError: [0, "Custom"] };
  const rpc = fakeConnection({
    status: { slot, confirmations: 1, err: rejection, confirmationStatus: "confirmed" },
    transaction: transactionResponse({ pre: "100", post: "100", fee: 5000, err: rejection }),
  });
  const receipt = await reconcileRpcTransactionReceipt(rpc.connection, signature, tracked);

  assert.equal(receipt.state, "rejected");
  assert.equal(receipt.chainOutcome, "rejected");
  assert.equal(receipt.networkFeeLamports, "5000");
  assert.equal(receipt.tokenBalancesUnchanged, true);
  assert.equal(receipt.tokenDeltas?.[0]?.delta, "0");
  assert.equal(receipt.manualRetryAllowed, true);
  assert.equal(receipt.automaticResendAllowed, false);
});

test("does not authorize retry when rejected transaction metadata reports a token delta", async () => {
  const rejection = { InstructionError: [0, "Custom"] };
  const rpc = fakeConnection({
    status: { slot, confirmations: 1, err: rejection, confirmationStatus: "confirmed" },
    transaction: transactionResponse({ pre: "100", post: "99", err: rejection }),
  });
  const receipt = await reconcileRpcTransactionReceipt(rpc.connection, signature, tracked);
  assert.equal(receipt.state, "unknown");
  assert.equal(receipt.chainOutcome, "rejected");
  assert.equal(receipt.reason, "rejected_transaction_has_token_delta");
  assert.equal(receipt.tokenDeltas?.[0]?.delta, "-1");
  assert.equal(receipt.tokenBalancesUnchanged, false);
  assert.equal(receipt.manualRetryAllowed, false);
});

test("missing transaction metadata, balance metadata, or inconsistent RPC identity stays unknown", async (t) => {
  const cases = [
    { label: "missing transaction", rpc: fakeConnection({ transaction: null }), reason: "transaction_metadata_unresolved" },
    { label: "transaction RPC timeout", rpc: fakeConnection({ transactionThrows: true }), reason: "transaction_metadata_rpc_unavailable" },
    { label: "missing tracked token balance", rpc: fakeConnection({ transaction: transactionResponse({ pre: null }) }), reason: "token_balance_metadata_incomplete" },
    { label: "wrong signature", rpc: fakeConnection({ transaction: transactionResponse({ responseSignature: "2".repeat(64) }) }), reason: "signature_or_slot_mismatch" },
    { label: "wrong slot", rpc: fakeConnection({ transaction: transactionResponse({ responseSlot: slot + 1 }) }), reason: "signature_or_slot_mismatch" },
  ];
  for (const item of cases) {
    await t.test(item.label, async () => {
      const receipt = await reconcileRpcTransactionReceipt(item.rpc.connection, signature, tracked);
      assert.equal(receipt.state, "unknown");
      assert.equal(receipt.reason, item.reason);
      assert.equal(receipt.manualRetryAllowed, false);
      assert.equal(receipt.automaticResendAllowed, false);
    });
  }
});

test("rejects conflicting signature and transaction outcomes", async () => {
  const rpc = fakeConnection({
    status: { slot, confirmations: 1, err: null, confirmationStatus: "confirmed" },
    transaction: transactionResponse({ err: { InstructionError: [0, "Custom"] } }),
  });
  const receipt = await reconcileRpcTransactionReceipt(rpc.connection, signature, tracked);
  assert.equal(receipt.state, "unknown");
  assert.equal(receipt.reason, "signature_and_transaction_outcome_conflict");
  assert.equal(receipt.manualRetryAllowed, false);
});

test("requires complete RPC lamport balance metadata before confirming a transaction", async () => {
  const response = transactionResponse() as unknown as { meta: { preBalances: number[]; postBalances: number[] } };
  response.meta.preBalances = [];
  const rpc = fakeConnection({ transaction: response as unknown as VersionedTransactionResponse });
  const receipt = await reconcileRpcTransactionReceipt(rpc.connection, signature, tracked);
  assert.equal(receipt.state, "unknown");
  assert.equal(receipt.reason, "lamport_balance_metadata_incomplete");
  assert.equal(receipt.networkFeeLamports, "5000");
  assert.equal(receipt.accountLamportDeltas, null);
});
