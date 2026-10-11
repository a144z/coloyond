import {
  type Commitment,
  type Connection,
  type PublicKey,
  type SignatureStatus,
  type VersionedTransactionResponse,
} from "@solana/web3.js";

export type TrackedTokenAccount = { address: string; mint: string };

export type TokenAccountDelta = {
  account: string | null;
  accountIndex: number;
  mint: string;
  decimals: number;
  preAmount: string;
  postAmount: string;
  delta: string;
};

export type AccountLamportDelta = Readonly<{
  account: string;
  preLamports: string;
  postLamports: string;
  deltaLamports: string;
}>;

export type ReceiptState = "confirmed" | "rejected" | "unknown";
export type ChainOutcome = "succeeded" | "rejected" | "unresolved";

export type RpcTransactionReceipt = {
  signature: string;
  state: ReceiptState;
  chainOutcome: ChainOutcome;
  confirmationStatus: "confirmed" | "finalized" | null;
  confirmationSlot: string | null;
  networkFeeLamports: string | null;
  accountLamportDeltas: readonly AccountLamportDelta[] | null;
  tokenDeltas: TokenAccountDelta[] | null;
  tokenBalancesUnchanged: boolean | null;
  automaticResendAllowed: false;
  manualRetryAllowed: boolean;
  reason: string | null;
  limitation: "pool_state_shares_and_fee_counters_require_the_frozen_s5e_idl";
};

type RpcTokenBalance = {
  accountIndex: number;
  mint: string;
  uiTokenAmount: { amount: string; decimals: number };
};

type RpcMeta = NonNullable<VersionedTransactionResponse["meta"]> & {
  preTokenBalances?: RpcTokenBalance[] | null;
  postTokenBalances?: RpcTokenBalance[] | null;
  loadedAddresses?: { writable: PublicKey[]; readonly: PublicKey[] } | null;
};

const limitation = "pool_state_shares_and_fee_counters_require_the_frozen_s5e_idl" as const;

function unknownReceipt(
  signature: string,
  reason: string,
  chainOutcome: ChainOutcome = "unresolved",
  confirmationStatus: "confirmed" | "finalized" | null = null,
  confirmationSlot: number | null = null,
  networkFeeLamports: string | null = null,
  tokenDeltas: TokenAccountDelta[] | null = null,
  tokenBalancesUnchanged: boolean | null = null,
  accountLamportDeltas: readonly AccountLamportDelta[] | null = null,
): RpcTransactionReceipt {
  return {
    signature,
    state: "unknown",
    chainOutcome,
    confirmationStatus,
    confirmationSlot: confirmationSlot?.toString() ?? null,
    networkFeeLamports,
    accountLamportDeltas,
    tokenDeltas,
    tokenBalancesUnchanged,
    automaticResendAllowed: false,
    manualRetryAllowed: false,
    reason,
    limitation,
  };
}

function keyText(key: PublicKey | string): string {
  return typeof key === "string" ? key : key.toBase58();
}

function transactionKeys(response: VersionedTransactionResponse): string[] | null {
  const message = response.transaction.message as VersionedTransactionResponse["transaction"]["message"] & {
    accountKeys?: PublicKey[];
    staticAccountKeys?: PublicKey[];
  };
  const staticKeys = message.staticAccountKeys ?? message.accountKeys;
  if (staticKeys === undefined) return null;
  const loaded = (response.meta as RpcMeta | null)?.loadedAddresses;
  return [
    ...staticKeys.map(keyText),
    ...(loaded?.writable ?? []).map(keyText),
    ...(loaded?.readonly ?? []).map(keyText),
  ];
}

function tokenBalanceMap(
  balances: RpcTokenBalance[] | null | undefined,
): Map<number, RpcTokenBalance> | null {
  if (!Array.isArray(balances)) return null;
  const entries = new Map<number, RpcTokenBalance>();
  for (const item of balances) {
    if (
      !Number.isSafeInteger(item.accountIndex) || item.accountIndex < 0 ||
      typeof item.mint !== "string" ||
      !Number.isInteger(item.uiTokenAmount?.decimals) ||
      !/^\d+$/.test(item.uiTokenAmount?.amount ?? "")
    ) return null;
    if (entries.has(item.accountIndex)) return null;
    entries.set(item.accountIndex, item);
  }
  return entries;
}

function calculateTokenDeltas(
  response: VersionedTransactionResponse,
  tracked: readonly TrackedTokenAccount[],
  allowEmptyTracked: boolean,
): { deltas: TokenAccountDelta[]; unchanged: boolean } | null {
  const meta = response.meta as RpcMeta | null;
  if (meta === null) return null;
  const keys = transactionKeys(response);
  const pre = tokenBalanceMap(meta.preTokenBalances);
  const post = tokenBalanceMap(meta.postTokenBalances);
  if (keys === null || pre === null || post === null || (tracked.length === 0 && !allowEmptyTracked)) return null;
  if ([...pre.keys(), ...post.keys()].some((index) => index >= keys.length)) return null;

  const trackedIndices = new Map<number, string>();
  for (const tokenAccount of tracked) {
    const index = keys.indexOf(tokenAccount.address);
    if (index < 0 || trackedIndices.has(index)) return null;
    trackedIndices.set(index, tokenAccount.mint);
  }

  const indices = new Set([...pre.keys(), ...post.keys()]);
  for (const [index, expectedMint] of trackedIndices) {
    const before = pre.get(index);
    const after = post.get(index);
    if (before === undefined || after === undefined || before.mint !== expectedMint || after.mint !== expectedMint) return null;
    indices.add(index);
  }

  const deltas: TokenAccountDelta[] = [];
  for (const index of [...indices].sort((a, b) => a - b)) {
    const before = pre.get(index);
    const after = post.get(index);
    if (before !== undefined && after !== undefined && (before.mint !== after.mint || before.uiTokenAmount.decimals !== after.uiTokenAmount.decimals)) return null;
    const balance = after ?? before;
    if (balance === undefined) return null;
    if (tracked.length > 0 && (before === undefined || after === undefined)) return null;
    const preAmount = BigInt(before?.uiTokenAmount.amount ?? "0");
    const postAmount = BigInt(after?.uiTokenAmount.amount ?? "0");
    deltas.push({
      account: keys[index] ?? null,
      accountIndex: index,
      mint: balance.mint,
      decimals: balance.uiTokenAmount.decimals,
      preAmount: preAmount.toString(),
      postAmount: postAmount.toString(),
      delta: (postAmount - preAmount).toString(),
    });
  }
  return { deltas, unchanged: deltas.every((delta) => delta.delta === "0") };
}

function calculateLamportDeltas(response: VersionedTransactionResponse): AccountLamportDelta[] | null {
  const meta = response.meta as RpcMeta | null;
  if (meta === null) return null;
  const keys = transactionKeys(response);
  const pre = meta.preBalances;
  const post = meta.postBalances;
  if (keys === null || !Array.isArray(pre) || !Array.isArray(post) || pre.length !== keys.length || post.length !== keys.length) return null;
  if (keys.some((key, index) => key === undefined || keys.indexOf(key) !== index || !Number.isSafeInteger(pre[index]) || pre[index]! < 0 || !Number.isSafeInteger(post[index]) || post[index]! < 0)) return null;
  return keys.map((account, index) => ({
    account,
    preLamports: String(pre[index]),
    postLamports: String(post[index]),
    deltaLamports: String(post[index]! - pre[index]!),
  }));
}

function confirmedStatus(status: SignatureStatus): status is SignatureStatus & { confirmationStatus: "confirmed" | "finalized" } {
  return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized";
}

/** Reconcile one previously returned signature. This function never submits or resends a transaction. */
export async function reconcileRpcTransactionReceipt(
  connection: Connection,
  signature: string,
  trackedTokenAccounts: readonly TrackedTokenAccount[],
  commitment: Extract<Commitment, "confirmed" | "finalized"> = "confirmed",
  allowEmptyTrackedTokenAccounts = false,
): Promise<RpcTransactionReceipt> {
  let status: SignatureStatus | null;
  try {
    const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    status = statuses.value[0] ?? null;
  } catch {
    return unknownReceipt(signature, "signature_status_rpc_unavailable");
  }
  if (status === null) return unknownReceipt(signature, "signature_status_unresolved");
  if (!confirmedStatus(status)) {
    return unknownReceipt(signature, "signature_not_confirmed", "unresolved", null, status.slot);
  }

  let response: VersionedTransactionResponse | null;
  try {
    response = await connection.getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 });
  } catch {
    return unknownReceipt(signature, "transaction_metadata_rpc_unavailable", status.err === null ? "succeeded" : "rejected", status.confirmationStatus, status.slot);
  }
  if (response === null || response.meta === null) {
    return unknownReceipt(signature, "transaction_metadata_unresolved", status.err === null ? "succeeded" : "rejected", status.confirmationStatus, status.slot);
  }
  if (response.transaction.signatures[0] !== signature || response.slot !== status.slot) {
    return unknownReceipt(signature, "signature_or_slot_mismatch", "unresolved", status.confirmationStatus, status.slot);
  }

  const meta = response.meta as RpcMeta;
  if (!Number.isSafeInteger(meta.fee) || meta.fee < 0) {
    return unknownReceipt(signature, "transaction_fee_metadata_invalid", status.err === null ? "succeeded" : "rejected", status.confirmationStatus, status.slot);
  }
  const chainOutcome: ChainOutcome = status.err === null ? "succeeded" : "rejected";
  if ((status.err === null) !== (meta.err === null)) {
    return unknownReceipt(signature, "signature_and_transaction_outcome_conflict", chainOutcome, status.confirmationStatus, status.slot, String(meta.fee));
  }

  const balanceResult = calculateTokenDeltas(response, trackedTokenAccounts, allowEmptyTrackedTokenAccounts);
  if (balanceResult === null) {
    return unknownReceipt(signature, "token_balance_metadata_incomplete", chainOutcome, status.confirmationStatus, status.slot, String(meta.fee));
  }
  if (allowEmptyTrackedTokenAccounts && !balanceResult.unchanged) {
    return unknownReceipt(signature, "no_token_action_had_token_delta", chainOutcome, status.confirmationStatus, status.slot, String(meta.fee), balanceResult.deltas, false);
  }
  if (chainOutcome === "rejected" && !balanceResult.unchanged) {
    return unknownReceipt(signature, "rejected_transaction_has_token_delta", chainOutcome, status.confirmationStatus, status.slot, String(meta.fee), balanceResult.deltas, false);
  }

  const accountLamportDeltas = calculateLamportDeltas(response);
  if (accountLamportDeltas === null) {
    return unknownReceipt(signature, "lamport_balance_metadata_incomplete", chainOutcome, status.confirmationStatus, status.slot, String(meta.fee), balanceResult.deltas, balanceResult.unchanged);
  }

  return {
    signature,
    state: chainOutcome === "succeeded" ? "confirmed" : "rejected",
    chainOutcome,
    confirmationStatus: status.confirmationStatus,
    confirmationSlot: status.slot.toString(),
    networkFeeLamports: String(meta.fee),
    accountLamportDeltas,
    tokenDeltas: balanceResult.deltas,
    tokenBalancesUnchanged: balanceResult.unchanged,
    automaticResendAllowed: false,
    manualRetryAllowed: chainOutcome === "rejected" && balanceResult.unchanged,
    reason: chainOutcome === "rejected" ? "confirmed_transaction_rejected" : null,
    limitation,
  };
}
