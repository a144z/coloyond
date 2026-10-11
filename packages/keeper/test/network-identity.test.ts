import assert from "node:assert/strict";
import test from "node:test";
import {
  assertClusterGenesisConfiguration,
  assertClusterRpcUrl,
  assertRpcClusterGenesis,
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  TESTNET_GENESIS_HASH,
} from "../src/networkIdentity.js";

test("Devnet requires the genesis hash confirmed by independent live RPCs", () => {
  assertClusterGenesisConfiguration("devnet", DEVNET_GENESIS_HASH);
  assertRpcClusterGenesis("devnet", DEVNET_GENESIS_HASH, DEVNET_GENESIS_HASH);
  assert.throws(() => assertClusterGenesisConfiguration("devnet", "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC"), /current pinned/);
});

test("Localnet rejects public cluster genesis hashes", () => {
  for (const publicGenesis of [DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH, TESTNET_GENESIS_HASH]) {
    assert.throws(() => assertClusterGenesisConfiguration("localnet", publicGenesis), /public Solana cluster/);
  }
  assertClusterGenesisConfiguration("localnet", "localnet-genesis-hash");
});

test("RPC must match the exact configured identity even on loopback Localnet", () => {
  assertRpcClusterGenesis("localnet", "localnet-genesis-hash", "localnet-genesis-hash");
  assert.throws(() => assertRpcClusterGenesis("localnet", "localnet-genesis-hash", MAINNET_GENESIS_HASH), /does not match/);
  assert.throws(() => assertRpcClusterGenesis("devnet", DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH), /does not match/);
});

test("Localnet keeper endpoints must resolve through an explicit loopback URL", () => {
  for (const endpoint of ["http://127.0.0.1:8899", "http://localhost:8899", "http://[::1]:8899"]) {
    assertClusterRpcUrl("localnet", endpoint);
  }
  assertClusterRpcUrl("devnet", "https://rpc.example.com");
  for (const endpoint of ["https://api.devnet.solana.com", "http://192.168.1.10:8899", "http://localhost.evil.example:8899", "http://user:pass@localhost:8899", "not-a-url"]) {
    assert.throws(() => assertClusterRpcUrl("localnet", endpoint), /loopback/);
  }
});
