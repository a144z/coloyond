import { assetList } from './assets';
import { fetchCoinbaseStats } from './coinbase';
import { fetchChainlinkPrices } from './chainlink';
import { PRICE_MAX_AGE_MS } from './config';

/**
 * The price book: one live observation covering every registered asset —
 * the core four and the whole Coinbase universe.
 *
 * The product design requires a real observation with an age limit:
 * "The required price is older than the configured limit. Automation cannot
 * exchange tokens using that observation."
 *
 * Pricing, in order: Chainlink on-chain oracle (devnet OCR2 feeds) for
 * assets with a configured feed; the batched Coinbase Exchange stats call
 * covers every remaining USD pair; the per-asset Coinbase spot endpoint
 * and the Binance spot ticker backfill anything still missing; tUSD is
 * fixed $1 (synthetic dollar). If all feeds fail for an asset, its entry
 * is null and any trade involving it is blocked by design.
 */

export type PriceSource = 'chainlink' | 'coinbase' | 'binance' | 'fixed';

export interface PriceEntry {
  usd: number;
  source: PriceSource;
}

export interface PriceBook {
  observedAt: number;
  entries: Record<string, PriceEntry | null>;
}

export type PriceStatus = 'fresh' | 'stale' | 'unavailable';

export function priceOf(book: PriceBook | null, assetId: string): number | null {
  if (!book) return null;
  const e = book.entries[assetId];
  return e ? e.usd : null;
}

export function priceEntryOf(book: PriceBook | null, assetId: string): PriceEntry | null {
  if (!book) return null;
  return book.entries[assetId] ?? null;
}

export function bookStatus(book: PriceBook | null, maxAgeMs: number): PriceStatus {
  if (!book) return 'unavailable';
  return Date.now() - book.observedAt <= maxAgeMs ? 'fresh' : 'stale';
}

/** Flattened lookup of only the priced assets (missing entries omitted). */
export function pricesFromBook(book: PriceBook | null): Record<string, number> {
  if (!book) return {};
  const out: Record<string, number> = {};
  for (const [id, e] of Object.entries(book.entries)) {
    if (e) out[id] = e.usd;
  }
  return out;
}

/** Fresh book AND every listed asset priced — the precondition for trading. */
export function assetsPriced(book: PriceBook | null, assetIds: string[], maxAgeMs: number): boolean {
  if (bookStatus(book, maxAgeMs) !== 'fresh') return false;
  return assetIds.every((id) => priceOf(book, id) !== null);
}

export async function fetchPriceBook(): Promise<PriceBook> {
  const observedAt = Date.now();
  const specs = assetList();
  const [chainlinkPrices, stats] = await Promise.all([
    Promise.resolve(fetchChainlinkPrices(PRICE_MAX_AGE_MS)),
    fetchCoinbaseStats(),
  ]);
  const entries = await Promise.all(
    specs.map(async (spec) => {
      if (spec.priceSymbol === null) {
        return [spec.id, { usd: 1, source: 'fixed' as const }] as const;
      }
      /* 1st: Chainlink on-chain oracle */
      const clPrice = chainlinkPrices[spec.id];
      if (clPrice !== undefined) {
        return [spec.id, { usd: clPrice, source: 'chainlink' as const }] as const;
      }
      /* 2nd: batched Coinbase Exchange stats */
      const statsMid = stats?.[spec.priceSymbol];
      if (statsMid !== undefined) {
        return [spec.id, { usd: statsMid, source: 'coinbase' as const }] as const;
      }
      /* 3rd: per-asset Coinbase spot → Binance fallback */
      const e = (await tryCoinbase(spec.priceSymbol)) ?? (spec.binanceSymbol ? await tryBinance(spec.binanceSymbol) : null);
      return [spec.id, e] as const;
    }),
  );
  return {
    observedAt,
    entries: Object.fromEntries(entries),
  };
}

async function tryCoinbase(pair: string): Promise<PriceEntry | null> {
  try {
    const res = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { amount?: string } };
    const price = Number(json?.data?.amount);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { usd: price, source: 'coinbase' };
  } catch {
    return null;
  }
}

async function tryBinance(symbol: string): Promise<PriceEntry | null> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { price?: string };
    const price = Number(json?.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { usd: price, source: 'binance' };
  } catch {
    return null;
  }
}
