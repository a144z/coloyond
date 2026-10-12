import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { connection } from "./connection.js";

export {
  type WalletSigner,
  type OwnerSigner,
  type TxResult,
} from "./tx-core.js";
import {
  signSendConfirmWith,
  type OwnerSigner,
  type TxResult,
  type PendingJournal,
  type PendingTransaction,
  reconcilePending,
} from "./tx-core.js";
const KEY = "coloyond.pending-transaction.v1.";
const memory = new Map<string, PendingTransaction>();
export const transactionJournal: PendingJournal = {
  read(owner) {
    try {
      const raw = localStorage.getItem(KEY + owner);
      if (!raw) return memory.get(owner) ?? null;
      const p = JSON.parse(raw);
      if (
        p.owner !== owner ||
        typeof p.signature !== "string" ||
        typeof p.message !== "string" ||
        typeof p.intent !== "string" ||
        typeof p.blockhash !== "string" ||
        !Number.isSafeInteger(p.lastValidBlockHeight)
      )
        throw Error("Invalid pending record");
      return p;
    } catch {
      return memory.get(owner) ?? null;
    }
  },
  write(p) {
    memory.set(p.owner, p);
    try {
      localStorage.setItem(KEY + p.owner, JSON.stringify(p));
    } catch {
      throw new Error(
        "Cannot persist the pending transaction. Nothing was broadcast.",
      );
    }
  },
  remove(owner) {
    memory.delete(owner);
    try {
      localStorage.removeItem(KEY + owner);
    } catch {}
  },
};
export function signSendConfirm(
  tx: Transaction,
  owner: OwnerSigner,
  additionalSigners: Keypair[] = [],
): Promise<TxResult> {
  return signSendConfirmWith(
    connection,
    transactionJournal,
    tx,
    owner,
    additionalSigners,
  );
}
export function reconcileWalletTransaction(
  owner: string,
): Promise<TxResult | null> {
  return reconcilePending(connection, transactionJournal, owner);
}

/** Best-effort readable message from RPC / wallet errors. */
export function describeTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /DELeGG.*Invalid account owner|Invalid account owner for delegated account/i.test(
      msg,
    )
  ) {
    return "MagicBlock rejected the Hydra sponsor before delegation. Retry scheduling; the sponsor is now assigned and delegated atomically.";
  }
  if (/InstructionFallbackNotFound|custom program error:\s*0x65\b/i.test(msg)) {
    return "The Devnet execution program is outdated and does not recognize the crank-policy instruction. Your completed setup steps are saved; update the program, then resume this setup.";
  }
  if (/429|too many|rate.?limit/i.test(msg)) {
    return "Devnet RPC rate limit reached. Wait a moment and retry.";
  }
  if (/insufficient lamports|insufficient funds/i.test(msg)) {
    return "Insufficient funds for this transaction and its fees.";
  }
  if (/blockhash not found|timeout/i.test(msg)) {
    return "Confirmation is unresolved. Check the submitted signature before retrying.";
  }
  if (/failed to (send|confirm)|simulation failed/i.test(msg)) {
    return `${msg.slice(0, 220)}`;
  }
  return msg.slice(0, 220);
}
