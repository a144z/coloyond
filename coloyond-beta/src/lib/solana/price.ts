import { assetList } from './assets';
import { fetchCoinbaseStats } from './coinbase';
import { hasUsableQuotesFor, isUsablePriceEntry, priceBookStatus } from './price-availability.js';

/**
 * The price book: one live observation covering every tradable asset.
 *
 * Per asset: Coinbase spot is primary (CORS-open, US reachable), Binance
 * spot ticker is the fallback. Synthetic Devnet USD is fixed at $1 for demo
 * accounting only and is not backed by redeemable dollars. If both feeds
 * fail for an asset, its entry is null and UI values requiring that asset's
 * display quote are unavailable. On-chain execution uses Pyth.
 */

export type PriceSource = 'coinbase' | 'binance' | 'fixed';

export interface PriceEntry {
  usd: number;
  source: PriceSource;
}

export interface PriceBook {
  observedAt: number;
  entries: Record<string, PriceEntry | null>;
}

export type PriceStatus = 'available' | 'unavailable';

export function priceOf(book: PriceBook | null, assetId: string): number | null {
  if (!book) return null;
  const e = book.entries[assetId];
  return isUsablePriceEntry(e) ? e.usd : null;
}

export function priceEntryOf(book: PriceBook | null, assetId: string): PriceEntry | null {
  if (!book) return null;
  const entry = book.entries[assetId];
  return isUsablePriceEntry(entry) ? entry : null;
}

export function bookStatus(book: PriceBook | null): PriceStatus {
  return priceBookStatus(book);
}

/** Flattened lookup of only the priced assets (missing entries omitted). */
export function pricesFromBook(book: PriceBook | null): Record<string, number> {
  if (!book) return {};
  const out: Record<string, number> = {};
  for (const [id, e] of Object.entries(book.entries)) {
    if (isUsablePriceEntry(e)) out[id] = e.usd;
  }
  return out;
}

/** Every listed asset has a usable display quote. */
export function assetsPriced(book: PriceBook | null, assetIds: string[]): boolean {
  return hasUsableQuotesFor(book, assetIds);
}

export async function fetchPriceBook(): Promise<PriceBook> {
  const observedAt = Date.now();
  const specs = assetList();
  const stats = await fetchCoinbaseStats();
  const entries = await Promise.all(
    specs.map(async (spec) => {
      if (spec.priceSymbol === null) {
        return [spec.id, { usd: 1, source: 'fixed' as const }] as const;
      }
      const batched = stats?.[spec.priceSymbol];
      if (batched !== undefined) return [spec.id, { usd: batched, source: 'coinbase' as const }] as const;
      const e = (await tryCoinbase(spec.priceSymbol)) ?? (spec.binanceSymbol ? await tryBinance(spec.binanceSymbol) : null);
      return [spec.id, e] as const;
    }),
  );
  const discovered = Object.entries(stats ?? {})
    .filter(([pair]) => pair.endsWith('-USD'))
    .map(([pair, usd]) => [pair.slice(0, -4).toLowerCase(), { usd, source: 'coinbase' as const }] as const);
  return {
    observedAt,
    entries: { ...Object.fromEntries(discovered), ...Object.fromEntries(entries) },
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
