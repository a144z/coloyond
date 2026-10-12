import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { connection } from './connection';

/** Browser wallet signing surface used by the app. Runtime-only; never persist it. */
export interface WalletSigner {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

export type OwnerSigner = Keypair | WalletSigner;

export interface TxResult {
  sig: string;
  slot: number;
}

/**
 * Sign (all signers), send and confirm a transaction on devnet.
 * Fees are charged to tx.feePayer, which callers set explicitly.
 */
export async function signSendConfirm(
  tx: Transaction,
  owner: OwnerSigner,
  additionalSigners: Keypair[] = [],
): Promise<TxResult> {
  const blockhash = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash.blockhash;
  tx.lastValidBlockHeight = blockhash.lastValidBlockHeight;
  tx.feePayer = owner.publicKey;

  let signed: Transaction;
  if (owner instanceof Keypair) {
    tx.partialSign(owner, ...additionalSigners);
    signed = tx;
  } else {
    // Some instructions include an ephemeral sponsor key which must sign
    // before the connected wallet approves the transaction.
    if (additionalSigners.length) tx.partialSign(...additionalSigners);
    signed = await owner.signTransaction(tx);
    if (!signed.signature) throw new Error('The connected wallet did not sign the transaction.');
  }

  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
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
  if (/DELeGG.*Invalid account owner|Invalid account owner for delegated account/i.test(msg)) {
    return 'MagicBlock rejected the Hydra sponsor before delegation. Retry scheduling; the sponsor is now assigned and delegated atomically.';
  }
  if (/InstructionFallbackNotFound|custom program error:\s*0x65\b/i.test(msg)) {
    return 'The Devnet execution program is outdated and does not recognize the crank-policy instruction. Your completed setup steps are saved; update the program, then resume this setup.';
  }
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
