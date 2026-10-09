// Holds which tokens the visitor watches. The selection persists in local
// storage, so a reload keeps the set; the seed mirrors the strategy basket
// shown under “Target and actual”.
import { useCallback, useState } from "react";
import { SUPPORTED_SOLANA_TOKENS, type SupportedToken } from "./tokenRegistry.js";

const STORAGE_KEY = "coloyond.portfolio-tokens.v1";
const SEED_SYMBOLS = ["USDC", "jitoSOL", "mSOL", "cbLP"];

function seedTokens(): SupportedToken[] {
  return SEED_SYMBOLS.map((symbol) => SUPPORTED_SOLANA_TOKENS.find((token) => token.symbol === symbol)).filter((token): token is SupportedToken => token !== undefined);
}

function loadTokens(): SupportedToken[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return seedTokens();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as SupportedToken[];
    return seedTokens();
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
  has: (symbol: string) => boolean;
  add: (token: SupportedToken) => void;
  remove: (symbol: string) => void;
  reset: () => void;
  totalDemoUsd: number;
}

export function usePortfolioTokens(): PortfolioTokensState {
  const [tokens, setTokens] = useState<SupportedToken[]>(loadTokens);

  const update = useCallback((next: SupportedToken[]) => {
    saveTokens(next);
    setTokens(next);
  }, []);

  const has = useCallback((symbol: string) => tokens.some((token) => token.symbol === symbol), [tokens]);

  const add = useCallback((token: SupportedToken) => {
    setTokens((current) => {
      if (current.some((entry) => entry.symbol === token.symbol)) return current;
      const next = [...current, token];
      saveTokens(next);
      return next;
    });
  }, []);

  const remove = useCallback((symbol: string) => {
    setTokens((current) => {
      const next = current.filter((entry) => entry.symbol !== symbol);
      saveTokens(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => update(seedTokens()), [update]);

  const totalDemoUsd = tokens.reduce((sum, token) => sum + token.demoUsd, 0);

  return { tokens, has, add, remove, reset, totalDemoUsd };
}
