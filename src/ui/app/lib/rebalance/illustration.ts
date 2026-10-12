/** Deterministic fee-free explanation model, never a live quote or transaction builder. */
export interface ModelAsset {
  id: string;
  symbol: string;
  targetPct: number;
  units: number;
  price: number;
  color: string;
}
export interface ModelRow extends ModelAsset {
  value: number;
  actualPct: number;
  targetValue: number;
  deltaValue: number;
  targetUnits: number;
}
export function rebalanceIllustration(assets: ModelAsset[]) {
  if (
    !assets.length ||
    assets.some(
      (a) =>
        !Number.isFinite(a.price) ||
        a.price <= 0 ||
        !Number.isFinite(a.units) ||
        a.units < 0 ||
        !Number.isFinite(a.targetPct) ||
        a.targetPct < 0,
    ) ||
    Math.abs(assets.reduce((s, a) => s + a.targetPct, 0) - 100) > 0.001
  )
    throw Error("A complete, valid 100% target is required.");
  const total = assets.reduce((s, a) => s + a.units * a.price, 0);
  if (total <= 0) throw Error("Illustration value must be positive.");
  const rows: ModelRow[] = assets.map((a) => {
    const value = a.units * a.price,
      targetValue = (total * a.targetPct) / 100;
    return {
      ...a,
      value,
      actualPct: (value / total) * 100,
      targetValue,
      deltaValue: targetValue - value,
      targetUnits: targetValue / a.price,
    };
  });
  return {
    total,
    rows,
    sells: rows.filter((r) => r.deltaValue < -0.000001),
    buys: rows.filter((r) => r.deltaValue > 0.000001),
    maxDrift: Math.max(...rows.map((r) => Math.abs(r.actualPct - r.targetPct))),
  };
}
export const MODEL_PRICES: Record<string, number> = {
  wsol: 150,
  teth: 2000,
  dusd: 1,
  tbtc: 90000,
};
export const MODEL_COLORS: Record<string, string> = {
  wsol: "#ff513b",
  teth: "#8d25d9",
  dusd: "#1249ed",
  tbtc: "#ffd523",
};
export function exampleAssets(
  targets: Record<string, number>,
  shocks: Record<string, number> = {},
): ModelAsset[] {
  const symbols: Record<string, string> = {
    wsol: "SOL",
    teth: "ETH",
    dusd: "dUSD",
    tbtc: "BTC",
  };
  return Object.entries(targets)
    .filter(([id, w]) => w > 0 && MODEL_PRICES[id])
    .map(([id, targetPct]) => ({
      id,
      symbol: symbols[id],
      targetPct,
      units: (1000 * targetPct) / 100 / MODEL_PRICES[id],
      price: MODEL_PRICES[id] * (1 + (shocks[id] ?? 0) / 100),
      color: MODEL_COLORS[id],
    }));
}
