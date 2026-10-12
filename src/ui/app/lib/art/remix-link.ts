import type { PortfolioCardInput } from "./portfolio-card.js";
import { cardAssets } from "./portfolio-card.js";
const IDS = ["wsol", "dusd", "tbtc", "teth"] as const;
export function remixLink(input: PortfolioCardInput, origin: string): string {
  const url = new URL("/app", origin);
  url.searchParams.set(
    "mix",
    JSON.stringify({
      name: input.name.slice(0, 40),
      targets: Object.fromEntries(
        cardAssets(input).map((a) => [a.id, Number(a.weight.toFixed(4))]),
      ),
    }),
  );
  return url.href;
}
/** Untrusted URLs only prefill an unsigned draft. No addresses, funds or wallet actions. */
export function readSharedMix(
  search: string,
): { name: string; targets: Record<string, number> } | null {
  const raw = new URLSearchParams(search).get("mix");
  if (!raw || raw.length > 2048) return null;
  try {
    const data = JSON.parse(raw);
    if (
      typeof data.name !== "string" ||
      !data.targets ||
      typeof data.targets !== "object" ||
      Array.isArray(data.targets)
    )
      return null;
    if (
      Object.keys(data.targets).some(
        (id) => !IDS.includes(id as (typeof IDS)[number]),
      )
    )
      return null;
    const entries = IDS.map((id) => [id, data.targets[id] ?? 0] as const);
    if (
      entries.some(
        ([, n]) =>
          typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100,
      )
    )
      return null;
    const sum = entries.reduce((n, [, w]) => n + w, 0);
    if (sum <= 0) return null;
    return {
      name: Array.from(data.name.trim() || "Community mix")
        .slice(0, 40)
        .join(""),
      targets: Object.fromEntries(
        entries.map(([id, n]) => [id, (n / sum) * 100]),
      ),
    };
  } catch {
    return null;
  }
}
