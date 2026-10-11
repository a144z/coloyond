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
const { sharesForSet, sharesForTransfer } = await vite.ssrLoadModule("/src/ui/portfolio/rebalance.ts");

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

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

test("the allocation bar draws target segments and one draggable handle per boundary", () => {
  const { view } = deskView();
  const html = render(view);
  assert.match(html, /class="cr-desk-allocation"/);
  assert.equal(count(html, /data-allocation-segment=/g), 2);
  assert.match(html, /width:60%/);
  assert.match(html, /width:40%/);
  assert.match(html, /background:#ff513b/);
  assert.match(html, /background:#1249ed/);
  assert.equal(count(html, /data-allocation-handle=/g), 1);
  assert.match(html, /data-allocation-handle="SOL\|USDC"/);
  assert.match(html, /aria-valuetext="SOL 60%, USDC 40%"/);
});

test("the live allocation shows as one straight dashed line and signed deltas", () => {
  const { view } = deskView({ weights: [70, 30], drift: 20 });
  const html = render(view);
  assert.doesNotMatch(html, /data-allocation-ghost-segment=/);
  assert.equal(count(html, /data-allocation-ghost-line=/g), 1);
  assert.match(html, /left:70%/);
  assert.match(html, /\+10 pp/);
  assert.match(html, /-10 pp/);
});

test("on-target rows read as on live", () => {
  const { view } = deskView();
  assert.equal(count(render(view), /on live/g), 2);
});

test("each asset row carries a synced slider and percent text field", () => {
  const { view } = deskView();
  const html = render(view);
  assert.equal(count(html, /type="range"/g), 2);
  assert.match(html, /aria-label="Target slider for SOL"/);
  assert.match(html, /aria-label="Target slider for USDC"/);
  assert.match(html, /--cr-split-track:linear-gradient\(to right, #ff513b 0%, #ff513b 60%/);
  assert.equal(count(html, /type="number"/g), 2);
  assert.match(html, /aria-label="Target percent for SOL"/);
  assert.match(html, /value="60"/);
  assert.match(html, /value="40"/);
});

test("an off-total draft still fills the bar as shares of the draft total", () => {
  const { view } = deskView({
    assets: [
      { symbol: "SOL", name: "Solana", color: "#ff513b", targetPct: 40, valueUsd: 6000 },
      { symbol: "USDC", name: "USD Coin", color: "#1249ed", targetPct: 50, valueUsd: 4000 },
    ],
    targetsTotal: 90,
  });
  const html = render(view);
  assert.match(html, /width:44\.44\d+%/);
  assert.match(html, /width:55\.55\d+%/);
});

test("the old split slider block is gone", () => {
  const { view } = deskView();
  const html = render(view);
  assert.doesNotMatch(html, /cr-desk-split/);
  assert.doesNotMatch(html, /Slide to set/);
});

test("sharesForSet moves one share and rescales the others to an exact 100 total", () => {
  assert.deepEqual(sharesForSet([{ symbol: "SOL", targetPct: 60 }, { symbol: "USDC", targetPct: 40 }], "SOL", 80), [
    { symbol: "SOL", targetPct: 80 },
    { symbol: "USDC", targetPct: 20 },
  ]);
  const odd = sharesForSet([{ symbol: "A", targetPct: 30 }, { symbol: "B", targetPct: 20 }, { symbol: "C", targetPct: 50 }], "B", 0);
  assert.equal(odd.reduce((sum: number, share: { targetPct: number }) => sum + share.targetPct, 0), 100);
  assert.equal(odd[1].targetPct, 0);
  assert.deepEqual(sharesForSet([{ symbol: "SOL", targetPct: 60 }], "MISSING", 10), [{ symbol: "SOL", targetPct: 60 }]);
});

test("sharesForTransfer trades only between the pair and clamps inside it", () => {
  assert.deepEqual(sharesForTransfer([{ symbol: "SOL", targetPct: 60 }, { symbol: "USDC", targetPct: 40 }], "SOL", "USDC", 75), [
    { symbol: "SOL", targetPct: 75 },
    { symbol: "USDC", targetPct: 25 },
  ]);
  const clamped = sharesForTransfer([{ symbol: "SOL", targetPct: 60 }, { symbol: "USDC", targetPct: 40 }], "SOL", "USDC", 120);
  assert.deepEqual(clamped, [{ symbol: "SOL", targetPct: 100 }, { symbol: "USDC", targetPct: 0 }]);
  const untouched = sharesForTransfer([{ symbol: "SOL", targetPct: 60 }, { symbol: "USDC", targetPct: 40 }], "SOL", "MISSING", 10);
  assert.deepEqual(untouched, [{ symbol: "SOL", targetPct: 60 }, { symbol: "USDC", targetPct: 40 }]);
});

test.after(() => vite.close());
