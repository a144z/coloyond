import { Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { keysJson } from './demo-keys';
import type { UniverseAsset } from './coinbase';

/**
 * The tradable asset universe, in two tiers sharing one registry:
 *
 *   - Core assets ship with the devnet demo (pre-generated mint keys):
 *     WSOL plus the synthetic stand-ins tUSD, tBTC and tETH.
 *   - The Coinbase universe joins at runtime: every crypto asset listed on
 *     Coinbase with a live USD market. Each becomes a devnet stand-in of its
 *     own — decimals 8, mint address derived deterministically from the
 *     reserve secret so every device agrees without shipping per-asset keys.
 *
 * Every portfolio is a mix of these assets, quoted pairwise against the
 * funded devnet reserve. Real market assets (WSOL) come with a live price;
 * synthetic ones ("t"-prefixed and the extended universe) are devnet
 * stand-ins whose *price* is real (or fixed $1 for tUSD) while their *supply*
 * is minted by the reserve.
 *
 * Segment colors: a curated lacquerboard palette — distinct, muted hues with
 * consistent contrast against the light pulp/ledger backgrounds. Core assets
 * use hand-picked colors; extended assets draw from the same palette pool.
 */

export interface AssetSpec {
  id: AssetId;
  symbol: string;
  name: string;
  decimals: number;
  /** Mix-bar segment fill (lacquerboard palette). */
  color: string;
  /** Synthetic devnet asset: the reserve holds its mint authority. */
  synthetic: boolean;
  /** Ships with the demo keys (true) or joined from the Coinbase universe (false). */
  core: boolean;
  /** Coinbase spot pair for the live mid; null means fixed $1. */
  priceSymbol: string | null;
  /** Binance fallback symbol; null means no fallback. */
  binanceSymbol: string | null;
}

/** Core asset ids, in registry order. Keep in sync with scripts/generate-demo-keys.mjs. */
export const ASSET_IDS = ['wsol', 'tusd', 'tbtc', 'teth'] as const;

type CoreAssetId = (typeof ASSET_IDS)[number];

/** Any registered asset id: a core id or a lowercase Coinbase currency id. */
export type AssetId = string;

/* ---------------- asset color palette ---------------- */

/**
 * Curated lacquerboard palette: twelve muted, well-separated hues.
 * All colors target ≥ 3.5:1 contrast ratio against the ledger background
 * (#FAF8F2) for clear visibility as mix-bar segments and asset swatches.
 * The palette spans the hue wheel so assets remain distinguishable even
 * in portfolios with many positions.
 */
const ASSET_PALETTE = [
  '#0B7A75', // teal
  '#C98A14', // gold
  '#B85A28', // terracotta
  '#5B48B2', // indigo
  '#2E7D52', // forest
  '#BF4B6B', // rose
  '#6A7FA8', // slate
  '#7B8B3A', // olive
  '#9B6B8E', // plum
  '#4A82B0', // steel
  '#A0724A', // copper
  '#6B8E6E', // sage
] as const;

export const ASSETS: Record<CoreAssetId, AssetSpec> = {
  wsol: {
    id: 'wsol',
    symbol: 'WSOL',
    name: 'Wrapped SOL',
    decimals: 9,
    color: '#0B7A75',
    synthetic: false,
    core: true,
    priceSymbol: 'SOL-USD',
    binanceSymbol: 'SOLUSDT',
  },
  tusd: {
    id: 'tusd',
    symbol: 'tUSD',
    name: 'Test USD',
    decimals: 6,
    color: '#C98A14',
    synthetic: true,
    core: true,
    priceSymbol: null,
    binanceSymbol: null,
  },
  tbtc: {
    id: 'tbtc',
    symbol: 'tBTC',
    name: 'Test BTC',
    decimals: 8,
    color: '#B85A28',
    synthetic: true,
    core: true,
    priceSymbol: 'BTC-USD',
    binanceSymbol: 'BTCUSDT',
  },
  teth: {
    id: 'teth',
    symbol: 'tETH',
    name: 'Test ETH',
    decimals: 8,
    color: '#5B48B2',
    synthetic: true,
    core: true,
    priceSymbol: 'ETH-USD',
    binanceSymbol: 'ETHUSDT',
  },
};

/* ---------------- extended registry (live Coinbase universe) ---------------- */

const EXTENDED_ASSETS = new Map<string, AssetSpec>();
let extendedCache: AssetSpec[] = [];

/** Join Coinbase-listed assets into the registry. Idempotent; returns how many were new. */
export function registerCoinbaseAssets(assets: UniverseAsset[]): number {
  let added = 0;
  for (const a of assets) {
    if (isCoreAssetId(a.id) || EXTENDED_ASSETS.has(a.id)) continue;
    EXTENDED_ASSETS.set(a.id, {
      id: a.id,
      symbol: a.symbol,
      name: a.name,
      decimals: 8,
      color: extendedColor(a.id),
      synthetic: true,
      core: false,
      priceSymbol: `${a.id.toUpperCase()}-USD`,
      binanceSymbol: null,
    });
    added += 1;
  }
  if (added > 0) {
    extendedCache = [...EXTENDED_ASSETS.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  return added;
}

/** Deterministic palette color per asset id — draws from the curated lacquerboard palette. */
function extendedColor(id: string): string {
  let h = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ASSET_PALETTE[h % ASSET_PALETTE.length];
}

/* ---------------- registry lookups ---------------- */

export function isCoreAssetId(x: string): x is CoreAssetId {
  return (ASSET_IDS as readonly string[]).includes(x);
}

/** True when the id resolves in either tier. Unknown ids render as placeholders, never crash. */
export function knownAsset(id: string): boolean {
  return isCoreAssetId(id) || EXTENDED_ASSETS.has(id);
}

export function assetSpec(id: string): AssetSpec {
  const core = isCoreAssetId(id) ? ASSETS[id] : undefined;
  if (core) return core;
  const ext = EXTENDED_ASSETS.get(id);
  if (ext) return ext;
  return {
    id,
    symbol: (id || '?').toUpperCase().slice(0, 6),
    name: 'Unregistered asset',
    decimals: 8,
    color: ASSET_PALETTE[6], // slate — neutral fallback
    synthetic: true,
    core: false,
    priceSymbol: null,
    binanceSymbol: null,
  };
}

/** Core assets in registry order, then the Coinbase universe alphabetically. */
export function assetList(): AssetSpec[] {
  return [...ASSET_IDS.map((id) => ASSETS[id]), ...extendedCache];
}

/** Core synthetic mint ids, in registry order. Keep in sync with scripts/generate-demo-keys.mjs. */
export const SYNTHETIC_ASSET_IDS: AssetId[] = ASSET_IDS.filter((id) => ASSETS[id].synthetic);

/* ---------------- mints ---------------- */

const mintKeypairCache = new Map<string, Keypair>();

/**
 * Deterministic devnet stand-in mint for an extended asset: 32 bytes mixed
 * from the reserve secret + asset id, so every device derives the same mint
 * address without shipping per-asset keys. Devnet-only by construction.
 */
export function extendedMintKeypair(id: string): Keypair {
  let kp = mintKeypairCache.get(id);
  if (kp) return kp;
  if (!keysJson.reserveSecretB58) {
    throw new Error(`demo reserve keys are missing. Run: npm run bootstrap:reserve`);
  }
  const material = `${keysJson.reserveSecretB58}::coloyond-mint::${id}`;
  const seed = new Uint8Array(32);
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let round = 0; round < 32; round += 1) {
    for (let i = 0; i < material.length; i += 1) {
      const c = material.charCodeAt(i);
      h1 = Math.imul(h1 ^ (c + round), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c * (i + 1), 0x9e3779b1) >>> 0;
      h1 = (h1 ^ (h1 >>> 13)) >>> 0;
      h2 = (h2 ^ (h2 >>> 7)) >>> 0;
    }
    seed[round] = (h1 ^ h2) & 0xff;
    h1 = (h1 + 0x165667b1) >>> 0;
    h2 = (h2 ^ 0x85ebca6b) >>> 0;
  }
  kp = Keypair.fromSeed(seed);
  mintKeypairCache.set(id, kp);
  return kp;
}

export function mintOf(id: AssetId): PublicKey {
  const spec = assetSpec(id);
  if (!spec.synthetic) return NATIVE_MINT;
  if (spec.core) {
    const mk = keysJson.mints?.[id];
    if (!mk?.address) {
      throw new Error(`demo mint keys for "${id}" are missing. Run: npm run bootstrap:reserve`);
    }
    return new PublicKey(mk.address);
  }
  if (!knownAsset(id)) throw new Error(`unknown asset id: ${id}`);
  return extendedMintKeypair(id).publicKey;
}

export function mintToAssetMap(): Map<string, AssetId> {
  return new Map(assetList().map((s) => [mintOf(s.id).toBase58(), s.id]));
}

export function emptyTokens(): Record<AssetId, number> {
  return Object.fromEntries(assetList().map((s) => [s.id, 0])) as Record<AssetId, number>;
}
