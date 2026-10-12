/**
 * The Coinbase universe: asset discovery and batched pricing from the
 * public, CORS-open Coinbase Exchange API (no key, devnet-friendly).
 *
 * Two calls drive the extended asset registry:
 *   GET /currencies  — every listed currency (id, name, status, type)
 *   GET /products    — every trading pair (used to require a live USD market)
 *
 * One call prices the whole universe:
 *   GET /products/stats — 24h stats per pair; `stats_24hour.last` is a
 *   full-precision USD mid, keyed 'DOGE-USD' style, ~400 USD pairs in one
 *   response.
 */

/** A Coinbase-listed asset, normalized for the registry. `id` is the lowercase currency code. */
export interface UniverseAsset {
  id: string;
  symbol: string;
  name: string;
}

/**
 * Coinbase assets already represented by the demo's core stand-ins: picking
 * "Bitcoin" uses the tBTC rails, "Solana" wraps into WSOL, the demo dollar
 * covers USDC/USDT/DAI. Kept out of the extended list so the picker never
 * offers two assets with the same price and the same mint.
 */
export const ALIASED_COINBASE_IDS: readonly string[] = ['sol', 'btc', 'eth', 'usdc', 'usdt', 'dai'];

interface CoinbaseCurrency {
  id: string;
  name: string;
  display_name?: string | null;
  status?: string;
  details?: { type?: string } | null;
}

interface CoinbaseProduct {
  id: string;
  base_currency?: string;
  quote_currency?: string;
  status?: string;
}

/** Every online Coinbase crypto asset with an active USD market, sorted by symbol. */
export async function fetchCoinbaseUniverse(): Promise<UniverseAsset[]> {
  const [currencies, products] = await Promise.all([
    fetchJson<CoinbaseCurrency[]>('https://api.exchange.coinbase.com/currencies'),
    fetchJson<CoinbaseProduct[]>('https://api.exchange.coinbase.com/products'),
  ]);

  const usdBases = new Set(
    products
      .filter((p) => p.status === 'online' && p.quote_currency === 'USD')
      .map((p) => (p.base_currency ?? p.id.split('-')[0]).toLowerCase()),
  );

  const universe: UniverseAsset[] = [];
  for (const c of currencies) {
    if (c.status !== 'online') continue;
    if (c.details?.type !== 'crypto') continue;
    const id = c.id.toLowerCase();
    if (!usdBases.has(id) || ALIASED_COINBASE_IDS.includes(id)) continue;
    universe.push({ id, symbol: (c.display_name || c.id).toUpperCase(), name: c.name });
  }
  universe.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return universe;
}

/** One batched call: USD mid per pair for the whole universe, or null when the feed is down. */
export async function fetchCoinbaseStats(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch('https://api.exchange.coinbase.com/products/stats', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, { stats_24hour?: { last?: string } } | undefined>;
    const out: Record<string, number> = {};
    for (const [pair, s] of Object.entries(json)) {
      if (!pair.endsWith('-USD')) continue;
      const last = Number(s?.stats_24hour?.last);
      if (Number.isFinite(last) && last > 0) out[pair] = last;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`coinbase ${url.split('/').pop()} returned ${res.status}`);
  return (await res.json()) as T;
}
