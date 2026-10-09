import { Route } from "./types.js";
import { fetchLifiRoutes } from "./providers/lifi.js";
import { fetchDebridgeRoute } from "./providers/debridge.js";
import { tokenAddress, tokenDecimals } from "./tokenmap.js";

const SENDER = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";

export interface FindRequest {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  amount: string;
  slippage?: number;
}

export function toWei(amount: string, decimals: number): string {
  const [i, f = ""] = amount.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  const s = `${i || "0"}${frac}`.replace(/^0+(?=\d)/, "");
  return s || "0";
}

const ATOMIC_W: Record<Route["atomicLevel"], number> = { full: 2, partial: 1, intent: 0 };

export function assignBadges(routes: Route[]): Route[] {
  const list = routes.map((r) => ({ ...r, badge: "none" as Route["badge"] }));
  if (list.length === 0) return list;
  const best = [...list].sort((a, b) => b.outputAmountNum - a.outputAmountNum)[0];
  const fastest = [...list].sort((a, b) => a.totalTimeSeconds - b.totalTimeSeconds)[0];
  const mostAtomic = [...list].sort((a, b) => ATOMIC_W[b.atomicLevel] - ATOMIC_W[a.atomicLevel])[0];
  const used = new Set<string>();
  best.badge = "best-price";
  used.add(best.id);
  if (!used.has(fastest.id)) {
    fastest.badge = "fastest";
    used.add(fastest.id);
  }
  if (
    !used.has(mostAtomic.id) &&
    mostAtomic.atomicLevel !== "partial" &&
    mostAtomic.id !== best.id
  ) {
    mostAtomic.badge = "most-atomic";
  }
  return list;
}

export async function fetchRoutes(req: FindRequest): Promise<{ routes: Route[]; error?: string }> {
  const fromAddr = tokenAddress(req.fromToken, req.fromChain);
  const toAddr = tokenAddress(req.toToken, req.toChain);
  if (!fromAddr || !toAddr) {
    return {
      routes: [],
      error: `${req.fromToken} is not available on that chain. Pick another token or chain.`,
    };
  }
  const common = {
    fromChain: req.fromChain,
    toChain: req.toChain,
    fromToken: fromAddr,
    toToken: toAddr,
    fromAmount: toWei(req.amount, tokenDecimals(req.fromToken)),
    sender: SENDER,
    slippage: req.slippage,
  };
  const results = await Promise.allSettled([
    fetchLifiRoutes(common),
    fetchDebridgeRoute(common),
  ]);
  const routes: Route[] = [];
  let error: string | undefined;
  for (const r of results) {
    if (r.status === "fulfilled") {
      const v = Array.isArray(r.value) ? r.value : r.value ? [r.value] : [];
      routes.push(...v);
    } else {
      error = r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  }
  if (routes.length === 0) {
    return { routes: [], error: error ?? "No provider returned a route for this pair." };
  }
  return { routes: assignBadges(routes) };
}