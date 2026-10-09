import { Route, RouteStep, LiveQuoteOptions } from "../types.js";

const BASE = "https://li.quest/v1";
const EXCLUDED_TOOLS = new Set(["feeCollection"]);

export function fmtAmount(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

interface LifiStepRaw {
  tool: string;
  toolDetails?: { name?: string; logoURI?: string };
  type: string;
  action: {
    fromToken: { symbol: string; chainId: number };
    toToken: { symbol: string; decimals: number; chainId: number };
    fromAmount?: string;
  };
  estimate: {
    fromAmount?: string;
    toAmount: string;
    executionDuration?: number;
    feeCosts?: { amountUSD?: string | number }[];
  };
  includedSteps?: LifiStepRaw[];
}

interface LifiRouteRaw {
  id: string;
  steps: LifiStepRaw[];
}

function kindOf(type: string): RouteStep["kind"] {
  return type === "swap" ? "swap" : "bridge";
}

function mapStep(raw: LifiStepRaw): RouteStep {
  const inc = (raw.includedSteps ?? []).filter((x) => !EXCLUDED_TOOLS.has(x.tool));
  const venues =
    inc.length > 0
      ? inc.map((x) => ({
          name: x.toolDetails?.name || x.tool,
          pct: Number(x.action.fromAmount ?? x.estimate.fromAmount ?? 0),
        }))
      : [];
  const total = venues.reduce((a, v) => a + v.pct, 0);
  let normalized: { name: string; pct: number }[] | undefined;
  if (venues.length > 0 && total > 0) {
    normalized = venues.map((v) => ({ name: v.name, pct: Math.round((v.pct / total) * 1000) / 10 }));
  }
  const fee = (raw.estimate.feeCosts ?? []).reduce((a, c) => a + (Number(c.amountUSD) || 0), 0);
  return {
    kind: kindOf(raw.type),
    protocol: raw.toolDetails?.name || raw.tool,
    logo: raw.toolDetails?.logoURI,
    fromChainId: raw.action.fromToken.chainId,
    toChainId: raw.action.toToken.chainId,
    fromSymbol: raw.action.fromToken.symbol,
    toSymbol: raw.action.toToken.symbol,
    etaSeconds: raw.estimate.executionDuration ?? 0,
    feeUsd: fee,
    venues: normalized,
  };
}

function mapLifi(raw: LifiRouteRaw): Route {
  const steps = raw.steps.map(mapStep);
  const last = raw.steps[raw.steps.length - 1];
  const dec = last.action.toToken.decimals;
  const outNum = Number(last.estimate.toAmount) / 10 ** dec;
  const totalTime = steps.reduce((a, s) => a + s.etaSeconds, 0);
  const totalFee = steps.reduce((a, s) => a + s.feeUsd, 0);
  const atomicLevel = raw.steps.some((s) => s.type !== "swap") ? "partial" : "full";
  return {
    id: raw.id,
    provider: `LI.FI · ${raw.steps.map((s) => s.tool).join(" → ")}`,
    badge: "none",
    steps,
    outputAmount: fmtAmount(outNum),
    outputAmountNum: outNum,
    totalTimeSeconds: totalTime,
    totalFeeUsd: totalFee,
    atomicLevel,
  };
}

export async function fetchLifiRoutes(opts: LiveQuoteOptions): Promise<Route[]> {
  const body = {
    fromChainId: opts.fromChain,
    toChainId: opts.toChain,
    fromAmount: opts.fromAmount,
    fromTokenAddress: opts.fromToken,
    toTokenAddress: opts.toToken,
    fromAddress: opts.sender,
    options: {
      order: "RECOMMENDED",
      ...(opts.slippage !== undefined ? { slippage: Number(opts.slippage) / 100 } : {}),
    },
  };
  const res = await fetch(`${BASE}/advanced/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`LI.FI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const data = await res.json();
  return (data.routes ?? []).map(mapLifi);
}