/** @typedef {{ usd: number, source: 'coinbase' | 'binance' | 'fixed' }} PriceEntry */
/** @typedef {{ observedAt: number, entries: Record<string, PriceEntry | null> }} PriceBook */

/** A display quote is usable when it is present and finite positive. */
export function isUsablePriceEntry(entry) {
  return Boolean(entry && Number.isFinite(entry.usd) && entry.usd > 0);
}

/** Display-book availability depends on usable quotes, never on quote age. */
export function priceBookStatus(book) {
  if (!book || !book.entries) return 'unavailable';
  return Object.values(book.entries).some(isUsablePriceEntry) ? 'available' : 'unavailable';
}

/** Every requested display quote is usable, regardless of observation age. */
export function hasUsableQuotesFor(book, assetIds) {
  return Boolean(book && book.entries && assetIds.every((id) => isUsablePriceEntry(book.entries[id])));
}
