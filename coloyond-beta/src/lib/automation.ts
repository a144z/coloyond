import { useStore, vaultKeypairOf, type VaultConfig } from './store';
import { fetchVaultBalances, computeAssetRows, maxDriftPct, planRebalance } from './solana/vault';
import { executeReserveSwap, ReserveInventoryError, ensureMint, bootstrapReserve } from './solana/reserve';
import { bookStatus, pricesFromBook, priceOf } from './solana/price';
import { SYNTHETIC_ASSET_IDS, assetSpec, type AssetId, type AssetSpec } from './solana/assets';
import { fmtToken } from './format';
import {
  BALANCE_POLL_MS,
  BUDGET_FLOOR_LAMPORTS,
  MAX_TRADES_PER_CHECK,
  PRICE_MAX_AGE_MS,
  PRICE_POLL_MS,
  RESERVE_POLL_MS,
  RPC_POLL_MS,
} from './solana/config';

/**
 * The scheduler: client-side stand-in for MagicBlock's delegated execution
 * in the native design. It runs while the app is open, checks each vault on
 * its cadence, and executes a real devnet swap sequence when drift exceeds
 * the owner-configured threshold. Every check and trade is logged.
 */

const inFlightVaults = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastPriceFetch = 0;
let lastBalanceFetch = 0;
let lastReserveFetch = 0;
let lastRpcFetch = 0;
let infraEnsured = false;

/** Minimum in-app bootstrap targets (raw) when the app is first to run. */
const MINIMUM_RESERVE_TARGETS: Partial<Record<AssetId, number>> = {
  wsol: 1_000_000_000, // 1 WSOL
  tusd: 20_000_000_000, // 20,000 tUSD
  tbtc: 5_000_000, // 0.05 tBTC
  teth: 150_000_000, // 1.5 tETH
};

export function ensureScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), 3000);
  void tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** One owner-authorized immediate check ("run bounded crank"). */
export function runCrank(vaultId: string): void {
  void runVaultCheck(vaultId, true);
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const st = useStore.getState();
    if (!st.wallet) return;

    const now = Date.now();
    if (now - lastPriceFetch >= PRICE_POLL_MS) {
      lastPriceFetch = now;
      void st.refreshPrice();
    }
    if (now - lastRpcFetch >= RPC_POLL_MS) {
      lastRpcFetch = now;
      void st.refreshRpc();
    }
    if (now - lastBalanceFetch >= BALANCE_POLL_MS) {
      lastBalanceFetch = now;
      void st.refreshBalances();
      for (const v of useStore.getState().vaults) {
        if (v.status !== 'closed') void st.refreshVaultBalances(v.id);
      }
    }
    if (now - lastReserveFetch >= RESERVE_POLL_MS) {
      lastReserveFetch = now;
      void st.refreshReserve();
    }

    if (!infraEnsured) {
      infraEnsured = true;
      void ensureInfrastructure();
    }

    for (const v of useStore.getState().vaults) {
      if (v.status !== 'active') continue;
      if ((v.nextCheckAt ?? 0) > Date.now()) continue;
      await runVaultCheck(v.id);
    }
  } catch (err) {
    console.warn('[coloyond] scheduler tick failed:', err);
  } finally {
    ticking = false;
  }
}

/** Lazily create the synthetic mints and a minimum reserve if the app is first to run. */
async function ensureInfrastructure(): Promise<void> {
  const st = useStore.getState();
  if (!st.wallet) return;
  try {
    const created: AssetId[] = [];
    for (const id of SYNTHETIC_ASSET_IDS) {
      if (await ensureMint(id)) created.push(id);
    }
    if (created.length > 0) {
      st.log({
        vaultId: null,
        kind: 'system',
        summary: `Synthetic mints created on devnet (${created.map((id) => assetSpec(id).symbol).join(', ')})`,
      });
      const report = await bootstrapReserve({ targets: MINIMUM_RESERVE_TARGETS });
      st.log({
        vaultId: null,
        kind: 'system',
        summary: 'Demo reserve funded',
        detail: Object.entries(report.tokens)
          .filter(([, raw]) => raw > 0)
          .map(([id, raw]) => `${fmtToken(raw, assetSpec(id as AssetId).decimals)} ${assetSpec(id as AssetId).symbol}`)
          .join(' · ') + ' inventory',
      });
      for (const note of report.notes) {
        st.log({ vaultId: null, kind: 'system', summary: 'Reserve note', detail: note });
      }
    }
    void st.refreshReserve();
  } catch (err) {
    st.log({
      vaultId: null,
      kind: 'system',
      summary: 'Reserve bootstrap failed',
      detail: err instanceof Error ? err.message.slice(0, 180) : 'unknown error',
    });
  }
}

function fmtAmt(raw: number, spec: AssetSpec): string {
  return fmtToken(raw, spec.decimals, spec.decimals === 6 ? 2 : 6);
}

function pctList(rows: { assetId: AssetId; pct: number }[]): string {
  return rows
    .filter((r) => r.pct > 0.05)
    .map((r) => `${r.pct.toFixed(1)} ${assetSpec(r.assetId).symbol}`)
    .join(' / ');
}

function targetList(cfg: VaultConfig): string {
  return cfg.assets
    .filter((id) => (cfg.targets[id] ?? 0) > 0)
    .map((id) => `${(cfg.targets[id] ?? 0).toFixed(0)} ${assetSpec(id).symbol}`)
    .join(' / ');
}

export async function runVaultCheck(vaultId: string, manual = false): Promise<void> {
  if (inFlightVaults.has(vaultId)) return;
  inFlightVaults.add(vaultId);
  const st = useStore.getState();
  try {
    const cfg = st.vaults.find((v) => v.id === vaultId);
    if (!cfg || cfg.status === 'closed') return;
    const kp = vaultKeypairOf(cfg);

    const bal = await fetchVaultBalances(kp);
    useStore.getState().refreshVaultBalances(vaultId);

    const book = useStore.getState().price;
    const status = bookStatus(book, PRICE_MAX_AGE_MS);
    const allAssetsPriced = book !== null && cfg.assets.every((id) => priceOf(book, id) !== null);
    const prefix = manual ? 'Crank: ' : '';

    if (status !== 'fresh' || !allAssetsPriced) {
      applyBlocked(
        vaultId,
        cfg,
        'price',
        `${prefix}price observation unavailable`,
        'Automation cannot trade without a fresh price for every asset in the mix. Holdings stay withdrawable in kind.',
      );
      return;
    }

    if (bal.solLamports < BUDGET_FLOOR_LAMPORTS) {
      applyBlocked(
        vaultId,
        cfg,
        'budget',
        `${prefix}automation budget exhausted`,
        `Vault holds ${bal.solLamports} lamports for fees. Add budget to resume automated trades.`,
      );
      return;
    }

    const prices = pricesFromBook(book);
    const { rows, totalUsd } = computeAssetRows(bal.tokens, prices, cfg.assets);
    if (totalUsd <= 0) {
      applyCheck(vaultId, cfg, `${prefix}vault is empty`, 'Deposit funds to begin automated maintenance.');
      return;
    }

    const drift = maxDriftPct(rows, cfg.targets);
    if (drift <= cfg.thresholdPct) {
      applyCheck(
        vaultId,
        cfg,
        `${prefix}drift ${drift.toFixed(2)}% within threshold ${cfg.thresholdPct.toFixed(1)}%`,
        `actual ${pctList(rows)} · target ${targetList(cfg)}`,
      );
      return;
    }

    const trades = planRebalance(bal.tokens, cfg.targets, prices, MAX_TRADES_PER_CHECK);
    if (trades.length === 0) {
      applyCheck(vaultId, cfg, `${prefix}drift ${drift.toFixed(2)}% but no executable trade`, 'Holdings cap the rebalance; waiting.');
      return;
    }

    // Execute the trade sequence: each swap is its own atomic devnet transaction.
    let lastSig = '';
    let lastSlot = 0;
    let executed = 0;
    for (const plan of trades) {
      const { result, quote } = await executeReserveSwap({
        owner: kp,
        inAsset: plan.inAsset,
        outAsset: plan.outAsset,
        inRaw: plan.inRaw,
        prices,
      });
      executed += 1;
      lastSig = result.sig;
      lastSlot = result.slot;
      useStore.getState().log({
        vaultId,
        kind: 'trade',
        summary: `Sold ${fmtAmt(plan.inRaw, assetSpec(plan.inAsset))} ${assetSpec(plan.inAsset).symbol} for ${fmtAmt(
          quote.outRaw,
          assetSpec(plan.outAsset),
        )} ${assetSpec(plan.outAsset).symbol}`,
        detail: `drift was ${drift.toFixed(2)}% · fee ${quote.totalFeePct.toFixed(2)}% (spread 0.30 + curve ${quote.curvePct.toFixed(2)})${
          trades.length > 1 ? ` · trade ${executed} of ${trades.length}` : ''
        }`,
        sig: result.sig,
        slot: result.slot,
      });
    }

    useStore.getState().patchVault(vaultId, {
      lastCheckAt: Date.now(),
      nextCheckAt: Date.now() + cfg.cadenceSec * 1000,
      lastTradeAt: Date.now(),
      lastTradeSig: lastSig,
      lastTradeSlot: lastSlot,
      blockedReason: null,
      tradeCount: cfg.tradeCount + executed,
    });
    useStore.getState().refreshVaultBalances(vaultId);
    useStore.getState().refreshReserve();
  } catch (err) {
    const cfg = useStore.getState().vaults.find((v) => v.id === vaultId);
    if (err instanceof ReserveInventoryError) {
      applyBlocked(
        vaultId,
        cfg ?? null,
        'reserve',
        'reserve inventory insufficient for this trade',
        err.message,
      );
    } else {
      useStore.getState().log({
        vaultId,
        kind: 'blocked',
        summary: 'check failed',
        detail: err instanceof Error ? err.message.slice(0, 180) : 'unknown error',
      });
      useStore.getState().patchVault(vaultId, {
        lastCheckAt: Date.now(),
        nextCheckAt: Date.now() + (cfg?.cadenceSec ?? 75) * 1000,
      });
    }
  } finally {
    inFlightVaults.delete(vaultId);
  }
}

function applyCheck(vaultId: string, cfg: VaultConfig, summary: string, detail?: string): void {
  useStore.getState().patchVault(vaultId, {
    lastCheckAt: Date.now(),
    nextCheckAt: Date.now() + cfg.cadenceSec * 1000,
    blockedReason: null,
  });
  useStore.getState().log({ vaultId, kind: 'check', summary, detail });
}

function applyBlocked(
  vaultId: string,
  cfg: VaultConfig | null,
  reason: 'price' | 'budget' | 'reserve',
  summary: string,
  detail?: string,
): void {
  useStore.getState().patchVault(vaultId, {
    lastCheckAt: Date.now(),
    nextCheckAt: Date.now() + (cfg?.cadenceSec ?? 75) * 1000,
    blockedReason: reason,
  });
  useStore.getState().log({ vaultId, kind: 'blocked', summary, detail });
}
