// Holds which tokens the visitor watches. The selection persists in local
// storage, so a reload keeps the set; the seed follows the strategy basket
// shown under “Target and actual”, with SOL in place of its sample LP share,
// which has no real mint. Tokens are keyed by mint: two mints can
// share a symbol.
import { useCallback, useEffect, useState } from "react";
import { SUPPORTED_SOLANA_TOKENS, type SupportedToken, type TokenTag } from "./tokenRegistry.js";

// v2: v1 entries held placeholder mints.
const STORAGE_KEY = "coloyond.portfolio-tokens.v2";
const SEED_SYMBOLS = ["USDC", "jitoSOL", "mSOL", "SOL"];

function seedTokens(): SupportedToken[] {
  return SEED_SYMBOLS.map((symbol) => SUPPORTED_SOLANA_TOKENS.find((token) => token.symbol === symbol)).filter((token): token is SupportedToken => token !== undefined);
}

const TAGS: readonly TokenTag[] = ["core", "stable", "staking", "utility", "custom"];

// Storage is untrusted: an old schema, a hand edit, or another tab can put anything there.
function isStoredToken(value: unknown): value is SupportedToken {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.symbol === "string"
    && typeof entry.name === "string"
    && typeof entry.mint === "string" && entry.mint.length >= 32 && entry.mint.length <= 44
    && TAGS.includes(entry.tag as TokenTag)
    && typeof entry.demoUsd === "number" && Number.isFinite(entry.demoUsd) && entry.demoUsd >= 0;
}

function loadTokens(): SupportedToken[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return seedTokens();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seedTokens();
    // An empty array is a choice the visitor made; keep it. Drop invalid entries and duplicate mints.
    const seen = new Set<string>();
    return parsed.filter(isStoredToken).filter((token) => !seen.has(token.mint) && seen.add(token.mint) !== undefined);
  } catch {
    return seedTokens();
  }
}

function saveTokens(tokens: SupportedToken[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // A private window can lose the copy; the session still holds the set.
  }
}

export interface PortfolioTokensState {
  tokens: SupportedToken[];
  add: (token: SupportedToken) => void;
  remove: (mint: string) => void;
  reset: () => void;
  totalDemoUsd: number;
}

export function usePortfolioTokens(): PortfolioTokensState {
  const [tokens, setTokens] = useState<SupportedToken[]>(loadTokens);

  // Persist after commit; state updaters stay pure because React may run them twice.
  useEffect(() => saveTokens(tokens), [tokens]);

  const add = useCallback((token: SupportedToken) => {
    setTokens((current) => (current.some((entry) => entry.mint === token.mint) ? current : [...current, token]));
  }, []);

  const remove = useCallback((mint: string) => {
    setTokens((current) => current.filter((entry) => entry.mint !== mint));
  }, []);

  const reset = useCallback(() => setTokens(seedTokens()), []);

  const totalDemoUsd = tokens.reduce((sum, token) => sum + token.demoUsd, 0);

  return { tokens, add, remove, reset, totalDemoUsd };
}
