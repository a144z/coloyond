import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { base58 } from '@scure/base';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { SOLANA_DERIVATION_PATH, deriveEd25519Path } from './derivation';
import { connection } from './connection';
import { FAUCET_LAMPORTS } from './config';
import { emptyTokens, mintOf, mintToAssetMap } from './assets';

export interface Balances {
  solLamports: number;
  /** Raw SPL balance per asset id (WSOL included). Zero when no account exists. */
  tokens: Record<string, number>;
}

export function generateMnemonicPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

export function validateMnemonicPhrase(phrase: string): boolean {
  return validateMnemonic(phrase.trim().toLowerCase().replace(/\s+/g, ' '), wordlist);
}

export function keypairFromMnemonic(phrase: string): Keypair {
  const seed = mnemonicToSeedSync(phrase);
  const derived = deriveEd25519Path(seed, SOLANA_DERIVATION_PATH);
  return Keypair.fromSeed(derived);
}

/** Vault custody keypairs: fresh ed25519 keys, exported as base58 for storage. */
export function encodeSecret(keypair: Keypair): string {
  return base58.encode(keypair.secretKey);
}

export function decodeSecret(secret: string): Keypair {
  return Keypair.fromSecretKey(base58.decode(secret));
}

/**
 * Read SOL plus every token balance in two RPC calls: one getBalance and one
 * parsed token-account scan (mapped onto the asset registry).
 */
export async function fetchBalances(owner: PublicKey): Promise<Balances> {
  const byMint = mintToAssetMap();
  const tokens = emptyTokens();

  const [solLamports, tokenAccounts] = await Promise.all([
    connection.getBalance(owner, 'confirmed'),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed'),
  ]);

  for (const { account } of tokenAccounts.value) {
    const info = (account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } })
      ?.parsed?.info;
    if (!info?.mint || typeof info.tokenAmount?.amount !== 'string') continue;
    const assetId = byMint.get(info.mint);
    if (!assetId) continue;
    tokens[assetId] = Number(info.tokenAmount.amount);
  }

  return { solLamports, tokens };
}

/** Wrap SOL into the owner's own WSOL ATA within a given transaction. */
export function wrapSolInstructions(owner: PublicKey, lamports: number): Transaction['instructions'] {
  const ata = getAssociatedTokenAddressSync(mintOf('wsol'), owner);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, mintOf('wsol')),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports }),
    createSyncNativeInstruction(ata),
  ];
}

/** Standalone wrap: the owner desk's SOL -> WSOL control. */
export function buildWrapTx(owner: Keypair, lamports: number): Transaction {
  const tx = new Transaction().add(...wrapSolInstructions(owner.publicKey, lamports));
  tx.feePayer = owner.publicKey;
  return tx;
}

/** Devnet faucet. Throws with a readable message when rate limited. */
export async function requestAirdrop(owner: Keypair): Promise<string> {
  const sig = await connection.requestAirdrop(owner.publicKey, FAUCET_LAMPORTS);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
