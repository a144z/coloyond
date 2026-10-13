import { Connection } from '@solana/web3.js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { CLUSTER, ER_RPC_URL, ROUTER_RPC_URL, RPC_URL } from './config.js';

/* ---------------- rate-limited fetch for Solana RPC ----------------
 * Devnet rate limits (per IP):
 *   - 100 requests / 10 s  (global)
 *   -  40 requests / 10 s  (per single RPC method)
 *   -  40 concurrent connections
 *   -  40 new connections / 10 s
 *
 * We provide a fetch implementation to each Solana Connection. On native
 * Capacitor, RPC requests use the native HTTP bridge because WebView fetch
 * cannot pass the public RPC's CORS preflight. Browser builds use normal fetch.
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

const SOLANA_RPC_ORIGINS = new Set([RPC_URL, ER_RPC_URL, ROUTER_RPC_URL].map((url) => new URL(url).origin));
const DEVNET_RPC_ORIGIN = new URL(RPC_URL).origin;

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

const browserFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function nativeRpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = requestUrl(input);
  const method = init?.method ?? request?.method ?? 'GET';
  const headers = new Headers(request?.headers);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const body = init?.body ?? (request ? await request.clone().text() : undefined);
  if (body !== undefined && body !== null && typeof body !== 'string') {
    throw new Error('Native Solana RPC requests require a serialized string body.');
  }

  const signal = init?.signal ?? request?.signal;
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');

  const nativeRequest = CapacitorHttp.request({
    url,
    method,
    headers: Object.fromEntries(headers.entries()),
    ...(body === undefined || body === null ? {} : { data: body }),
    responseType: 'text',
    connectTimeout: 10_000,
    readTimeout: 15_000,
  });
  const responsePromise = nativeRequest.then((response) => {
    // Capacitor parses JSON content types natively even when text was asked
    // for; stringify that value again to preserve the Fetch Response contract.
    const responseBody = typeof response.data === 'string'
      ? response.data
      : response.data == null ? '' : JSON.stringify(response.data);
    return new Response(responseBody, { status: response.status, headers: response.headers });
  });

  if (!signal) return responsePromise;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      responsePromise,
      new Promise<Response>((_, reject) => {
        abortListener = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        signal.addEventListener('abort', abortListener, { once: true });
      }),
    ]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

async function solanaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  if (!SOLANA_RPC_ORIGINS.has(new URL(url).origin)) return browserFetch(input, init);
  if (Capacitor.isNativePlatform()) return nativeRpcFetch(input, init);
  return browserFetch(input, init);
}

export const rpcFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  if (new URL(url).origin !== DEVNET_RPC_ORIGIN) return solanaFetch(input, init);

  await rpcAcquire();
  try {
    return await rpcFetchWithRetry(input, init);
  } finally {
    rpcRelease();
  }
};

async function rpcFetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt++) {
    const res = await solanaFetch(input, init);
    if (res.status !== 429 || attempt === RPC_MAX_RETRIES) return res;
    // consume the error body so the socket can be reused
    await res.body?.cancel().catch(() => {});
    const delay = RPC_BASE_DELAY_MS * 2 ** attempt + Math.random() * 200;
    await new Promise((r) => setTimeout(r, delay));
  }
  // unreachable, but satisfies the type checker
  return new Response('', { status: 500 });
}

/* ---------------- connection + helpers ---------------- */

export const RPC_CONNECTION_CONFIG = { commitment: 'confirmed' as const, fetch: rpcFetch };
export const connection = new Connection(RPC_URL, RPC_CONNECTION_CONFIG);
export const ephemeralConnection = new Connection(ER_RPC_URL, RPC_CONNECTION_CONFIG);

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
