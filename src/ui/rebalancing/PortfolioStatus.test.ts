import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import type { ReadModelV1 } from "./types.js";

const vite = await createServer({
  configFile: resolve(process.cwd(), "vite.config.ts"),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

const [{ PortfolioStatus }, { READ_MODEL_FIXTURES }] = await Promise.all([
  vite.ssrLoadModule("/src/ui/rebalancing/PortfolioStatus.tsx"),
  vite.ssrLoadModule("/src/ui/rebalancing/fixtures/readModelFixtures.ts"),
]);

function render(model: ReadModelV1): string {
  return renderToStaticMarkup(createElement(PortfolioStatus, { model }));
}

test("labels fixture data and keeps unavailable values unknown", () => {
  const html = render(READ_MODEL_FIXTURES.unavailable);

  assert.match(html, /Synthetic fixture · sample data/);
  assert.match(html, /not a live cluster observation/);
  assert.match(html, /Age at display · Unknown/);
  assert.match(html, /Actual composition is unknown/);
  assert.match(html, /Executable quote<\/dt><dd>Not provided/);
  assert.match(html, /In-kind exit<\/dt><dd>Unknown/);
  assert.doesNotMatch(html, /USD 0|0\.00%/);
});

test("shows oracle stale state, age, verification and publish time as reported", () => {
  const model: ReadModelV1 = structuredClone(READ_MODEL_FIXTURES.unavailable);
  model.source = {
    kind: "rpc",
    providerLabel: "Local RPC",
    observedAt: "2000-01-01T00:00:00.000Z",
    slot: "9007199254740993",
  };
  model.oracle = [{
    feedId: "feed:sol-usd",
    publishTime: "946684800",
    ageSeconds: 901,
    verification: "partial",
    confidenceBps: null,
    state: "stale",
  }];

  const html = render(model);

  assert.match(html, /RPC-reported snapshot/);
  assert.match(html, /Local RPC/);
  assert.match(html, /Age at display · \d+ days ago/);
  assert.match(html, /9007199254740993/);
  assert.match(html, /feed:sol-usd/);
  assert.match(html, /stale/);
  assert.match(html, /partial/);
  assert.match(html, /901 sec/);
  assert.match(html, /946684800 Unix seconds/);
  assert.match(html, /Confidence<\/dt><dd>Unknown/);
});

test("does not convert invalid allocation into a zero-percent bar", () => {
  const model: ReadModelV1 = structuredClone(READ_MODEL_FIXTURES.unavailable);
  model.vault.target = [{ mint: "mint-example", symbol: "TEST", weightBps: -1 }];

  const html = render(model);

  assert.match(html, /Unknown weight/);
  assert.match(html, /Allocation bar omitted because this weight is invalid/);
  assert.doesNotMatch(html, /width:0%/);
});

test("does not imply an in-kind exit when the exit mode is unknown", () => {
  const model: ReadModelV1 = structuredClone(READ_MODEL_FIXTURES.unavailable);
  model.vault.exit = { available: true, mode: "unknown" };
  model.auction = { sequence: null, remaining: null, expiresAt: null, feeBps: null };
  model.reserve = { amountByMint: {}, bountyLiabilityByMint: {} };

  const html = render(model);

  assert.match(html, /Auction fee<\/dt><dd>Unknown/);
  assert.match(html, /Exit availability<\/dt><dd>Unknown/);
  assert.match(html, /In-kind exit<\/dt><dd>Unknown/);
  assert.match(html, /No token entries in this snapshot/);
});

test.after(async () => {
  await vite.close();
});
