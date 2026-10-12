import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';

/**
 * The tradable asset universe.
 *
 * Devnet portfolios use ordinary SPL token accounts. Devnet USD is a
 * program-issued synthetic test asset with a fixed $1 accounting price; it
 * has no real-dollar backing or redemption value.
 *
 * Segment colors come from the lacquerboard palette:
 *   petrol #13343B · brass #C66E22 · ink #14171A · iron #384551
 */

export interface AssetSpec {
  id: AssetId;
  symbol: string;
  name: string;
  decimals: number;
  /** Mix-bar segment fill (lacquerboard palette). */
  color: string;
  /** Synthetic test asset issued for the Devnet demo. */
  synthetic: boolean;
  /** Coinbase spot pair for the live mid; null means fixed $1. */
  priceSymbol: string | null;
  /** Binance fallback symbol; null means no fallback. */
  binanceSymbol: string | null;
}

export const ASSET_IDS = ['wsol', 'dusd', 'tbtc', 'teth'] as const;

export type AssetId = (typeof ASSET_IDS)[number];

export const ASSETS: Record<AssetId, AssetSpec> = {
  wsol: {
    id: 'wsol',
    symbol: 'WSOL',
    name: 'Wrapped SOL',
    decimals: 9,
    color: '#13343B',
    synthetic: false,
    priceSymbol: 'SOL-USD',
    binanceSymbol: 'SOLUSDT',
  },
  dusd: {
    id: 'dusd',
    symbol: 'dUSD',
    name: 'Synthetic Devnet USD',
    decimals: 6,
    color: '#C66E22',
    synthetic: true,
    priceSymbol: null,
    binanceSymbol: null,
  },
  tbtc: {
    id: 'tbtc',
    symbol: 'tBTC',
    name: 'Test BTC',
    decimals: 8,
    color: '#14171A',
    synthetic: true,
    priceSymbol: 'BTC-USD',
    binanceSymbol: 'BTCUSDT',
  },
  teth: {
    id: 'teth',
    symbol: 'tETH',
    name: 'Test ETH',
    decimals: 8,
    color: '#384551',
    synthetic: true,
    priceSymbol: 'ETH-USD',
    binanceSymbol: 'ETHUSDT',
  },
};

export function isAssetId(x: string): x is AssetId {
  return (ASSET_IDS as readonly string[]).includes(x);
}

export function assetSpec(id: string): AssetSpec {
  if (!isAssetId(id)) throw new Error(`unknown asset id: ${id}`);
  return ASSETS[id];
}

export function assetList(): AssetSpec[] {
  return ASSET_IDS.map((id) => ASSETS[id]);
}

/** Synthetic mint ids, in registry order. Keep in sync with scripts/generate-demo-keys.mjs. */
export const SYNTHETIC_ASSET_IDS: AssetId[] = ASSET_IDS.filter((id) => ASSETS[id].synthetic);

// Public devnet mint addresses only. Mint and reserve secret keys belong in
// local bootstrap tooling and are never imported into the browser bundle.
const SYNTHETIC_MINTS: Partial<Record<AssetId, string>> = {
  dusd: 'DQZn9b9uNUZdE3AJoGoZ9hmC2NzaWxTZRo4gnNLzyuSv',
  tbtc: '2VnSReFZw6pXAsANhSNFqwjqiEd22ihSehLY6RVXXy8M',
  teth: '5zPzxpfy9bBvhXDQ4cwQGY2zX97RwrrUkadK186HXZSX',
};

export function mintOf(id: AssetId): PublicKey {
  const spec = ASSETS[id];
  if (!spec.synthetic) return NATIVE_MINT;
  const address = SYNTHETIC_MINTS[id];
  if (!address) throw new Error(`devnet mint address for "${id}" is missing`);
  return new PublicKey(address);
}

export function mintToAssetMap(): Map<string, AssetId> {
  return new Map(ASSET_IDS.map((id) => [mintOf(id).toBase58(), id]));
}

export function emptyTokens(): Record<AssetId, number> {
  return Object.fromEntries(ASSET_IDS.map((id) => [id, 0])) as Record<AssetId, number>;
}
