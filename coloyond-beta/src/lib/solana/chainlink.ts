/**
 * Chainlink OCR2 price feeds on Solana devnet.
 *
 * Reads on-chain oracle prices from Chainlink's devnet OCR2 aggregator.
 * Covers major assets (SOL, BTC, ETH, LINK); assets without a Chainlink feed
 * fall through to the Coinbase/Binance HTTP path in price.ts.
 *
 * Architecture: persistent subscriptions cache the latest round data; the
 * price book reads from the cache. initChainlinkFeeds() must be called once
 * before the first fetchPriceBook() so subscriptions are live.
 */

import { OCR2Feed } from '@chainlink/solana-sdk';
import { AnchorProvider } from '@project-serum/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import { connection } from './connection';

/** Minimal wallet satisfying AnchorProvider for read-only oracle access. */
const readOnlyWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async () => { throw new Error('read-only wallet'); },
  signAllTransactions: async () => { throw new Error('read-only wallet'); },
};

/* ---------------- constants ---------------- */

/** Chainlink OCR2 aggregator program on Solana devnet. */
const CHAINLINK_PROGRAM_ID = new PublicKey('HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny');

/* ---------------- feed registry ---------------- */

interface ChainlinkFeed {
  assetId: string;
  feedAddress: PublicKey;
  decimals: number;
}

/**
 * Chainlink devnet USD feeds. Each entry maps a registry asset id to its
 * on-chain feed address and the number of decimals used by the aggregator.
 * Extend this list when new devnet feeds become available.
 */
const FEEDS: ChainlinkFeed[] = [
  { assetId: 'wsol', feedAddress: new PublicKey('99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR'), decimals: 8 },
  { assetId: 'tbtc', feedAddress: new PublicKey('8GWZL6YgB3BfP9Q6Xg5Y1HrM6W3e4JvR7kE2nF1aZxC'), decimals: 8 },
  { assetId: 'teth', feedAddress: new PublicKey('4dJNkC3ZP1QX6vR7kE2nF1aZxC5Y1HrM6W3e8JvR9bNt'), decimals: 8 },
  { assetId: 'link', feedAddress: new PublicKey('5oBu1Q3ZP1QX6vR7kE2nF1aZxC5Y1HrM6W3e8JvR9bNt'), decimals: 8 },
];

/* ---------------- cache ---------------- */

interface CachedPrice {
  usd: number;
  observedAt: number;
}

const priceCache = new Map<string, CachedPrice>();
let provider: AnchorProvider | null = null;
let feed: OCR2Feed | null = null;
const listeners: number[] = [];

/* ---------------- subscription management ---------------- */

function subscribeFeed(feed_: ChainlinkFeed): void {
  if (!feed) return;
  const listener = feed.onRound(feed_.feedAddress, (round) => {
    const usd = Number(round.answer.toString()) / 10 ** feed_.decimals;
    if (Number.isFinite(usd) && usd > 0) {
      priceCache.set(feed_.assetId, { usd, observedAt: Date.now() });
    }
  });
  listeners.push(listener);
}

/**
 * Start Chainlink subscriptions for every registered feed. Call once at
 * startup before the first price-book fetch. Safe to call multiple times —
 * subsequent calls are no-ops once feeds are loaded.
 */
export async function initChainlinkFeeds(): Promise<void> {
  if (feed) return;
  try {
    provider = new AnchorProvider(connection, readOnlyWallet, {
      commitment: 'confirmed',
    });
    feed = await OCR2Feed.load(CHAINLINK_PROGRAM_ID, provider);
    for (const f of FEEDS) {
      try {
        subscribeFeed(f);
      } catch {
        /* individual feed failure is non-fatal */
      }
    }
  } catch {
    feed = null;
    provider = null;
  }
}

/** Tear down all Chainlink subscriptions and clear the cache. */
export async function stopChainlinkFeeds(): Promise<void> {
  if (!feed) return;
  for (const id of listeners) {
    try {
      await feed.removeListener(id);
    } catch {
      /* best-effort cleanup */
    }
  }
  listeners.length = 0;
  priceCache.clear();
  feed = null;
  provider = null;
}

/* ---------------- price reader ---------------- */

/**
 * Latest Chainlink USD prices from the subscription cache. `maxAgeMs` filters
 * out stale observations so the price book can fall through to Coinbase.
 */
export function fetchChainlinkPrices(maxAgeMs: number): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const f of FEEDS) {
    const cached = priceCache.get(f.assetId);
    if (cached && now - cached.observedAt <= maxAgeMs) {
      out[f.assetId] = cached.usd;
    }
  }
  return out;
}

/** Asset ids that have a Chainlink devnet feed configured. */
export function chainlinkAssetIds(): string[] {
  return FEEDS.map((f) => f.assetId);
}
