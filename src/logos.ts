import { tokenAddress } from "./tokenmap.js";

const CHAIN_KEY: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  42161: "arbitrum",
  8453: "base",
  137: "polygon",
};

const ROOT = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

export function chainLogo(chainId: number): string | null {
  const key = CHAIN_KEY[chainId];
  return key ? `${ROOT}/${key}/info/logo.png` : null;
}

export function tokenLogo(symbol: string, chainId: number): string | null {
  if (symbol === "ETH" || symbol === "WETH") return chainLogo(1);
  const key = CHAIN_KEY[chainId];
  const addr = tokenAddress(symbol, chainId);
  if (!key || !addr) return null;
  return `${ROOT}/${key}/assets/${addr}/logo.png`;
}