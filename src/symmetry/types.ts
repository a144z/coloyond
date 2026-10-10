import type { SymmetryNetwork } from "./config.js";

export interface AssetView {
  mint: string;
  symbol: string;
  decimals: number | null;
  amount: number | null;
  targetPct: number;
  actualPct: number | null;
  valueUsd: number | null;
  active: boolean;
}

export interface AutomationView {
  enabled: boolean;
  absBps: number;
  relBps: number;
  cooldownSeconds: number;
  slippageBps: number;
}

export interface VaultBrief {
  pubkey: string;
  mint: string;
  name: string;
  symbol: string;
  network: SymmetryNetwork;
  supply: number;
  assets: number;
  automationEnabled: boolean;
  bountyBalance: number;
  lastKeeperAt: number | null;
}

export interface VaultView extends VaultBrief {
  tvlUsd: number | null;
  priceUsd: number | null;
  driftPp: number | null;
  detail: AssetView[];
  automation: AutomationView;
  bountyMint: string;
  activeRebalance: number;
}
