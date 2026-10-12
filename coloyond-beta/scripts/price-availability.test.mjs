import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUsableQuotesFor, isUsablePriceEntry, priceBookStatus } from '../src/lib/solana/price-availability.js';

test('age-gates old Coinbase/Binance display quotes without representing Pyth execution policy', () => {
  const now = 1_800_000_000_000;
  const oldBook = {
    observedAt: now - 90_001,
    entries: { wsol: { usd: 146.25, source: 'coinbase' } },
  };

  assert.equal(priceBookStatus(oldBook, 90_000, now), 'stale');
  assert.equal(isUsablePriceEntry(oldBook.entries.wsol), true);
  assert.equal(hasUsableQuotesFor(oldBook, ['wsol'], 90_000, now), false);

  const recentBook = { ...oldBook, observedAt: now - 20_000 };
  assert.equal(priceBookStatus(recentBook, 90_000, now), 'fresh');
  assert.equal(hasUsableQuotesFor(recentBook, ['wsol'], 90_000, now), true);
});

test('missing books, missing entries, and unusable values stay unavailable', () => {
  const now = 1_800_000_000_000;
  assert.equal(priceBookStatus(null, 90_000, now), 'unavailable');
  assert.equal(priceBookStatus({ observedAt: now, entries: {} }, 90_000, now), 'unavailable');
  assert.equal(priceBookStatus({ observedAt: now, entries: { wsol: null } }, 90_000, now), 'unavailable');
  assert.equal(hasUsableQuotesFor(null, ['wsol'], 90_000, now), false);
  assert.equal(hasUsableQuotesFor({ observedAt: now, entries: { wsol: null } }, ['wsol'], 90_000, now), false);
  for (const usd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isUsablePriceEntry({ usd, source: 'coinbase' }), false);
  }
});
