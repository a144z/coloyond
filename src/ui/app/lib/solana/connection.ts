import { Connection } from '@solana/web3.js';
import { CLUSTER, ER_RPC_URL, RPC_URL } from './config.js';

/* ---------------- rate-limited fetch for Solana RPC ----------------
 * Devnet rate limits (per IP):
 *   - 100 requests / 10 s  (global)
 *   -  40 requests / 10 s  (per single RPC method)
 *   -  40 concurrent connections
 *   -  40 new connections / 10 s
 *
 * We wrap global fetch so only RPC_URL requests are throttled; everything
 * else (Coinbase, Binance) passes through untouched.
 *
 * Strategy:
 *   1. Sliding-window rate limiter: max 80 dispatches in any 10 s window
 *      (20 % headroom under the 100 hard cap).
 *   2. Concurrency semaphore: max 4 in-flight at once (well under the 40
 *      concurrent-connection cap).
 *   3. 429 retry with exponential backoff as a safety net — if we somehow
 *      still get rate-limited, we back off 500 ms → 1 s → 2 s + jitter.
 */

const RPC_WINDOW_MS = 10_000;
const RPC_MAX_PER_WINDOW = 80;          // 100 limit − 20 % headroom
const RPC_MAX_CONCURRENT = 4;
const RPC_MAX_RETRIES = 3;
const RPC_BASE_DELAY_MS = 500;

/* sliding window: timestamps of every dispatch in the current 10 s */
const rpcDispatches: number[] = [];

/* concurrency semaphore */
let rpcActive = 0;
const rpcWaiters: (() => void)[] = [];

function rpcDrain(): void {
  while (rpcActive < RPC_MAX_CONCURRENT && rpcWaiters.length > 0) {
    const next = rpcWaiters.shift()!;
    next();
  }
}

/** Wait until both the concurrency slot and the sliding-window budget allow. */
function rpcAcquire(): Promise<void> {
  return new Promise<void>((resolve) => {
    const tryAcquire = (): void => {
      const now = Date.now();
      // evict timestamps older than the 10 s window
      while (rpcDispatches.length > 0 && rpcDispatches[0] <= now - RPC_WINDOW_MS) {
        rpcDispatches.shift();
      }
      if (rpcDispatches.length >= RPC_MAX_PER_WINDOW) {
        // window full — retry when the oldest entry expires
        const waitMs = rpcDispatches[0] + RPC_WINDOW_MS - now + 10;
        setTimeout(tryAcquire, waitMs);
        return;
      }
      if (rpcActive >= RPC_MAX_CONCURRENT) {
        rpcWaiters.push(tryAcquire);
        return;
      }
      // acquired
      rpcDispatches.push(now);
      rpcActive++;
      resolve();
    };
    tryAcquire();
  });
}

function rpcRelease(): void {
  rpcActive--;
  rpcDrain();
}

async function rpcFetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt++) {
    const res = await _origFetch(url, init);
    if (res.status !== 429 || attempt === RPC_MAX_RETRIES) return res;
    // consume the error body so the socket can be reused
    await res.body?.cancel().catch(() => {});
    const delay = RPC_BASE_DELAY_MS * 2 ** attempt + Math.random() * 200;
    await new Promise((r) => setTimeout(r, delay));
  }
  // unreachable, but satisfies the type checker
  return new Response('', { status: 500 });
}

const _origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function coloyondFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(RPC_URL)) return _origFetch(input, init);

  await rpcAcquire();
  try {
    return await rpcFetchWithRetry(url, init ?? {});
  } finally {
    rpcRelease();
  }
};

/* ---------------- connection + helpers ---------------- */

export const connection = new Connection(RPC_URL, 'confirmed');
export const ephemeralConnection = new Connection(ER_RPC_URL, 'confirmed');

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`;
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
}

export interface RpcStatus {
  slot: number;
  pingMs: number;
  at: number;
}

export async function fetchRpcStatus(): Promise<RpcStatus> {
  const t0 = performance.now();
  const slot = await connection.getSlot('confirmed');
  return { slot, pingMs: Math.round(performance.now() - t0), at: Date.now() };
}
