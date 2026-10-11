import { Keypair, Transaction } from '@solana/web3.js';
import { connection } from './connection';

export interface TxResult {
  sig: string;
  slot: number;
}

/**
 * Sign (all signers), send and confirm a transaction on devnet.
 * Fees are charged to tx.feePayer, which callers set explicitly.
 */
export async function signSendConfirm(tx: Transaction, signers: Keypair[]): Promise<TxResult> {
  const blockhash = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash.blockhash;
  tx.lastValidBlockHeight = blockhash.lastValidBlockHeight;

  const sig = await connection.sendTransaction(tx, signers, { skipPreflight: false });
  const confirmation = await connection.confirmTransaction(
    { signature: sig, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
    'confirmed',
  );

  if (confirmation.value.err) {
    throw new Error(`transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
  }
  return { sig, slot: confirmation.context.slot };
}

/** Best-effort readable message from RPC / wallet errors. */
export function describeTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|too many|rate.?limit/i.test(msg)) {
    return 'Devnet RPC rate limit reached. Wait a moment and retry.';
  }
  if (/insufficient lamports|insufficient funds/i.test(msg)) {
    return 'Insufficient funds for this transaction and its fees.';
  }
  if (/blockhash not found|timeout/i.test(msg)) {
    return 'The transaction expired before confirmation. Retry.';
  }
  if (/failed to (send|confirm)|simulation failed/i.test(msg)) {
    return `${msg.slice(0, 220)}`;
  }
  return msg.slice(0, 220);
}
