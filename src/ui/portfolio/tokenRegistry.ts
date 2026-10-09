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

export const RPC_ENDPOINT = "https://api.mainnet.solana.com";

export const SUPPORTED_SOLANA_TOKENS: SupportedToken[] = [
  { symbol: "SOL", name: "The network asset", mint: "So111RMXkm3w6w2m3m3m3m3m3m3m3m3m3m", tag: "core", demoUsd: 6120 },
  { symbol: "USDC", name: "Stable floor", mint: "EPjF4Ua9wXtGZrY8Y3xK3Y2k3Q5R5x3P5R8y7H2r3", tag: "stable", demoUsd: 4120 },
  { symbol: "USDb", name: "Bridged stable", mint: "8Bk9x2zP4fN6uH2sV7qD1mY5cE3tA9rL6wJ4uH0sZ1", tag: "stable", demoUsd: 980 },
  { symbol: "jitoSOL", name: "Liquid staking", mint: "J1t2o3S4o5l6M7i8n9T0wErViPoNl6EtC3hA1sU2d", tag: "staking", demoUsd: 3450 },
  { symbol: "mSOL", name: "Restaking", mint: "M3sOl4R3s7t9Ak2NiNg5Tr3As7Ti1On5M4qL0pK8z", tag: "staking", demoUsd: 1640 },
  { symbol: "cbLP", name: "TradeFi LP share", mint: "CbLp0TrAd3eF1PoOl5HaS2Re4Pr7Ot8Si6On9", tag: "utility", demoUsd: 890 },
  { symbol: "JUP", name: "Router governance", mint: "JuP0EcOsYsTeM1PrOgRaM3MiN7t4O9wQ1kE5vU8aZ2", tag: "utility", demoUsd: 540 },
  { symbol: "RAY", name: "Amm liquidity", mint: "RaY4AmM3LyQ4uId5OdEaL7StReAm8N1d1Us3X9", tag: "utility", demoUsd: 380 },
  { symbol: "BONK", name: "A community memo", mint: "BoNk0MeM3C0In2MeM3C0In2MeM3C0In2MeM3C0In2M3", tag: "utility", demoUsd: 260 },
  { symbol: "W", name: "Wormhole gateway", mint: "Wm0GaTe2WaY3Ah4Ud5LiNk6Ne7Ss8Tt9Ee0Xx1", tag: "utility", demoUsd: 210 },
  { symbol: "PYUSD", name: " yield-bearing stable", mint: "PyUsD0YeLd3BeA2RiNg4StAbL5Le6P7usD8FoRk9Za1", tag: "stable", demoUsd: 175 },
];

export function searchSupportedTokens(query: string, exclude: string[] = []): SupportedToken[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const banned = new Set(exclude);
  return SUPPORTED_SOLANA_TOKENS.filter(
    (token) => !banned.has(token.symbol) && (token.symbol.toLowerCase().includes(needle) || token.name.toLowerCase().includes(needle)),
  );
}

export interface MintCheck {
  ok: boolean;
  detail: string;
}

// A real RPC round trip: the mint's supply is readable, or the node says why not.
export async function confirmMintOnChain(mint: string): Promise<MintCheck> {
  const trimmed = mint.trim();
  if (trimmed.length < 32 || trimmed.length > 44) {
    return { ok: false, detail: "A base58 mint runs 32 to 44 characters." };
  }
  try {
    const response = await fetch(RPC_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [trimmed] }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    if (typeof payload?.result?.value?.amount === "string") {
      return { ok: true, detail: "On-chain: the supply is readable for this mint." };
    }
    const code = payload?.error?.code;
    const message = payload?.error?.message ?? "The node gave no reason.";
    if (String(message).includes("WrongSize")) return { ok: false, detail: "The node could not read that address (wrong size)." };
    if (String(message).includes("not a Token mint")) return { ok: false, detail: "The account exists, but it is not a token mint." };
    return { ok: false, detail: code === -32009 || code === -32602 ? `Node: ${message}` : message };
  } catch (caught) {
    return { ok: false, detail: caught instanceof Error ? `Node: ${caught.message}` : "The node did not answer." };
  }
}
