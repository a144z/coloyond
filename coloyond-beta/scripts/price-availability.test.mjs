import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUsableQuotesFor, isUsablePriceEntry, priceBookStatus } from '../src/lib/solana/price-availability.js';

test('accepts a usable quote whose observation is older than the former 90-second cutoff', () => {
  const oldBook = {
    observedAt: Date.now() - 24 * 60 * 60 * 1000,
    entries: { wsol: { usd: 146.25, source: 'coinbase' } },
  };

  assert.equal(priceBookStatus(oldBook), 'available');
  assert.equal(isUsablePriceEntry(oldBook.entries.wsol), true);
  assert.equal(hasUsableQuotesFor(oldBook, ['wsol']), true);
});

test('missing books, missing entries, and unusable values stay unavailable', () => {
  assert.equal(priceBookStatus(null), 'unavailable');
  assert.equal(priceBookStatus({ observedAt: Date.now(), entries: {} }), 'unavailable');
  assert.equal(priceBookStatus({ observedAt: Date.now(), entries: { wsol: null } }), 'unavailable');
  assert.equal(hasUsableQuotesFor(null, ['wsol']), false);
  assert.equal(hasUsableQuotesFor({ observedAt: Date.now(), entries: { wsol: null } }, ['wsol']), false);
  for (const usd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isUsablePriceEntry({ usd, source: 'coinbase' }), false);
  }
});
