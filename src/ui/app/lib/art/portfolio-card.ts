import { CARD_BRAND } from "./brand-data.js";
/** One deterministic artwork engine for app previews, share PNGs and the film. */
export interface CardAsset {
  id: string;
  symbol: string;
  color: string;
  weight: number;
}
export interface PortfolioCardInput {
  id: string;
  name: string;
  assets: CardAsset[];
  remix?: number;
  draft?: boolean;
}
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 1500;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function cardAssets(input: PortfolioCardInput): CardAsset[] {
  const rows = input.assets
    .filter((a) => Number.isFinite(a.weight) && a.weight > 0)
    .map((a) => ({ ...a }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const total = rows.reduce((sum, a) => sum + a.weight, 0);
  return rows.map((a) => ({ ...a, weight: (a.weight / total) * 100 }));
}
export function cardSeed(input: PortfolioCardInput): number {
  const key = JSON.stringify([
    input.id,
    input.remix ?? 0,
    cardAssets(input).map((a) => [a.id, Math.round(a.weight * 10000)]),
  ]);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++)
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}
export function cardFamily(input: PortfolioCardInput) {
  return ["Orbit", "Prism", "Stack"][cardSeed(input) % 3]!;
}
const color = (s: string) => (/^#[\da-f]{6}$/i.test(s) ? s : "#687782");
const point = (angle: number, r: number) => [
  400 + Math.cos(angle) * r,
  380 + Math.sin(angle) * r,
];
const coords = (p: number[]) => p.map((v) => v.toFixed(3)).join(" ");
/** 800×760 geometry: colors identify assets; sector angles/band heights encode target weights. */
export function portfolioGeometry(input: PortfolioCardInput): string {
  const assets = cardAssets(input);
  const seed = cardSeed(input);
  const family = seed % 3;
  if (!assets.length)
    return '<circle cx="400" cy="380" r="240" fill="none" stroke="#d8d4ca" stroke-width="2"/><text x="400" y="390" text-anchor="middle" font-size="20" fill="#747069">Choose your assets</text>';
  let accumulated = 0;
  const shapes = assets
    .map((a, i) => {
      const share = a.weight / 100;
      const before = accumulated;
      accumulated += share;
      const fill = color(a.color);
      if (family === 0) {
        const start = before * Math.PI * 2 - 0.5 * Math.PI;
        const end = accumulated * Math.PI * 2 - 0.5 * Math.PI;
        const radius = 270 + ((seed >>> ((i % 4) * 4)) & 15);
        const inner = 120;
        // Split a complete circle into two arcs; SVG's start=end arc would otherwise disappear.
        const mid = (start + end) / 2;
        const large = end - start > Math.PI ? 1 : 0;
        const path =
          share > 0.999999
            ? `M ${coords(point(start, radius))} A ${radius} ${radius} 0 1 1 ${coords(point(mid, radius))} A ${radius} ${radius} 0 1 1 ${coords(point(end, radius))} L ${coords(point(end, inner))} A ${inner} ${inner} 0 1 0 ${coords(point(mid, inner))} A ${inner} ${inner} 0 1 0 ${coords(point(start, inner))} Z`
            : `M ${coords(point(start, radius))} A ${radius} ${radius} 0 ${large} 1 ${coords(point(end, radius))} L ${coords(point(end, inner))} A ${inner} ${inner} 0 ${large} 0 ${coords(point(start, inner))} Z`;
        return `<path d="${path}" fill="${fill}" stroke="#efece6" stroke-width="4"/>`;
      }
      if (family === 1) {
        const x = 690 - (seed % 60),
          y = 70 + before * 620,
          z = 70 + accumulated * 620;
        return `<polygon points="100,380 ${x},${y.toFixed(3)} ${x},${z.toFixed(3)}" fill="${fill}" stroke="#efece6" stroke-width="3"/>`;
      }
      const height = 600 * share,
        x = 100 + ((seed >>> (i * 4)) & 63),
        width = 450 + share * 130;
      return `<rect x="${x}" y="${80 + before * 600}" width="${width}" height="${height}" fill="${fill}" stroke="#efece6" stroke-width="3"/>`;
    })
    .join("");
  return `<g transform="rotate(${((seed >>> 16) % 13) - 6} 400 380)">${shapes}<path d="M 70 720 H 730 M 400 40 V 52 M 400 708 V 720" stroke="#141414" stroke-width="2" fill="none"/></g>`;
}
/** Self-contained SVG: no network assets, wallet addresses, balances or external font dependencies. */
export function portfolioCardSvg(input: PortfolioCardInput): string {
  const rows = cardAssets(input);
  const name = Array.from(input.name.trim() || "Untitled mix")
    .slice(0, 38)
    .join("");
  const first = Array.from(name).slice(0, 22).join("");
  const second = Array.from(name).slice(22).join("");
  let x = 80;
  const strip = rows
    .map((a) => {
      const width = (1040 * a.weight) / 100;
      const s = `<rect x="${x}" y="1100" width="${width}" height="22" fill="${color(a.color)}"/>`;
      x += width;
      return s;
    })
    .join("");
  const legend = rows
    .slice(0, 4)
    .map((a, i) => {
      const x = 80 + (i % 2) * 535,
        y = 1190 + Math.floor(i / 2) * 68;
      return `<circle cx="${x + 8}" cy="${y - 8}" r="8" fill="${color(a.color)}"/><text x="${x + 28}" y="${y}" font-size="25" font-weight="700">${escape(a.symbol.slice(0, 12))}</text><text x="${x + 410}" y="${y}" text-anchor="end" font-size="25">${Number(a.weight.toFixed(2))} %</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500"><rect width="1200" height="1500" fill="#efece6"/><g fill="#141414" font-family="Arial, Helvetica, sans-serif"><image href="${CARD_BRAND}" x="80" y="54" width="64" height="64"/><text x="166" y="95" font-size="28" font-weight="700" letter-spacing="2">COLOYOND</text><text x="1120" y="92" text-anchor="end" font-size="16" letter-spacing="2">YOUR MIX. YOUR RHYTHM.</text><path d="M80 130 H1120" stroke="#d8d4ca"/><text x="80" y="191" font-size="18" letter-spacing="2" fill="#747069">${input.draft ? "DRAFT" : "TARGET"} COMPOSITION / ${cardFamily(input).toUpperCase()} / REMIX ${input.remix ?? 0}</text><text x="80" y="266" font-size="58" font-weight="700" letter-spacing="-2">${escape(first)}</text>${second ? `<text x="80" y="332" font-size="58" font-weight="700" letter-spacing="-2">${escape(second)}</text>` : ""}<g transform="translate(200 350) scale(1)">${portfolioGeometry(input)}</g>${strip}${legend}<path d="M80 1360 H1120" stroke="#d8d4ca"/><text x="80" y="1410" font-size="21">Your portfolio as one picture.</text><text x="80" y="1448" font-size="16" fill="#747069">SOLANA DEVNET · TARGET WEIGHTS, NOT LIVE HOLDINGS · ${input.draft ? "DRAFT MIX" : "VISUAL COMPOSITION"}</text><text x="1120" y="1410" text-anchor="end" font-size="18">coloyond /app</text></g></svg>`;
}
export const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
export function cardFilename(input: PortfolioCardInput): string {
  return `coloyond-${
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40) || "portfolio"
  }-remix-${input.remix ?? 0}.png`;
}
export async function renderCardPng(input: PortfolioCardInput): Promise<Blob> {
  if (!cardAssets(input).length)
    throw new Error("Choose at least one asset before exporting.");
  const image = new Image();
  image.src = svgDataUrl(portfolioCardSvg(input));
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PNG rendering is unavailable in this browser.");
  ctx.drawImage(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not render the PNG.")),
      "image/png",
    ),
  );
}
