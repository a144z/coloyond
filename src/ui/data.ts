export interface ChainInfo {
  id: number;
  name: string;
  color: string;
}

export const CHAINS: ChainInfo[] = [
  { id: 42161, name: "Arbitrum", color: "#28a0f0" },
  { id: 10, name: "Optimism", color: "#ff0420" },
  { id: 1, name: "Ethereum", color: "#627eea" },
  { id: 8453, name: "Base", color: "#0052ff" },
  { id: 137, name: "Polygon", color: "#8247e5" },
  { id: 0, name: "Bitcoin", color: "#f7931a" },
];

export const BALANCES: Record<string, string> = {
  ETH: "2.45",
  USDC: "1,204.55",
  DAI: "320.18",
  crvUSD: "5,000.00",
  WBTC: "0.021",
  BTC: "0.05",
};

export function chainName(id: number): string {
  return CHAINS.find((c) => c.id === id)?.name ?? `Chain ${id}`;
}

export function chainColor(id: number): string {
  return CHAINS.find((c) => c.id === id)?.color ?? "#8e8ea3";
}

export function fmtTime(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const m = Math.round(seconds / 60);
  return `~${m} min`;
}

export function fakeHash(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `0x${h.toString(16).padStart(8, "0").repeat(5)}`;
}