import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  mintTo,
} from '@solana/spl-token';
import { base58 } from '@scure/base';
import { connection } from './connection';
import { assertDemoKeys, keysJson } from './demo-keys';
import { SYNTHETIC_ASSET_IDS, assetList, assetSpec, mintOf, type AssetId } from './assets';
import {
  CURVE_BASE_PCT,
  CURVE_CAP_PCT,
  CURVE_DEPTH_FRACTION,
  RESERVE_SPREAD_PCT,
} from './config';
import { signSendConfirm, type TxResult } from './tx';
import { fetchBalances, wrapSolInstructions, type Balances } from './wallet';

/**
 * The funded test reserve: the demo counterparty for every asset pair.
 *
 * This is the web-app stand-in for the product's on-chain design, where a
 * program-held reserve would quote against owner-signed bounds. The reserve
 * keypair ships with the devnet demo so swaps are real, atomic, on-chain
 * transactions. It holds no mainnet value and must be replaced by a backend
 * service outside devnet.
 *
 * Pricing model (disclosed in the UI), per pair:
 *   effective rate = mids * (1 - spread - curve)
 *   spread = 0.30% flat (the reserve spread from the design sheet)
 *   curve  = 0.30% * (trade value / (10% of total reserve depth)), capped at 3.00%
 * Depth values every asset's inventory at live prices, so a deep tBTC book
 * also softens the curve on WSOL -> tUSD trades.
 */

export type ReserveState = Balances;

export interface SwapQuote {
  inAsset: AssetId;
  outAsset: AssetId;
  inRaw: number;
  outRaw: number;
  inUsd: number;
  outUsd: number;
  /** outAsset per 1 inAsset after fees (e.g. tUSD per WSOL). */
  effectivePrice: number;
  spreadPct: number;
  curvePct: number;
  totalFeePct: number;
  reserveInRaw: number;
  reserveOutRaw: number;
}

export class ReserveInventoryError extends Error {
  constructor(needed: string, available: string) {
    super(`reserve inventory insufficient: needs ${needed}, holds ${available}`);
    this.name = 'ReserveInventoryError';
  }
}

let reserveKeyCache: Keypair | null = null;
const mintKeyCache = new Map<string, Keypair>();

export function reserveKeypair(): Keypair {
  assertDemoKeys();
  if (!reserveKeyCache) reserveKeyCache = Keypair.fromSecretKey(base58.decode(keysJson.reserveSecretB58));
  return reserveKeyCache;
}

export function mintKeypair(id: AssetId): Keypair {
  assertDemoKeys();
  let kp = mintKeyCache.get(id);
  if (!kp) {
    const mk = keysJson.mints[id];
    kp = Keypair.fromSecretKey(base58.decode(mk.secretB58));
    mintKeyCache.set(id, kp);
  }
  return kp;
}

export function reserveAta(id: AssetId): PublicKey {
  return getAssociatedTokenAddressSync(mintOf(id), reserveKeypair().publicKey);
}

export async function fetchReserveState(): Promise<ReserveState> {
  return fetchBalances(reserveKeypair().publicKey);
}

function fmtRaw(raw: number, decimals: number): string {
  return (raw / 10 ** decimals).toFixed(decimals === 6 ? 2 : 6);
}

/** Total USD value of the reserve's inventory at the given prices. */
export function reserveDepthUsd(reserve: ReserveState, prices: Record<string, number>): number {
  let depth = 0;
  for (const spec of assetList()) {
    const price = prices[spec.id];
    const raw = reserve.tokens[spec.id] ?? 0;
    if (price) depth += (raw / 10 ** spec.decimals) * price;
  }
  return depth;
}

export function quoteSwap(params: {
  inAsset: AssetId;
  outAsset: AssetId;
  inRaw: number;
  prices: Record<string, number>;
  reserve: ReserveState;
}): SwapQuote {
  const { inAsset, outAsset, inRaw, prices, reserve } = params;
  if (inAsset === outAsset) throw new Error('cannot swap an asset into itself');
  if (inRaw <= 0) throw new Error('swap amount must be positive');

  const inSpec = assetSpec(inAsset);
  const outSpec = assetSpec(outAsset);
  const inPrice = prices[inAsset];
  const outPrice = prices[outAsset];
  if (!inPrice || !outPrice) {
    throw new Error(`missing live price for ${inSpec.symbol} or ${outSpec.symbol}`);
  }

  const inUsd = (inRaw / 10 ** inSpec.decimals) * inPrice;
  const depth = reserveDepthUsd(reserve, prices);

  const curvePct =
    depth > 0
      ? Math.min(CURVE_CAP_PCT, (CURVE_BASE_PCT * inUsd) / (depth * CURVE_DEPTH_FRACTION))
      : CURVE_CAP_PCT;
  const totalFeePct = RESERVE_SPREAD_PCT + curvePct;
  const outUsd = inUsd * (1 - totalFeePct / 100);
  const outRaw = Math.floor((outUsd / outPrice) * 10 ** outSpec.decimals);

  const reserveOutRaw = reserve.tokens[outAsset] ?? 0;
  if (outRaw > reserveOutRaw) {
    throw new ReserveInventoryError(
      `${fmtRaw(outRaw, outSpec.decimals)} ${outSpec.symbol} out`,
      `${fmtRaw(reserveOutRaw, outSpec.decimals)} ${outSpec.symbol}`,
    );
  }

  const inUnits = inRaw / 10 ** inSpec.decimals;
  return {
    inAsset,
    outAsset,
    inRaw,
    outRaw,
    inUsd,
    outUsd,
    effectivePrice: inUnits > 0 ? outRaw / 10 ** outSpec.decimals / inUnits : 0,
    spreadPct: RESERVE_SPREAD_PCT,
    curvePct,
    totalFeePct,
    reserveInRaw: reserve.tokens[inAsset] ?? 0,
    reserveOutRaw,
  };
}

/**
 * Atomic swap: one transaction, two token transfers, signed by both the
 * owner (wallet or vault custody key) and the reserve. The owner pays fees.
 * Token accounts on both sides are ensured idempotently in the same tx.
 */
export function buildSwapTransaction(owner: Keypair, quote: SwapQuote): Transaction {
  const reserve = reserveKeypair();
  const inMint = mintOf(quote.inAsset);
  const outMint = mintOf(quote.outAsset);
  const ownerIn = getAssociatedTokenAddressSync(inMint, owner.publicKey);
  const ownerOut = getAssociatedTokenAddressSync(outMint, owner.publicKey);
  const reserveIn = getAssociatedTokenAddressSync(inMint, reserve.publicKey);
  const reserveOut = getAssociatedTokenAddressSync(outMint, reserve.publicKey);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ownerIn, owner.publicKey, inMint),
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ownerOut, owner.publicKey, outMint),
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, reserveIn, reserve.publicKey, inMint),
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, reserveOut, reserve.publicKey, outMint),
    createTransferInstruction(ownerIn, reserveIn, owner.publicKey, quote.inRaw),
    createTransferInstruction(reserveOut, ownerOut, reserve.publicKey, quote.outRaw),
  );

  tx.feePayer = owner.publicKey;
  return tx;
}

export async function executeReserveSwap(params: {
  owner: Keypair;
  inAsset: AssetId;
  outAsset: AssetId;
  inRaw: number;
  prices: Record<string, number>;
}): Promise<{ result: TxResult; quote: SwapQuote }> {
  const reserve = await fetchReserveState();
  const quote = quoteSwap({ ...params, reserve });
  const tx = buildSwapTransaction(params.owner, quote);
  const result = await signSendConfirm(tx, [params.owner, reserveKeypair()]);
  return { result, quote };
}

/** Ensure the reserve's token account for an asset exists (idempotent). */
export async function ensureReserveAta(id: AssetId): Promise<void> {
  const ata = reserveAta(id);
  const info = await connection.getAccountInfo(ata, 'confirmed');
  if (info) return;
  const reserve = reserveKeypair();
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(reserve.publicKey, ata, reserve.publicKey, mintOf(id)),
  );
  tx.feePayer = reserve.publicKey;
  await signSendConfirm(tx, [reserve]);
}

/** Create a synthetic mint at its fixed address if it does not exist yet. Returns true when created. */
export async function ensureMint(id: AssetId): Promise<boolean> {
  const spec = assetSpec(id);
  if (!spec.synthetic) return false;
  const mint = mintKeypair(id);
  const info = await connection.getAccountInfo(mint.publicKey, 'confirmed');
  if (info) return false;

  const reserve = reserveKeypair();
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: reserve.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, spec.decimals, reserve.publicKey, null),
  );
  tx.feePayer = reserve.publicKey;
  await signSendConfirm(tx, [reserve, mint]);
  return true;
}

/** Mint synthetic inventory into the reserve (mint authority = reserve). */
export async function mintToReserve(id: AssetId, raw: number): Promise<string> {
  const reserve = reserveKeypair();
  await ensureReserveAta(id);
  return mintTo(connection, reserve, mintOf(id), reserveAta(id), reserve, raw);
}

/** Wrap reserve SOL into its own WSOL inventory. */
export async function wrapReserveSol(lamports: number): Promise<TxResult> {
  const reserve = reserveKeypair();
  const tx = new Transaction().add(...wrapSolInstructions(reserve.publicKey, lamports));
  tx.feePayer = reserve.publicKey;
  return signSendConfirm(tx, [reserve]);
}

export interface BootstrapReport {
  createdMints: AssetId[];
  solLamports: number;
  tokens: Record<AssetId, number>;
  airdrops: number;
  notes: string[];
}

/**
 * Fund the reserve across all assets: airdrop SOL (devnet faucet, rate
 * limited), wrap the WSOL target, create every missing synthetic mint and
 * mint its inventory target. Idempotent — tops up whatever is missing.
 */
export async function bootstrapReserve(opts: {
  targets: Partial<Record<AssetId, number>>;
}): Promise<BootstrapReport> {
  const notes: string[] = [];
  let airdrops = 0;
  const createdMints: AssetId[] = [];

  const reserve = reserveKeypair();
  const rentBuffer = 30_000_000; // 3 mints + 3 ATAs rent + fees + buffer
  const neededSol = (opts.targets.wsol ?? 0) + rentBuffer;

  let sol = await connection.getBalance(reserve.publicKey, 'confirmed');
  while (sol < neededSol && airdrops < 6) {
    try {
      const sig = await connection.requestAirdrop(reserve.publicKey, 1_000_000_000);
      await connection.confirmTransaction(sig, 'confirmed');
      airdrops += 1;
      sol = await connection.getBalance(reserve.publicKey, 'confirmed');
    } catch (err) {
      notes.push(
        `devnet faucet declined (${err instanceof Error ? err.message.slice(0, 80) : 'rate limit'}). funded so far: ${(sol / 1e9).toFixed(3)} SOL. retry later or top up ${reserve.publicKey.toBase58()} manually.`,
      );
      break;
    }
  }

  // synthetic mints first (rent comes out of the same SOL)
  for (const id of SYNTHETIC_ASSET_IDS) {
    if ((opts.targets[id] ?? 0) <= 0) continue;
    if (await ensureMint(id)) createdMints.push(id);
  }

  const state = await fetchReserveState();
  const tokens = { ...state.tokens };

  // WSOL inventory
  const wsolTarget = opts.targets.wsol ?? 0;
  const wrapNeeded = wsolTarget - (tokens.wsol ?? 0);
  if (wrapNeeded > 0 && sol > wrapNeeded + 10_000_000) {
    await wrapReserveSol(wrapNeeded);
    tokens.wsol = (tokens.wsol ?? 0) + wrapNeeded;
    sol -= wrapNeeded;
  } else if (wrapNeeded > 0) {
    notes.push(`insufficient SOL to reach target WSOL inventory. short by ${(wrapNeeded / 1e9).toFixed(3)} SOL.`);
  }

  // synthetic inventories
  for (const id of SYNTHETIC_ASSET_IDS) {
    const target = opts.targets[id] ?? 0;
    const have = tokens[id] ?? 0;
    const mintNeeded = target - have;
    if (mintNeeded > 0) {
      await mintToReserve(id, mintNeeded);
      tokens[id] = have + mintNeeded;
    }
  }

  const finalSol = await connection.getBalance(reserve.publicKey, 'confirmed');
  return { createdMints, solLamports: finalSol, tokens, airdrops, notes };
}
