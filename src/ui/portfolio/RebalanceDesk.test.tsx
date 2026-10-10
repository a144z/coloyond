import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
  configFile: resolve(process.cwd(), "vite.config.ts"),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

const { RebalanceDesk } = await vite.ssrLoadModule("/src/ui/portfolio/RebalanceDesk.tsx");

function deskView(overrides = {}) {
  const touched: string[] = [];
  return {
    view: {
      assets: [
        { symbol: "SOL", name: "Solana", color: "#ff513b", targetPct: 60, valueUsd: 6000 },
        { symbol: "USDC", name: "USD Coin", color: "#1249ed", targetPct: 40, valueUsd: 4000 },
      ],
      byId: {},
      weights: [60, 40],
      drift: 0,
      totalUsd: 10000,
      targetsTotal: 100,
      triggerPp: 5,
      reserveUsd: 0,
      runs: 0,
      plan: { legs: [], totalFeeUsd: 0, reserveUsd: 0, payoutUsd: 0 },
      status: null,
      phase: "idle",
      stepIndex: -1,
      log: [],
      setTriggerPp: () => undefined,
      setTarget: (symbol: string) => { touched.push(symbol); },
      normalizeTargets: () => undefined,
      simulateMarket: () => undefined,
      rebalanceNow: () => undefined,
      resetBasket: () => undefined,
      ...overrides,
    },
    touched,
  };
}

function render(view: unknown): string {
  return renderToStaticMarkup(createElement(RebalanceDesk, { desk: view }));
}

test("the split block renders one stacked target bar with per-asset colors and shares", () => {
  const { view } = deskView();
  const html = render(view);
  assert.match(html, /class="cr-desk-split"/);
  assert.match(html, /width:60%/);
  assert.match(html, /width:40%/);
  assert.match(html, /background:#ff513b/);
  assert.match(html, /background:#1249ed/);
  assert.match(html, /■ SOL 60%/);
  assert.match(html, /■ USDC 40%/);
});

test("the split slider carries the two-color track gradient and both labels", () => {
  const { view } = deskView();
  const html = render(view);
  assert.match(html, /type="range"/);
  assert.match(html, /--cr-split-track:linear-gradient\(to right, #ff513b 0%, #ff513b 60%, #1249ed 60%, #1249ed 100%\)/);
  assert.match(html, /Slide to set the SOL \/ USDC split/);
  assert.match(html, /SOL 60% · USDC 40%/);
});

test("an off-total split still fills the bar and explains the shares", () => {
  const { view } = deskView({
    assets: [
      { symbol: "SOL", name: "Solana", color: "#ff513b", targetPct: 40, valueUsd: 6000 },
      { symbol: "USDC", name: "USD Coin", color: "#1249ed", targetPct: 50, valueUsd: 4000 },
    ],
    targetsTotal: 90,
  });
  const html = render(view);
  assert.match(html, /width:44\.4\d+%/);
  assert.match(html, /width:55\.5\d+%/);
  assert.match(html, /read your values as shares of a 90% total/);
  assert.match(html, /■ SOL 44%/);
});

test("the split block stays absent for other asset counts", () => {
  const { view } = deskView({ assets: [{ symbol: "SOL", name: "Solana", color: "#ff513b", targetPct: 100, valueUsd: 10000 }] });
  assert.doesNotMatch(render(view), /cr-desk-split"/);
});

test.after(() => vite.close());
