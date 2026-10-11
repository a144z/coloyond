import assert from "node:assert/strict";
import test from "node:test";
import { EXECUTION_PROVIDERS, executionProvider, executionSelectionFromEnvironment, isExecutionProviderId, selectExecutionProvider } from "../src/executionLayer.js";

test("defaults to manual poke when nothing is admitted", () => {
  const selection = selectExecutionProvider();
  assert.equal(selection.provider.id, "manual-poke");
  assert.equal(selection.fallback, null);
  assert.match(selection.reason, /fallback/);
});

test("selects magicblock as first priority when admitted", () => {
  for (const admitted of [["magicblock"], ["magicblock", "tuktuk"], ["tuktuk", "magicblock"], ["magicblock", "magicblock"]]) {
    assert.equal(selectExecutionProvider(admitted).provider.id, "magicblock");
  }
});

test("falls to tuktuk when only tuktuk is admitted", () => {
  const selection = selectExecutionProvider(["tuktuk"]);
  assert.equal(selection.provider.id, "tuktuk");
  assert.equal(selection.provider.priority, 2);
  assert.equal(selection.fallback?.id, "manual-poke");
});

test("rejects unknown admissions fail-closed", () => {
  assert.throws(() => selectExecutionProvider(["tuktuk", "hydra"]), /Unknown execution provider admission/);
});

test("recurring providers need an external crank and manual does not", () => {
  assert.equal(EXECUTION_PROVIDERS.length, 3);
  assert.deepEqual(EXECUTION_PROVIDERS.map((provider) => provider.id), ["magicblock", "tuktuk", "manual-poke"]);
  assert.equal(executionProvider("magicblock").needsExternalCrank, true);
  assert.equal(executionProvider("tuktuk").needsExternalCrank, true);
  assert.equal(executionProvider("manual-poke").needsExternalCrank, false);
  assert.equal(executionProvider("manual-poke").recurring, false);
});

test("recognises provider ids exactly", () => {
  assert.equal(isExecutionProviderId("magicblock"), true);
  assert.equal(isExecutionProviderId("MagicBlock"), false);
  assert.equal(isExecutionProviderId(""), false);
});

test("reads admissions from the environment, comma separated and fail-closed", () => {
  assert.equal(executionSelectionFromEnvironment({}).provider.id, "manual-poke");
  assert.equal(executionSelectionFromEnvironment({ COLOYOND_KEEPER_EXECUTION_PROVIDER: " " }).provider.id, "manual-poke");
  assert.equal(executionSelectionFromEnvironment({ COLOYOND_KEEPER_EXECUTION_PROVIDER: "magicblock , tuktuk" }).provider.id, "magicblock");
  assert.equal(executionSelectionFromEnvironment({ COLOYOND_KEEPER_EXECUTION_PROVIDER: "tuktuk" }).provider.id, "tuktuk");
  assert.throws(() => executionSelectionFromEnvironment({ COLOYOND_KEEPER_EXECUTION_PROVIDER: "hydra" }), /Unknown execution provider admission/);
});
