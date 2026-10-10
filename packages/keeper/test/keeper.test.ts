import assert from "node:assert/strict";
import test from "node:test";
import { backoffMs, KeeperService } from "../src/keeper.js";
import { FakeRuntime, snapshot, startCandidate } from "./helpers.js";

test("dry-run is the default and never submits", async () => {
  const runtime = new FakeRuntime();
  const results: Array<{ status: string }> = [];
  const service = new KeeperService({ cluster: "localnet", expectedGenesisHash: "localnet-genesis", vaultAddress: runtime.state.vaultAddress }, runtime, { start: startCandidate }, (result) => results.push(result));
  await service.reconcile();
  assert.equal(runtime.simulations, 1);
  assert.equal(runtime.sends, 0);
  assert.equal(results.at(-1)?.status, "simulated");
});

test("retries only after a confirmed failed attempt and rechecks chain sequence", async () => {
  const runtime = new FakeRuntime();
  runtime.confirmationResults = [{ status: "failed", reason: "blockhash expired" }, { status: "confirmed" }];
  const results: Array<{ status: string }> = [];
  const service = new KeeperService({ cluster: "localnet", expectedGenesisHash: "localnet-genesis", vaultAddress: runtime.state.vaultAddress, dryRun: false, maxFeeLamports: 2_000n, maxRetries: 1, retryBaseDelayMs: 0, retryMaxDelayMs: 0 }, runtime, { start: startCandidate }, (result) => results.push(result));
  await service.reconcile();
  assert.equal(runtime.sends, 2);
  assert.equal(runtime.simulations, 2);
  assert.equal(runtime.state.vault.sequence, 4n);
  assert.equal(results.at(-1)?.status, "confirmed");
});

test("keeps uncertain submission pending and does not send a duplicate", async () => {
  const runtime = new FakeRuntime();
  runtime.confirmationResults = [{ status: "unknown" }, { status: "confirmed" }];
  const results: Array<{ status: string }> = [];
  const service = new KeeperService({ cluster: "localnet", expectedGenesisHash: "localnet-genesis", vaultAddress: runtime.state.vaultAddress, dryRun: false, maxFeeLamports: 2_000n }, runtime, { start: startCandidate }, (result) => results.push(result));
  await service.reconcile();
  assert.equal(runtime.sends, 1);
  assert.equal(results.at(-1)?.status, "pending");
  await service.reconcile();
  assert.equal(runtime.sends, 1);
  assert.equal(runtime.state.vault.sequence, 4n);
  assert.equal(results.at(-1)?.status, "confirmed");
});

test("a fresh service restarts from chain and does not repeat an applied start", async () => {
  const runtime = new FakeRuntime();
  runtime.confirmationResults = [{ status: "confirmed" }];
  const options = { cluster: "localnet" as const, expectedGenesisHash: "localnet-genesis", vaultAddress: runtime.state.vaultAddress, dryRun: false, maxFeeLamports: 2_000n };
  await new KeeperService(options, runtime, { start: startCandidate }).reconcile();
  assert.equal(runtime.sends, 1);
  const restarted = new KeeperService(options, runtime, { start: startCandidate });
  await restarted.reconcile();
  assert.equal(runtime.sends, 1);
});

test("retry backoff is exponential and capped", () => {
  assert.equal(backoffMs(0, 100, 350), 100);
  assert.equal(backoffMs(1, 100, 350), 200);
  assert.equal(backoffMs(4, 100, 350), 350);
});


test("account notifications trigger a fresh full reconciliation", async () => {
  const runtime = new FakeRuntime();
  const controller = new AbortController();
  const service = new KeeperService({ cluster: "localnet", expectedGenesisHash: "localnet-genesis", vaultAddress: runtime.state.vaultAddress, pollIntervalMs: 1_000 }, runtime, {});
  const running = service.run(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const readsBefore = runtime.reads;
  runtime.onChange?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await running;
  assert.ok(runtime.reads > readsBefore);
});

test("fee cap prevents submission and uncertain submit RPC results are not blindly retried", async () => {
  const runtime = new FakeRuntime();
  const feeCapped = new KeeperService({ cluster: "localnet", expectedGenesisHash: "localnet-genesis", vaultAddress: runtime.state.vaultAddress, dryRun: false, maxFeeLamports: 499n }, runtime, { start: startCandidate });
  await feeCapped.reconcile();
  assert.equal(runtime.sends, 0);

  const uncertain = new FakeRuntime();
  uncertain.submit = async () => { uncertain.sends++; throw new Error("RPC response lost"); };
  const service = new KeeperService({ cluster: "localnet", expectedGenesisHash: "localnet-genesis", vaultAddress: uncertain.state.vaultAddress, dryRun: false, maxFeeLamports: 2_000n, maxRetries: 4 }, uncertain, { start: startCandidate });
  await service.reconcile();
  assert.equal(uncertain.sends, 1);
});
