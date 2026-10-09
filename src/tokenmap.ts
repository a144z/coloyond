export const NATIVE = "0x0000000000000000000000000000000000000000";

export interface TokenSpec {
  symbol: string;
  decimals: number;
  chains: Record<number, string>;
}

export const TOKEN_SPECS: TokenSpec[] = [
  {
    symbol: "ETH",
    decimals: 18,
    chains: { 1: NATIVE, 10: NATIVE, 42161: NATIVE, 8453: NATIVE, 137: NATIVE },
  },
  {
    symbol: "USDC",
    decimals: 6,
    chains: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    },
  },
  {
    symbol: "DAI",
    decimals: 18,
    chains: {
      1: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      10: "0xDA10009Bd5D07dd0CeCc66161FC93D7c9000da1",
      42161: "0xDA10009Bd5D07dd0CeCc66161FC93D7c9000da1",
      8453: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    },
  },
  {
    symbol: "crvUSD",
    decimals: 18,
    chains: {
      1: "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E",
      10: "0xC52D7F23a2e460248Db6eE192Cb23dd12b110Cb2",
      42161: "0x498Bf2B1e120Fed3ad3D42EA2165E9b73f99C1e5",
    },
  },
  {
    symbol: "WBTC",
    decimals: 8,
    chains: {
      1: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    },
  },
];

export function symbolsOn(chainId: number): string[] {
  return TOKEN_SPECS.filter((s) => s.chains[chainId]).map((s) => s.symbol);
}

export function tokenAddress(symbol: string, chainId: number): string | undefined {
  const spec = TOKEN_SPECS.find((s) => s.symbol === symbol);
  return spec?.chains[chainId];
}

export function tokenDecimals(symbol: string): number {
  const spec = TOKEN_SPECS.find((s) => s.symbol === symbol);
  return spec?.decimals ?? 18;
}