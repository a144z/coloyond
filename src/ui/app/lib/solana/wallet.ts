import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { SOLANA_DERIVATION_PATH, deriveEd25519Path } from './derivation.js';
import { connection } from './connection.js';
import { FAUCET_LAMPORTS } from './config.js';
import { emptyTokens, mintOf, mintToAssetMap } from './assets.js';

export interface Balances {
  solLamports: number;
  /** Raw SPL balance per asset id (WSOL included). Zero when no account exists. */
  tokens: Record<string, number>;
  /** Present when the independent SPL-token scan could not be completed. */
  tokenError?: string;
}

async function withRpcTimeout<T>(request: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), 12_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
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

/**
 * Read SOL plus every token balance in two RPC calls: one getBalance and one
 * parsed token-account scan (mapped onto the asset registry).
 */
export async function fetchBalances(
  owner: PublicKey,
  tokenRpc = connection,
  solRpc = connection,
  onSolBalance?: (lamports: number) => void,
): Promise<Balances> {
  const byMint = mintToAssetMap();
  const tokens = emptyTokens();

  const tokenRequest = withRpcTimeout(
    Promise.resolve().then(() => tokenRpc.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed')),
    'Token balance read',
  );
  // A token request may finish after a failed SOL read; keep its rejection handled.
  void tokenRequest.catch(() => {});

  let solLamports: number;
  try {
    solLamports = await withRpcTimeout(solRpc.getBalance(owner, 'confirmed'), 'SOL balance read');
  } catch (error) {
    throw new Error(`Could not read SOL balance: ${error instanceof Error ? error.message : String(error)}`);
  }
  onSolBalance?.(solLamports);

  let tokenAccounts: Awaited<typeof tokenRequest> | null = null;
  let tokenError: string | undefined;
  try {
    tokenAccounts = await tokenRequest;
  } catch (error) {
    tokenError = error instanceof Error ? error.message : String(error);
  }

  for (const { account } of tokenAccounts?.value ?? []) {
    const info = (account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } })
      ?.parsed?.info;
    if (!info?.mint || typeof info.tokenAmount?.amount !== 'string') continue;
    const assetId = byMint.get(info.mint);
    if (!assetId) continue;
    const amount = Number(info.tokenAmount.amount);
    if (Number.isFinite(amount) && amount >= 0) tokens[assetId] += amount;
  }

  return { solLamports, tokens, ...(tokenError ? { tokenError } : {}) };
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
export function buildWrapTx(owner: PublicKey, lamports: number): Transaction {
  const tx = new Transaction().add(...wrapSolInstructions(owner, lamports));
  tx.feePayer = owner;
  return tx;
}

/** Devnet faucet. Throws with a readable message when rate limited. */
export async function requestAirdrop(owner: PublicKey): Promise<string> {
  const sig = await connection.requestAirdrop(owner, FAUCET_LAMPORTS);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
