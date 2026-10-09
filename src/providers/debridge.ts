import { Route, LiveQuoteOptions } from "../types.js";
import { fmtAmount } from "./lifi.js";

const BASE = "https://dln.debridge.finance/v1.0/dln/order/create-tx";

export async function fetchDebridgeRoute(opts: LiveQuoteOptions): Promise<Route | null> {
  const params = new URLSearchParams({
    srcChainId: String(opts.fromChain),
    srcChainTokenIn: opts.fromToken,
    srcChainTokenInAmount: opts.fromAmount,
    dstChainId: String(opts.toChain),
    dstChainTokenOut: opts.toToken,
    dstChainTokenOutAmount: "auto",
    prependOperatingExpense: "true",
  });
  const res = await fetch(`${BASE}?${params.toString()}`);
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) return null;
    throw new Error(`deBridge ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const j = await res.json();
  const est = j.estimation ?? {};
  const ord = j.order ?? {};
  const fee = j.fee ?? {};
  const dec = est.dstChainTokenOut?.decimals ?? 6;
  const outNum = Number(est.dstChainTokenOut?.amount ?? 0) / 10 ** dec;
  const eta = Number(ord.approximateFulfillmentDelay ?? 0);
  const feeUsd =
    (Number(fee.protocolFeeApproximateUsdValue) || 0) +
    (Number(est.estimatedTransactionFee?.approximateUsdValue) || 0);
  return {
    id: `debridge-${opts.fromChain}-${opts.toChain}`,
    provider: "deBridge DLN",
    badge: "none",
    steps: [
      {
        kind: "bridge",
        protocol: "deBridge DLN",
        fromChainId: opts.fromChain,
        toChainId: opts.toChain,
        fromSymbol: est.srcChainTokenIn?.symbol ?? "?",
        toSymbol: est.dstChainTokenOut?.symbol ?? "?",
        etaSeconds: eta,
        feeUsd,
        venues: [{ name: "deBridge DLN", pct: 100 }],
      },
    ],
    outputAmount: fmtAmount(outNum),
    outputAmountNum: outNum,
    totalTimeSeconds: eta,
    totalFeeUsd: feeUsd,
    atomicLevel: "partial",
  };
}