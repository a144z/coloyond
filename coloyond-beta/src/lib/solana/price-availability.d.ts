export interface PriceEntryLike {
  usd: number;
}

export interface PriceBookLike {
  observedAt: number;
  entries: Record<string, PriceEntryLike | null>;
}

export function isUsablePriceEntry(entry: PriceEntryLike | null | undefined): entry is PriceEntryLike;
export function priceBookStatus(book: PriceBookLike | null, maxAgeMs: number, now?: number): 'fresh' | 'stale' | 'unavailable';
export function hasUsableQuotesFor(book: PriceBookLike | null, assetIds: string[], maxAgeMs: number, now?: number): boolean;
