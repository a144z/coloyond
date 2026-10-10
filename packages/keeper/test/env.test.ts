import assert from "node:assert/strict";
import test from "node:test";
import { keeperConfigFromEnvironment } from "../src/env.js";

const base = {
  COLOYOND_KEEPER_CLUSTER: "localnet",
  COLOYOND_KEEPER_RPC_URL: "http://127.0.0.1:8899",
  COLOYOND_KEEPER_GENESIS_HASH: "localnet-genesis-hash",
  COLOYOND_KEEPER_VAULT_ADDRESS: "DVZ7tQAgko19RNUXKcMU1RXtcqff2kT415C6JA49NMMQ",
  COLOYOND_KEEPER_PUBLIC_KEY: "11111111111111111111111111111111",
};

test("environment defaults to dry-run and rejects mainnet", () => {
  assert.equal(keeperConfigFromEnvironment(base).dryRun, true);
  assert.throws(() => keeperConfigFromEnvironment({ ...base, COLOYOND_KEEPER_CLUSTER: "mainnet-beta" }), /mainnet is not supported/);
  assert.throws(() => keeperConfigFromEnvironment({ ...base, COLOYOND_KEEPER_DRY_RUN: "maybe" }), /must be true or false/);
});

test("submission requires an explicit positive transaction fee cap", () => {
  assert.throws(() => keeperConfigFromEnvironment({ ...base, COLOYOND_KEEPER_DRY_RUN: "false" }), /MAX_FEE_LAMPORTS/);
  assert.equal(keeperConfigFromEnvironment({ ...base, COLOYOND_KEEPER_DRY_RUN: "false", COLOYOND_KEEPER_MAX_FEE_LAMPORTS: "5000" }).maxFeeLamports, 5000n);
});
