import { useStore } from './store.js';
import { PRICE_POLL_MS, BALANCE_POLL_MS, RESERVE_POLL_MS, RPC_POLL_MS } from './solana/config.js';

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastPriceFetch = 0;
let lastBalanceFetch = 0;
let lastReserveFetch = 0;
let lastRpcFetch = 0;

/** The open app refreshes displays; Hydra runs the independent scheduled task. */
export function ensureScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void refreshDashboard(), 10_000);
  void refreshDashboard();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function refreshDashboard(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const store = useStore.getState();
    const now = Date.now();
    if (now - lastPriceFetch >= PRICE_POLL_MS) { lastPriceFetch = now; void store.refreshPrice(); }
    if (now - lastRpcFetch >= RPC_POLL_MS) { lastRpcFetch = now; void store.refreshRpc(); }
    if (now - lastBalanceFetch >= BALANCE_POLL_MS) {
      lastBalanceFetch = now;
      void store.refreshBalances();
      for (const vault of store.vaults) if (!vault.legacy) void store.refreshVaultBalances(vault.id);
    }
    if (now - lastReserveFetch >= RESERVE_POLL_MS) { lastReserveFetch = now; void store.refreshReserve(); }
  } catch (error) {
    console.warn('[coloyond] dashboard refresh failed:', error);
  } finally {
    ticking = false;
  }
}
