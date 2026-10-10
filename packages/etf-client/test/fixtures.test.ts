import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseReadModelDocument, validateReadModelDocument } from "../src/index.js";

const fixturePath = new URL("../../../docs/rebalancing/contracts/etf-read-model-v1-fixtures.json", import.meta.url);
const document = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

test("shared read-model fixtures pass the TypeScript validator", () => {
  assert.deepEqual(validateReadModelDocument(document), []);
  assert.equal(parseReadModelDocument(document).fixtureOnly, true);
});

test("large slots and token amounts remain decimal strings", () => {
  const parsed = parseReadModelDocument(document);
  const snapshot = parsed.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full");
  assert.ok(snapshot && snapshot.kind === "observation" && snapshot.status === "available");
  assert.equal(snapshot.network.contextSlot, "9007199254740993");
  assert.equal(snapshot.balances?.[0]?.rawAmount, "18446744073709551615");
});

test("unknown receipts cannot opt into automatic resend", () => {
  const bad = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const unknown = bad.fixtures.find((fixture) => fixture.id === "receipt-unknown-must-not-resend")!;
  unknown.automaticResendAllowed = true;
  assert.ok(validateReadModelDocument(bad).some((error) => error.includes("automaticResendAllowed")));
});

test("confirmed receipts require RPC-derived deltas and a confirmation slot", () => {
  const bad = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const confirmed = bad.fixtures.find((fixture) => fixture.id === "receipt-confirmed-with-token-deltas")!;
  delete confirmed.confirmationSlot;
  delete confirmed.tokenDeltas;
  assert.ok(validateReadModelDocument(bad).some((error) => error.includes("confirmationSlot")));
  assert.ok(validateReadModelDocument(bad).some((error) => error.includes("tokenDeltas")));
});

test("draft and awaiting-signature receipts cannot claim confirmed RPC effects", () => {
  for (const status of ["draft", "awaiting_signature"] as const) {
    const bad = structuredClone(document) as { fixtures: Record<string, unknown>[] };
    bad.fixtures.push({
      id: `receipt-${status}-with-fabricated-deltas`,
      kind: "wallet-action",
      status,
      confirmationSlot: "42",
      tokenDeltas: [{ mint: "So11111111111111111111111111111111111111112", rawDelta: "1" }],
      shareDelta: "1",
    });
    const errors = validateReadModelDocument(bad);
    assert.ok(errors.some((error) => error.includes("only confirmed receipts")));
    assert.ok(errors.some((error) => error.includes("unconfirmed receipt cannot assert")));
  }
});

test("oracle omission is allowed but explicit null is malformed", () => {
  const omitted = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const snapshot = omitted.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!;
  delete snapshot.oracle;
  const omittedErrors = validateReadModelDocument(omitted);
  assert.ok(!omittedErrors.some((error) => error.includes("$.fixtures[0].oracle")));

  const explicitNull = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  explicitNull.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!.oracle = null;
  assert.ok(validateReadModelDocument(explicitNull).some((error) => error.includes("oracle: expected object")));
});

test("null protocol revision falls back to config revision", () => {
  const candidate = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const snapshot = candidate.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!;
  snapshot.protocolRevision = null;
  snapshot.configRevision = "fallback-revision";
  assert.deepEqual(validateReadModelDocument(candidate), []);
});

test("snapshot oracle-mode coverage comes from the nested oracle source", () => {
  const candidate = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const snapshot = candidate.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!;
  snapshot.mode = [];
  assert.deepEqual(validateReadModelDocument(candidate), []);
});

test("the shared corpus keeps required tagged-state and precision examples", () => {
  const missing = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  missing.fixtures = missing.fixtures.filter((fixture) =>
    !["oracle-stale", "snapshot-unavailable", "oracle-available-push-feed", "receipt-confirmed-with-token-deltas"].includes(String(fixture.id))
  );
  const errors = validateReadModelDocument(missing);
  assert.ok(errors.some((error) => error.includes("missing stale observation example")));
  assert.ok(errors.some((error) => error.includes("missing unavailable observation example")));
  assert.ok(errors.some((error) => error.includes("missing push_feed oracle-mode example")));
  assert.ok(errors.some((error) => error.includes("missing confirmed wallet-action example")));
});

test("oracle verification is mode-specific", () => {
  const bad = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const push = bad.fixtures.find((fixture) => fixture.id === "oracle-available-push-feed")!;
  push.verification = "full";
  assert.ok(validateReadModelDocument(bad).some((error) => error.includes("push_feed must not invent")));
});

test("unknown enums, unsafe numeric wire values, and missing-vs-zero are rejected", () => {
  const bad = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const snapshot = bad.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!;
  const network = snapshot.network as Record<string, unknown>;
  network.contextSlot = 9007199254740993;
  network.commitment = "fast";
  const oracle = snapshot.oracle as Record<string, unknown>;
  oracle.exponent = 1.5;
  const errors = validateReadModelDocument(bad);
  assert.ok(errors.some((error) => error.includes("contextSlot")));
  assert.ok(errors.some((error) => error.includes("commitment")));
  assert.ok(errors.some((error) => error.includes("exponent")));

  const missing = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const unavailable = missing.fixtures.find((fixture) => fixture.id === "snapshot-unavailable")!;
  unavailable.value = 0;
  assert.ok(validateReadModelDocument(missing).some((error) => error.includes("cannot carry")));
});

test("bounded integer-valued JSON number fields accept integral values and reject booleans", () => {
  const integral = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const snapshot = integral.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!;
  const balances = snapshot.balances as Record<string, unknown>[];
  const oracle = snapshot.oracle as Record<string, unknown>;
  balances[0]!.decimals = 9.0;
  oracle.exponent = -6.0;
  assert.deepEqual(validateReadModelDocument(integral), []);

  const malformed = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const malformedSnapshot = malformed.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!;
  const malformedBalances = malformedSnapshot.balances as Record<string, unknown>[];
  const malformedOracle = malformedSnapshot.oracle as Record<string, unknown>;
  malformedBalances[0]!.decimals = true;
  malformedOracle.exponent = false;
  const errors = validateReadModelDocument(malformed);
  assert.ok(errors.some((error) => error.includes("decimals: expected u8 JSON number")));
  assert.ok(errors.some((error) => error.includes("exponent: expected signed i32 JSON number")));
});

test("available snapshots need their source and a value payload", () => {
  const bad = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  const snapshot = bad.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!;
  delete snapshot.network;
  delete snapshot.balances;
  delete snapshot.oracle;
  assert.ok(validateReadModelDocument(bad).some((error) => error.includes("network")));
  assert.ok(validateReadModelDocument(bad).some((error) => error.includes("value payload")));

  const missingBalances = structuredClone(document) as { fixtures: Record<string, unknown>[] };
  delete missingBalances.fixtures.find((fixture) => fixture.id === "snapshot-available-receiver-full")!.balances;
  assert.ok(validateReadModelDocument(missingBalances).some((error) => error.includes("balances: expected array")));
});
