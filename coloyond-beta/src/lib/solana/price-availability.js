/** @typedef {{ usd: number, source: 'coinbase' | 'binance' | 'fixed' }} PriceEntry */
/** @typedef {{ observedAt: number, entries: Record<string, PriceEntry | null> }} PriceBook */

/** A display quote is usable when it is present and finite positive. */
export function isUsablePriceEntry(entry) {
  return Boolean(entry && Number.isFinite(entry.usd) && entry.usd > 0);
}

/** The display book has its own age limit; this says nothing about Pyth execution. */
export function priceBookStatus(book, maxAgeMs, now = Date.now()) {
  if (!book || !book.entries) return 'unavailable';
  if (!Object.values(book.entries).some(isUsablePriceEntry)) return 'unavailable';
  if (!Number.isFinite(book.observedAt)) return 'unavailable';
  return now - book.observedAt <= maxAgeMs ? 'fresh' : 'stale';
}

/** Display valuation requires usable quotes from a recent display-book fetch. */
export function hasUsableQuotesFor(book, assetIds, maxAgeMs, now = Date.now()) {
  return priceBookStatus(book, maxAgeMs, now) === 'fresh' &&
    assetIds.every((id) => isUsablePriceEntry(book.entries[id]));
}
