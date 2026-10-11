// The desk's live state: basket, trigger, reserve, and log, held in one
// record so one localStorage write captures the whole demo profile. Storage
// is untrusted (same lesson as the watchlist hook), so everything coming back
// out is validated before it is trusted, and persistence happens after
// commit because state updaters must stay pure.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TRIGGER_PP,
  DeskAsset,
  MAX_LOG_ENTRIES,
  RebalancePlan,
  driftPp,
  fmtUsd,
  planRebalance,
  reweigh,
  round1,
  round2,
  seedBasket,
  simulateMarketMove,
  normalizeTargets as normalizeTargetsOf,
  targetsTotal as targetsTotalOf,
  totalValueUsd,
  weightsPct,
} from "./rebalance.js";

export const DESK_STORAGE_KEY = "coloyond.rebalance-desk.v1";

export const DESK_STEPS = ["Checking drift", "Planning trades", "Swapping legs", "Reweighing basket", "Fees to reserve"] as const;

export interface DeskLogEntry {
  id: string;
  text: string;
}

interface DeskCore {
  assets: DeskAsset[];
  triggerPp: number;
  reserveUsd: number;
  runs: number;
  log: DeskLogEntry[];
  locked: string[];
}

export interface RebalanceDeskView {
  assets: DeskAsset[];
  byId: Record<string, { targetPct: number; weightPct: number }>;
  weights: number[];
  lockedSymbols: string[];
  drift: number;
  totalUsd: number;
  targetsTotal: number;
  triggerPp: number;
  reserveUsd: number;
  runs: number;
  plan: RebalancePlan;
  status: string | null;
  phase: "idle" | "running";
  stepIndex: number;
  log: DeskLogEntry[];
  setTriggerPp: (pp: number) => void;
  setTarget: (symbol: string, pct: number) => void;
  normalizeTargets: () => void;
  toggleLocked: (symbol: string) => void;
  simulateMarket: () => void;
  rebalanceNow: () => void;
  resetBasket: () => void;
}

let entrySeq = 0;
function logEntry(text: string): DeskLogEntry {
  entrySeq += 1;
  return { id: `${Date.now().toString(36)}.${entrySeq.toString(36)}`, text };
}

function prependLog(log: DeskLogEntry[], text: string): DeskLogEntry[] {
  return [logEntry(text), ...log].slice(0, MAX_LOG_ENTRIES);
}

function seedCore(): DeskCore {
  return { assets: seedBasket(), triggerPp: DEFAULT_TRIGGER_PP, reserveUsd: 0, runs: 0, log: [], locked: [] };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStoredAsset(value: unknown): value is DeskAsset {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.symbol === "string" &&
    typeof entry.name === "string" &&
    typeof entry.color === "string" &&
    isFiniteNumber(entry.targetPct) &&
    entry.targetPct >= 0 &&
    entry.targetPct <= 100 &&
    isFiniteNumber(entry.valueUsd) &&
    entry.valueUsd >= 0
  );
}

function readCore(): DeskCore {
  try {
    const raw = window.localStorage.getItem(DESK_STORAGE_KEY);
    if (raw === null) return seedCore();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return seedCore();
    const stored = parsed as Record<string, unknown>;
    const assets = Array.isArray(stored.assets) ? stored.assets.filter(isStoredAsset).map((asset) => ({ ...asset, targetPct: Math.round(asset.targetPct) })) : null;
    if (assets === null || assets.length === 0) return seedCore();
    const trigger = isFiniteNumber(stored.triggerPp) && stored.triggerPp >= 0.5 && stored.triggerPp <= 20 ? stored.triggerPp : DEFAULT_TRIGGER_PP;
    const reserveUsd = isFiniteNumber(stored.reserveUsd) && stored.reserveUsd >= 0 ? stored.reserveUsd : 0;
    const runs = isFiniteNumber(stored.runs) && stored.runs >= 0 ? Math.floor(stored.runs) : 0;
    const log = Array.isArray(stored.log)
      ? (stored.log as unknown[])
          .filter((entry): entry is DeskLogEntry => typeof entry === "object" && entry !== null && typeof (entry as DeskLogEntry).id === "string" && typeof (entry as DeskLogEntry).text === "string")
          .slice(0, MAX_LOG_ENTRIES)
      : [];
    return { assets, triggerPp: trigger, reserveUsd, runs, log, locked: Array.isArray(stored.locked) ? (stored.locked as unknown[]).filter((symbol): symbol is string => typeof symbol === "string" && assets.some((asset) => asset.symbol === symbol)) : [] };
  } catch {
    return seedCore();
  }
}

function writeCore(core: DeskCore): void {
  try {
    window.localStorage.setItem(DESK_STORAGE_KEY, JSON.stringify(core));
  } catch {
    // A private window can lose the copy; the session still holds the desk.
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useRebalanceDesk(): RebalanceDeskView {
  const [core, setCore] = useState<DeskCore>(readCore);
  const [status, setStatus] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "running">("idle");
  const [stepIndex, setStepIndex] = useState(0);
  // Each run and each unmount takes a number; any older completion is stale.
  const tokenRef = useRef(0);
  const runningRef = useRef(false);
  useEffect(() => () => {
    tokenRef.current += 1;
    runningRef.current = false;
  }, []);

  // Persist after commit; updaters stay pure because React may replay them.
  useEffect(() => writeCore(core), [core]);

  const weights = useMemo(() => weightsPct(core.assets), [core.assets]);
  const drift = useMemo(() => driftPp(core.assets), [core.assets]);
  const totalUsd = useMemo(() => totalValueUsd(core.assets), [core.assets]);
  const targetsTotal = useMemo(() => targetsTotalOf(core.assets), [core.assets]);
  const plan = useMemo(() => planRebalance(core.assets), [core.assets]);
  const byId = useMemo(() => {
    const map: Record<string, { targetPct: number; weightPct: number }> = {};
    weights.forEach((weight, index) => {
      const asset = core.assets[index];
      map[asset.symbol] = { targetPct: asset.targetPct, weightPct: weight };
    });
    return map;
  }, [core.assets, weights]);

  const setTriggerPp = useCallback((pp: number) => {
    const next = round1(Math.max(0.5, Math.min(20, isFiniteNumber(pp) ? pp : DEFAULT_TRIGGER_PP)));
    setCore((current) => ({ ...current, triggerPp: next }));
  }, []);

  const setTarget = useCallback((symbol: string, pct: number) => {
    const next = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
    setCore((current) => ({ ...current, assets: current.assets.map((asset) => (asset.symbol === symbol ? { ...asset, targetPct: next } : asset)) }));
  }, []);

  const normalizeTargets = useCallback(() => {
    setCore((current) => ({ ...current, assets: normalizeTargetsOf(current.assets) }));
    setStatus("Targets normalized to total exactly 100%.");
  }, []);

  const simulateMarket = useCallback(() => {
    if (runningRef.current) return;
    const nextAssets = simulateMarketMove(core.assets);
    const nextDrift = driftPp(nextAssets);
    setCore((current) => ({ ...current, assets: nextAssets, log: prependLog(current.log, `Market move simulated; drift now ${nextDrift} pp.`) }));
    setStatus(`Drift is now ${nextDrift} pp, ${nextDrift > core.triggerPp ? "past" : "within"} the ${core.triggerPp} pp trigger.`);
  }, [core]);

  const rebalanceNow = useCallback(() => {
    if (runningRef.current) return;
    if (targetsTotalOf(core.assets) !== 100) {
      setStatus("The targets do not total 100% yet, so the desk will not swap. Normalize first.");
      return;
    }
    const clickPlan = planRebalance(core.assets);
    if (clickPlan.legs.length === 0) {
      setStatus("The basket already sits on target. Nothing to swap.");
      return;
    }
    const token = (tokenRef.current += 1);
    runningRef.current = true;
    setPhase("running");
    setStepIndex(0);
    void (async () => {
      for (let step = 1; step < DESK_STEPS.length; step += 1) {
        await wait(380);
        if (token !== tokenRef.current) return;
        setStepIndex(step);
      }
      await wait(380);
      if (token !== tokenRef.current) return;
      const nextAssets = reweigh(core.assets, clickPlan);
      const nextDrift = driftPp(nextAssets);
      setCore((current) => ({
        ...current,
        assets: nextAssets,
        triggerPp: current.triggerPp,
        reserveUsd: round2(current.reserveUsd + clickPlan.reserveUsd),
        runs: current.runs + 1,
        log: prependLog(current.log, `Rebalanced ${clickPlan.legs.length} leg${clickPlan.legs.length === 1 ? "" : "s"}; ${fmtUsd(clickPlan.totalFeeUsd)} fee, ${fmtUsd(clickPlan.reserveUsd)} to the reserve.`),
      }));
      setStatus(`Reweighed onto target; drift now ${nextDrift} pp. Reserve at ${fmtUsd(round2(core.reserveUsd + clickPlan.reserveUsd))}, all sample figures.`);
      runningRef.current = false;
      setPhase("idle");
    })();
  }, [core]);

  const resetBasket = useCallback(() => {
    setCore(seedCore());
    setStatus("The basket is back on the saved seed set by the strategy.");
  }, []);

  const toggleLocked = useCallback((symbol: string) => {
    setCore((current) => ({
      ...current,
      locked: current.locked.includes(symbol) ? current.locked.filter((lockedSymbol) => lockedSymbol !== symbol) : [...current.locked, symbol],
    }));
  }, []);

  return {
    assets: core.assets,
    byId,
    weights,
    lockedSymbols: core.locked,
    drift,
    totalUsd,
    targetsTotal,
    triggerPp: core.triggerPp,
    reserveUsd: core.reserveUsd,
    runs: core.runs,
    plan,
    status,
    phase,
    stepIndex,
    log: core.log,
    setTriggerPp,
    setTarget,
    normalizeTargets,
    toggleLocked,
    simulateMarket,
    rebalanceNow,
    resetBasket,
  };
}
