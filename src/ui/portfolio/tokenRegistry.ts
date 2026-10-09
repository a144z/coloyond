// The curated set of Solana tokens coloyond watches in this browser prototype.
// Search runs locally and instantly; a pasted mint can be confirmed against
// the public RPC, so a demo row never claims more live data than it has.

export type TokenTag = "core" | "stable" | "staking" | "utility" | "custom";

export interface SupportedToken {
  symbol: string;
  name: string;
  mint: string;
  tag: TokenTag;
  demoUsd: number;
}

// The Solana Foundation endpoints return 403 to any request with a browser
// Origin header. PublicNode allows browser calls for getAccountInfo.
export const RPC_ENDPOINT = "https://solana-rpc.publicnode.com";

// Mainnet mints, checked against Jupiter's verified token list on 10 October 2026.
// demoUsd values are sample holdings for the demo profile, not live prices.
export const SUPPORTED_SOLANA_TOKENS: SupportedToken[] = [
  { symbol: "SOL", name: "Wrapped SOL", mint: "So11111111111111111111111111111111111111112", tag: "core", demoUsd: 6120 },
  { symbol: "USDC", name: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tag: "stable", demoUsd: 4120 },
  { symbol: "PYUSD", name: "PayPal USD", mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", tag: "stable", demoUsd: 175 },
  { symbol: "jitoSOL", name: "Jito staked SOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", tag: "staking", demoUsd: 3450 },
  { symbol: "mSOL", name: "Marinade staked SOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", tag: "staking", demoUsd: 1640 },
  { symbol: "JUP", name: "Jupiter", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", tag: "utility", demoUsd: 540 },
  { symbol: "RAY", name: "Raydium", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", tag: "utility", demoUsd: 380 },
  { symbol: "BONK", name: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", tag: "utility", demoUsd: 260 },
  { symbol: "W", name: "Wormhole", mint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ", tag: "utility", demoUsd: 210 },
];

export function searchSupportedTokens(query: string, excludeMints: string[] = []): SupportedToken[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const banned = new Set(excludeMints);
  return SUPPORTED_SOLANA_TOKENS.filter(
    (token) => !banned.has(token.mint) && (token.symbol.toLowerCase().includes(needle) || token.name.toLowerCase().includes(needle)),
  );
}

export interface MintCheck {
  ok: boolean;
  detail: string;
}

// A real RPC round trip: the address holds an SPL Token (or Token-2022) mint,
// or the node says why not.
export async function confirmMintOnChain(mint: string): Promise<MintCheck> {
  const trimmed = mint.trim();
  if (trimmed.length < 32 || trimmed.length > 44) {
    return { ok: false, detail: "A base58 mint runs 32 to 44 characters." };
  }
  try {
    const response = await fetch(RPC_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [trimmed, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    if (payload?.error !== undefined) {
      return { ok: false, detail: `Node: ${payload.error.message ?? "the request failed."}` };
    }
    const account = payload?.result?.value;
    if (account === null || account === undefined) return { ok: false, detail: "No account exists at that address." };
    if (account.data?.parsed?.type === "mint") return { ok: true, detail: "On-chain: this address is a token mint." };
    return { ok: false, detail: "The account exists, but it is not a token mint." };
  } catch (caught) {
    return { ok: false, detail: caught instanceof Error ? `Node: ${caught.message}` : "The node did not answer." };
  }
}
