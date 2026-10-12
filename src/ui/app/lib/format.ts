/** Formatting helpers. All display numbers come from live RPC or feed responses. */

export const SOL_DECIMALS = 9;
export const USD_DECIMALS = 6;

export function fmtSol(lamports: number, maxDecimals = 4): string {
  return trimZeros((lamports / 1e9).toFixed(maxDecimals));
}

export function fmtSolFull(lamports: number): string {
  // raw precision view used by the blocked / holdings state
  return (lamports / 1e9).toFixed(9);
}

export function fmtUsdRaw(raw: number, maxDecimals = 2): string {
  return trimZeros((raw / 1e6).toFixed(maxDecimals));
}

export function fmtUsdRawFull(raw: number): string {
  return (raw / 1e6).toFixed(6);
}

export function fmtUsd(usd: number): string {
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function fmtPct(x: number, decimals = 2): string {
  return `${x.toFixed(decimals)}%`;
}

export function fmtTimeAgo(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function shortKey(key: string, edges = 4): string {
  if (key.length <= edges * 2 + 3) return key;
  return `${key.slice(0, edges)}...${key.slice(-edges)}`;
}

export function shortSig(sig: string): string {
  return `${sig.slice(0, 8)}...${sig.slice(-6)}`;
}

/** Parse a decimal user input into a number, or null when invalid. */
export function parseAmount(input: string): number | null {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Like parseAmount, but empty or zero is a valid zero (deposit fields). */
export function parseAmountOrZero(input: string): number | null {
  const trimmed = input.trim().replace(',', '.');
  if (trimmed === '') return 0;
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '.') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function lamportsFromSol(sol: number): number {
  return Math.floor(sol * 1e9);
}

export function rawFromUsd(usd: number): number {
  return Math.floor(usd * 1e6);
}

/* ---------------- generic token amounts (any asset decimals) ---------------- */

export function fmtToken(raw: number, decimals: number, maxDecimals = 4): string {
  return trimZeros((raw / 10 ** decimals).toFixed(maxDecimals));
}

export function fmtTokenFull(raw: number, decimals: number): string {
  return (raw / 10 ** decimals).toFixed(decimals);
}

export function rawFromToken(units: number, decimals: number): number {
  return Math.floor(units * 10 ** decimals);
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '') || '0';
}
