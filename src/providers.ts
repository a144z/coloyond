import { AtomicLevel, QuoteResult, SwapRequest } from "./types.js";

export interface ProviderSpec {
  name: string;
  type: "meta-aggregator" | "bridge" | "bridge-dex" | "swap-aggregator" | "native-swap" | "intent-swap" | "fast-bridge";
  integration: string;
  chains: string;
  defaultAtomicLevel: AtomicLevel;
  phase: 1 | 2 | 3 | 4 | 5;
}

export const PROVIDERS: ProviderSpec[] = [
  { name: "CrossCurve", type: "meta-aggregator", integration: "TS SDK + REST API", chains: "30+", defaultAtomicLevel: "full", phase: 1 },
  { name: "deBridge DLN", type: "bridge", integration: "REST API + TS/Python SDK", chains: "19+ (EVM+Solana)", defaultAtomicLevel: "partial", phase: 2 },
  { name: "Rango", type: "bridge-dex", integration: "TS/Python/Rust SDK + REST API", chains: "multi", defaultAtomicLevel: "partial", phase: 2 },
  { name: "LI.FI", type: "bridge-dex", integration: "TS SDK + REST API", chains: "any-to-any", defaultAtomicLevel: "partial", phase: 3 },
  { name: "SwapKit", type: "swap-aggregator", integration: "REST API + Widget", chains: "30+", defaultAtomicLevel: "partial", phase: 3 },
  { name: "THORChain", type: "native-swap", integration: "REST API + MCP Server", chains: "BTC/ETH native", defaultAtomicLevel: "partial", phase: 4 },
  { name: "1inch Fusion+", type: "intent-swap", integration: "REST API + Fusion SDK", chains: "resolver network", defaultAtomicLevel: "intent", phase: 4 },
  { name: "Curve FastBridge", type: "fast-bridge", integration: "onchain call", chains: "ARB/OP/Fraxtal -> L1", defaultAtomicLevel: "full", phase: 5 },
];

export interface QuoteProvider {
  name: string;
  quote(request: SwapRequest): Promise<QuoteResult>;
}
