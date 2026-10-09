import { QuoteProvider } from "./providers.js";
import { RouteFinder } from "./router.js";
import { ColoyondExecutor } from "./executor.js";
import { QuoteResult, SwapRequest, Token } from "./types.js";

const ETH: Token = { chainId: 42161, address: "0x0000000000000000000000000000000000000000", symbol: "ETH", decimals: 18 };
const USDC: Token = { chainId: 10, address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6 };

const request: SwapRequest = {
  fromToken: ETH,
  toToken: USDC,
  amount: "1000000000000000000",
  slippagePercent: 0.5,
  sender: "0x0000000000000000000000000000000000000001",
};

const mockProvider: QuoteProvider = {
  name: "CrossCurve",
  async quote(req): Promise<QuoteResult> {
    return {
      provider: "CrossCurve",
      routes: [
        {
          id: "cc-metaroute-1",
          provider: "CrossCurve MetaRoute",
          badge: "best-price",
          steps: [
            { kind: "swap", protocol: "Curve Pool", fromChainId: 42161, toChainId: 42161, fromSymbol: "ETH", toSymbol: "crvUSD", etaSeconds: 30, feeUsd: 0.8 },
            { kind: "bridge", protocol: "FastBridge", fromChainId: 42161, toChainId: 1, fromSymbol: "crvUSD", toSymbol: "crvUSD", etaSeconds: 240, feeUsd: 1.3 },
            { kind: "swap", protocol: "Curve Pool", fromChainId: 1, toChainId: 10, fromSymbol: "crvUSD", toSymbol: "USDC", etaSeconds: 30, feeUsd: 0 },
          ],
          outputAmount: "1847200000",
          outputAmountNum: 1847.2,
          totalTimeSeconds: 300,
          totalFeeUsd: 2.1,
          atomicLevel: "full",
        },
        {
          id: "cc-debridge-2",
          provider: "deBridge DLN + Rango",
          badge: "fastest",
          steps: [
            { kind: "bridge", protocol: "deBridge DLN", fromChainId: 42161, toChainId: 10, fromSymbol: "ETH", toSymbol: "USDC", etaSeconds: 90, feeUsd: 3.4 },
          ],
          outputAmount: "1839500000",
          outputAmountNum: 1839.5,
          totalTimeSeconds: 90,
          totalFeeUsd: 3.4,
          atomicLevel: "partial",
        },
      ],
    };
  },
};

async function main(): Promise<void> {
  console.log(`Find route: ${request.amount} ${request.fromToken.symbol} (chain ${request.fromToken.chainId}) -> ${request.toToken.symbol} (chain ${request.toToken.chainId})`);

  const finder = new RouteFinder([mockProvider]);
  const routes = await finder.find(request);
  const ranked = finder.rank(routes);

  console.log(`Routes found: ${routes.length}`);
  for (const r of routes) {
    console.log(`  [${r.badge}] ${r.provider}: out=${r.outputAmount} time=${r.totalTimeSeconds}s fee=$${r.totalFeeUsd} atomic=${r.atomicLevel}`);
  }

  const chosen = ranked.bestPrice;
  if (!chosen) {
    console.log("No route.");
    return;
  }

  console.log(`\nExecute: ${chosen.id} (${chosen.steps.length} steps)`);
  const exec = new ColoyondExecutor(chosen);
  exec.lockSource("0x3f2a...");
  console.log(`  step 0 sent -> ${exec.getStatus().phase}`);
  exec.executeStep(0, "0xaa11...");
  exec.executeStep(1, "0xbb22...");
  console.log(`  bridge confirming -> ${exec.getStatus().phase}`);
  exec.confirmBridge();
  exec.executeStep(2, "0xcc33...");
  exec.complete();
  const status = exec.getStatus();
  console.log(`  done: phase=${status.phase} txs=${status.txHashes.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
