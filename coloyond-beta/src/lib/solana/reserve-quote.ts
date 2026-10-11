import type { Balances } from './wallet';
import { CURVE_BASE_PCT, CURVE_CAP_PCT, CURVE_DEPTH_FRACTION, RESERVE_SPREAD_PCT } from './config';
import { assetList, assetSpec, type AssetId } from './assets';

export interface SwapQuote {
  inAsset: AssetId;
  outAsset: AssetId;
  inRaw: number;
  outRaw: number;
  inUsd: number;
  outUsd: number;
  effectivePrice: number;
  spreadPct: number;
  curvePct: number;
  totalFeePct: number;
  reserveInRaw: number;
  reserveOutRaw: number;
}

export class ReserveInventoryError extends Error {
  constructor(needed: string, available: string) {
    super(`reserve inventory insufficient: needs ${needed}, holds ${available}`);
    this.name = 'ReserveInventoryError';
  }
}

export function reserveDepthUsd(reserve: Balances, prices: Record<string, number>): number {
  return assetList().reduce((depth, spec) => {
    const price = prices[spec.id];
    return depth + (price ? ((reserve.tokens[spec.id] ?? 0) / 10 ** spec.decimals) * price : 0);
  }, 0);
}

export function quoteSwap(params: {
  inAsset: AssetId;
  outAsset: AssetId;
  inRaw: number;
  prices: Record<string, number>;
  reserve: Balances;
}): SwapQuote {
  const { inAsset, outAsset, inRaw, prices, reserve } = params;
  if (inAsset === outAsset) throw new Error('cannot swap an asset into itself');
  if (inRaw <= 0) throw new Error('swap amount must be positive');
  const input = assetSpec(inAsset);
  const output = assetSpec(outAsset);
  const inPrice = prices[inAsset];
  const outPrice = prices[outAsset];
  if (!inPrice || !outPrice) throw new Error(`missing live price for ${input.symbol} or ${output.symbol}`);
  const inUsd = (inRaw / 10 ** input.decimals) * inPrice;
  const depth = reserveDepthUsd(reserve, prices);
  const curvePct = depth > 0 ? Math.min(CURVE_CAP_PCT, (CURVE_BASE_PCT * inUsd) / (depth * CURVE_DEPTH_FRACTION)) : CURVE_CAP_PCT;
  const totalFeePct = RESERVE_SPREAD_PCT + curvePct;
  const outUsd = inUsd * (1 - totalFeePct / 100);
  const outRaw = Math.floor((outUsd / outPrice) * 10 ** output.decimals);
  const reserveOutRaw = reserve.tokens[outAsset] ?? 0;
  if (outRaw > reserveOutRaw) {
    throw new ReserveInventoryError(
      `${(outRaw / 10 ** output.decimals).toFixed(output.decimals === 6 ? 2 : 6)} ${output.symbol}`,
      `${(reserveOutRaw / 10 ** output.decimals).toFixed(output.decimals === 6 ? 2 : 6)} ${output.symbol}`,
    );
  }
  const inUnits = inRaw / 10 ** input.decimals;
  return {
    inAsset, outAsset, inRaw, outRaw, inUsd, outUsd,
    effectivePrice: inUnits > 0 ? outRaw / 10 ** output.decimals / inUnits : 0,
    spreadPct: RESERVE_SPREAD_PCT, curvePct, totalFeePct,
    reserveInRaw: reserve.tokens[inAsset] ?? 0, reserveOutRaw,
  };
}
