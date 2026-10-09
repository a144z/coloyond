export type AtomicLevel = "full" | "partial" | "intent";

export type StepKind = "swap" | "bridge";

export interface Token {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
}

export interface SwapRequest {
  fromToken: Token;
  toToken: Token;
  amount: string; // raw units
  slippagePercent: number;
  sender: string;
}

export interface LiveQuoteOptions {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  sender: string;
  slippage?: number;
}

export interface RouteStep {
  kind: StepKind;
  protocol: string;
  logo?: string;
  fromChainId: number;
  toChainId: number;
  fromSymbol: string;
  toSymbol: string;
  etaSeconds: number;
  feeUsd: number;
  venues?: { name: string; pct: number }[];
}

export interface Route {
  id: string;
  provider: string;
  badge: "best-price" | "fastest" | "most-atomic" | "none";
  steps: RouteStep[];
  outputAmount: string;
  outputAmountNum: number;
  totalTimeSeconds: number;
  totalFeeUsd: number;
  atomicLevel: AtomicLevel;
}

export interface QuoteResult {
  provider: string;
  routes: Route[];
}

export type ExecutionPhase =
  | "await-route"
  | "source-locked"
  | "step-sent"
  | "bridge-confirming"
  | "dest-swap-executing"
  | "complete"
  | "rolled-back"
  | "manual-recovery";

export interface ExecutionStatus {
  phase: ExecutionPhase;
  currentStep: number;
  totalSteps: number;
  txHashes: string[];
  message?: string;
}
