import { type PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

// The subset of a connected wallet we hand to @symmetry-hq/sdk. Wallet Adapter's
// useWallet() exposes exactly this shape once publicKey is non-null.
export interface WalletLike {
  publicKey: PublicKey | null;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export interface SdkWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export function toSdkWallet(wallet: WalletLike): SdkWallet {
  if (!wallet.publicKey) throw new Error("Wallet is not connected");
  return {
    publicKey: wallet.publicKey,
    signTransaction: tx => wallet.signTransaction(tx),
    signAllTransactions: txs => wallet.signAllTransactions(txs),
  };
}
