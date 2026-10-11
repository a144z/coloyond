import { assetList } from './assets';

/**
 * The price book: one live observation covering every tradable asset.
 *
 * The product design requires a real observation with an age limit:
 * "The required price is older than the configured limit. Automation cannot
 * exchange tokens using that observation."
 *
 * Per asset: Coinbase spot is primary (CORS-open, US reachable), Binance
 * spot ticker is the fallback. tUSD is fixed $1 (synthetic dollar). If both
 * feeds fail for an asset, its entry is null and any trade involving it is
 * blocked by design.
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
  const entries = await Promise.all(
    specs.map(async (spec) => {
      if (spec.priceSymbol === null) {
        return [spec.id, { usd: 1, source: 'fixed' as const }] as const;
      }
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
