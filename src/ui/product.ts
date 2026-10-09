import { Route } from "../types.js";

export type ProductTab = "Portfolio" | "Shield" | "Yield" | "Ecosystem" | "Game";

export const TABS: ProductTab[] = ["Portfolio", "Shield", "Yield", "Ecosystem", "Game"];

export interface Pillar {
  title: string;
  label: string;
  detail: string;
  points: string[];
}

export interface StackNode {
  title: string;
  detail: string;
  status: string;
}

export interface Position {
  symbol: string;
  name: string;
  target: number;
  actual: number;
  apy: number;
  color: string;
  utility: string;
}

export interface Farm {
  name: string;
  pool: string;
  apy: string;
  tvl: string;
  lock: string;
  status: string;
  note: string;
}

export interface HookCard {
  name: string;
  role: string;
  status: string;
}

export interface Quest {
  id: string;
  title: string;
  reward: number;
}

export interface GambleOutcome {
  label: string;
  multiplier: string;
  detail: string;
  xp: number;
}

export interface StrategyData {
  name: string;
  kind: string;
  network: string;
  share: string;
  nav: string;
  market: string;
  quote: string;
  freshness: string;
  status: string;
}

export interface WalletData {
  network: string;
  usd: string;
  streak: number;
  xp: number;
}

export const SHIELD_MODES = ["v4 hook lock", "aggregator split", "intent fallback"] as const;
export type ShieldMode = (typeof SHIELD_MODES)[number];

export const STRATEGY: StrategyData = {
  name: "Tikkun Balanced Sleeve",
  kind: "Managed strategy",
  network: "Solana · Base · Arbitrum",
  share: "cbS1",
  nav: "$1.084",
  market: "$1.079",
  quote: "$1.078",
  freshness: "12s",
  status: "Protocol-managed",
};

export const WALLET: WalletData = {
  network: "Mainnet demo",
  usd: "$18,420",
  streak: 9,
  xp: 2340,
};

export const POSITIONS: Position[] = [
  {
    symbol: "USDC",
    name: "Stable floor",
    target: 30,
    actual: 33,
    apy: 7.1,
    color: "#1249ed",
    utility: "Exit depth",
  },
  {
    symbol: "jitoSOL",
    name: "Liquid staking",
    target: 40,
    actual: 36,
    apy: 5.2,
    color: "#ffd523",
    utility: "Staking yield",
  },
  {
    symbol: "mSOL",
    name: "Restaking",
    target: 20,
    actual: 22,
    apy: 8.9,
    color: "#8d25d9",
    utility: "Boost yield",
  },
  {
    symbol: "cbLP",
    name: "TradeFi LP",
    target: 10,
    actual: 9,
    apy: 12.4,
    color: "#ff513b",
    utility: "LP fees",
  },
];

export const FEATURE_FARM: Farm = {
  name: "cbS1 / USDC",
  pool: "TradeFi active",
  apy: "12.4%",
  tvl: "$2.1M",
  lock: "Flexible",
  status: "Active",
  note: "LP fees + protocol routing incentives",
};

export const FARMS: Farm[] = [
  {
    name: "cbS1 / ETH",
    pool: "Base",
    apy: "9.1%",
    tvl: "$870K",
    lock: "6h",
    status: "Open",
    note: "Hook fee routing",
  },
  {
    name: "cbS1 / SOL",
    pool: "Arbitrum",
    apy: "8.4%",
    tvl: "$540K",
    lock: "6h",
    status: "Queued",
    note: "Bridge + wrap fee",
  },
  {
    name: "cbS1 / crvUSD",
    pool: "Curve edge",
    apy: "6.8%",
    tvl: "$1.2M",
    lock: "Flexible",
    status: "Review",
    note: "Stable exit pair",
  },
];

export const HOOK_CARDS: HookCard[] = [
  {
    name: "RebalanceGate",
    role: "Checks drift, risk budget, and exit depth before routing",
    status: "Active",
  },
  {
    name: "MEVGuard",
    role: "Bounds sandwich impact on aggregator split routes",
    status: "Testing",
  },
  {
    name: "FeeOnTransfer",
    role: "Routes swap fee revenue into yield farming",
    status: "Planned",
  },
];

export const PILLARS: Pillar[] = [
  {
    title: "Real utility",
    label: "Emet",
    detail: "The vault has a share token, NAV, executable quote, and protocol-managed drift repair.",
    points: [
      "Protocol NAV and executable quote are separated",
      "TradeFi exit depth is tracked as product truth",
      "Keepers rebalance, the product reports the state",
    ],
  },
  {
    title: "Full ecosystem",
    label: "Kehila",
    detail: "Swap shield, liquidity layer, farms, cards, and settlement status connect into one loop.",
    points: [
      "Aggregator quotes plus v4 hook checks",
      "LP rewards and fee revenue are visible together",
      "Share expressions carry strategy meaning",
    ],
  },
  {
    title: "Gamification",
    label: "Hiddur",
    detail: "Quests, streaks, and XP make useful portfolio behavior legible.",
    points: ["Daily drift review", "Route prep bonus", "Expression sharing"],
  },
  {
    title: "Gambling",
    label: "Nes",
    detail: "Optional boost sits inside a risk budget, not inside promised yield.",
    points: ["Multiplier after useful actions", "Risk budget enforced", "No yield promise"],
  },
];

export const ECOSYSTEM: StackNode[] = [
  {
    title: "Liquid staking protocol",
    detail: "One share token represents proportional custody of the rebalanced basket.",
    status: "Core",
  },
  {
    title: "Shield swap prep",
    detail: "Quotes, v4 hook rules, slippage, MEV bounds, and route choice stay behind one action.",
    status: "Risk-gated",
  },
  {
    title: "TradeFi liquidity layer",
    detail: "Exit depth, LP pools, and farm incentives determine whether rebalancing is useful.",
    status: "Monitored",
  },
  {
    title: "Active yield farm",
    detail: "Share tokens earn from LP fees, protocol routing revenue, and seasonal points.",
    status: "Active",
  },
  {
    title: "Game and gamble",
    detail: "Useful actions create XP; optional rolls create multiplier without moving NAV.",
    status: "Optional",
  },
];

export const QUESTS: Quest[] = [
  { id: "wallet", title: "Connect a demo wallet", reward: 120 },
  { id: "nav", title: "Review NAV and executable quote", reward: 80 },
  { id: "route", title: "Prepare a shielded swap route", reward: 150 },
  { id: "farm", title: "Stake share tokens into TradeFi LP", reward: 100 },
  { id: "share", title: "Save or share an expression", reward: 70 },
];

export const GAMBLE_OUTCOMES: GambleOutcome[] = [
  { label: "Boost", multiplier: "1.25x", detail: "The route lands through a calm pool.", xp: 140 },
  { label: "Hold", multiplier: "1.05x", detail: "Small drift, small reward.", xp: 80 },
  { label: "Slip", multiplier: "0.92x", detail: "The quote aged before settlement.", xp: 35 },
  { label: "Break", multiplier: "0.80x", detail: "The path stayed open, but no boost.", xp: 0 },
];

export const SAMPLE_ROUTES: Route[] = [
  {
    id: "sample-v4-hook",
    provider: "Uniswap v4 hook",
    badge: "best-price",
    steps: [
      {
        kind: "swap",
        protocol: "v4 hook",
        fromChainId: 42161,
        toChainId: 42161,
        fromSymbol: "ETH",
        toSymbol: "USDC",
        etaSeconds: 12,
        feeUsd: 0.84,
      },
    ],
    outputAmount: "3,418.82",
    outputAmountNum: 3418.82,
    totalTimeSeconds: 12,
    totalFeeUsd: 1.12,
    atomicLevel: "full",
  },
  {
    id: "sample-lifi-split",
    provider: "LI.FI split",
    badge: "fastest",
    steps: [
      {
        kind: "swap",
        protocol: "LI.FI",
        fromChainId: 42161,
        toChainId: 10,
        fromSymbol: "ETH",
        toSymbol: "USDC",
        etaSeconds: 28,
        feeUsd: 1.32,
        venues: [
          { name: "Uniswap v4", pct: 60 },
          { name: "Curve", pct: 40 },
        ],
      },
    ],
    outputAmount: "3,411.05",
    outputAmountNum: 3411.05,
    totalTimeSeconds: 28,
    totalFeeUsd: 1.74,
    atomicLevel: "partial",
  },
  {
    id: "sample-debridge",
    provider: "deBridge intent",
    badge: "most-atomic",
    steps: [
      {
        kind: "bridge",
        protocol: "deBridge",
        fromChainId: 42161,
        toChainId: 10,
        fromSymbol: "ETH",
        toSymbol: "USDC",
        etaSeconds: 96,
        feeUsd: 2.24,
        venues: [
          { name: "li.fi", pct: 70 },
          { name: "debridge", pct: 30 },
        ],
      },
    ],
    outputAmount: "3,402.51",
    outputAmountNum: 3402.51,
    totalTimeSeconds: 96,
    totalFeeUsd: 2.64,
    atomicLevel: "intent",
  },
];

export function driftLabel(totalDrift: number): string {
  if (totalDrift <= 2) return "Healthy";
  if (totalDrift <= 6) return "Watch";
  return "Rebalance";
}
