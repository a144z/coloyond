// Shared loader for the rebalancing tooling: folds the repository-root
// `.env.local` file (gitignored) into process.env without overriding anything
// already set, so the Devnet probes and the drift loop can be configured from
// one file instead of per-run env assignments.
import { existsSync, readFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const repoRoot = new URL("../../", here);
const envPath = new URL(".env.local", repoRoot);

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

export const loaded = existsSync(envPath) ? (() => {
  const lines = readFileSync(envPath, "utf-8").replace(/^\uFEFF/, "").split("\n");
  let applied = 0;
  for (const line of lines) {
    const text = line.trimEnd("\r");
    if (text === "" || text.startsWith("#")) continue;
    const split = text.indexOf("=");
    if (split < 1) continue;
    const key = text.slice(0, split).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || key.startsWith("BASH_")) continue;
    if (process.env[key] !== undefined && process.env[key] !== "") continue;
    process.env[key] = unquote(text.slice(split + 1));
    applied++;
  }
  return applied;
})() : 0;
