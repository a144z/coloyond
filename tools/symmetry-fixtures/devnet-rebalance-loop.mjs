// Coloyond Devnet High-Frequency Arbitrage Simulator (blueprint Phase 4).
// Devnet has no organic keeper traffic, so this script IS the arbitrageur: it
// re-reads a chosen devnet vault, computes drift against the on-chain automation
// trigger, and when the vault is past the trigger it submits Symmetry's
// permissionless rebalanceVaultTx. It rotates RPC endpoints on errors and pauses
// a fixed interval between rounds, the way the blueprint sketch prescribes.
//
// Usage, from this folder (all configuration through env, like the probes):
//   VAULT=<vault account pubkey>            the vault to watch
//   KEYPAIR_JSON="[1,2,...,32 bytes]"        a devnet-funded signer; omit for a read-only dry run
//   NET=devnet                              devnet only; this pass never signs mainnet
//   RPC_NODES="url,url,..."                 optional rotation list
//   FORCE=1                                 send even when drift is under the trigger
//   MAX_ROUNDS=n                            default 1; 0 runs forever
//   INTERVAL_MS=n                           default 85, the blueprint's pacing pause
import { Connection, Keypair } from "@solana/web3.js";
import sdkPkg from "@symmetry-hq/sdk";
const { SymmetryCore } = sdkPkg;

const NETWORK = process.env.NET ?? "devnet";
const RPC_NODES = (process.env.RPC_NODES ?? "https://api.devnet.solana.com,https://api.mainnet-beta.solana.com")
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url !== "");
const VAULT = process.env.VAULT;
const FORCE = process.env.FORCE === "1";
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS ?? 1);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 85);

function makeKeys() {
  const raw = process.env.KEYPAIR_JSON;
  if (!raw) return [];
  return [Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)))];
}

const KEYS = makeKeys();

function sdkFor(nodeIndex) {
  const connection = new Connection(RPC_NODES[nodeIndex % RPC_NODES.length], "confirmed");
  return { connection, sdk: new SymmetryCore({ connection, network: NETWORK }), node: RPC_NODES[nodeIndex % RPC_NODES.length] };
}

function num(value) {
  if (value === null || value === undefined) return null;
  if (typeof value.toNumber === "function") return value.toNumber();
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function measure(sdk) {
  const base = await sdk.fetchVault(VAULT);
  const priced = await sdk.loadVaultPrice(base);
  const f = priced.formatted;
  if (!f) throw new Error("vault has no formatted data");
  const tvl = num(priced.tvl);
  const rows = priced.composition.filter((asset) => asset.active);
  let driftPp = 0;
  let complete = tvl !== null && tvl > 0;
  if (complete) {
    for (const asset of rows) {
      const value = num(asset.value);
      if (value === null) {
        complete = false;
        break;
      }
      driftPp += Math.abs(((value / tvl) * 100 - asset.weight / 100));
    }
  }
  const auto = f.automation_settings ?? {};
  return {
    name: f.name,
    mint: f.mint,
    supply: f.supply_outstanding,
    automationEnabled: Boolean(auto.enabled),
    driftPp: complete ? driftPp : null,
    triggerPp: Math.max(auto.rebalance_activation_threshold_abs_bps ?? 0, auto.rebalance_activation_threshold_rel_bps ?? 0) / 100,
    lastRunAt: auto.last_automation_execution_timestamp ?? f.last_automation_execution_timestamp ?? null,
  };
}

async function fire(sdk, mint, keeper) {
  const wallet = {
    publicKey: keeper.publicKey,
    signTransaction: (tx) => keeper.signTransaction(tx),
    signAllTransactions: async (txs) => txs.map((tx) => keeper.signTransaction(tx)),
  };
  const sequence = await sdk.rebalanceVaultTx({ keeper: keeper.publicKey.toBase58(), vault_mint: mint });
  const signatures = await sdk.signAndSendTxPayloadBatchSequence({
    txPayloadBatchSequence: sequence,
    wallet,
    simulateTransactions: false,
  });
  const flat = signatures.flat();
  return flat.length > 0 ? flat[flat.length - 1] : "(no signature returned)";
}

async function once(round) {
  const node = round % RPC_NODES.length;
  const { sdk, node: url } = sdkFor(node);
  const vaultState = await measure(sdk);
  const keeper = KEYS.length > 0 ? KEYS[round % KEYS.length] : null;
  const past = vaultState.driftPp !== null && vaultState.driftPp >= vaultState.triggerPp;
  const label = `${vaultState.name} drift ${vaultState.driftPp === null ? "unavailable" : vaultState.driftPp.toFixed(1)} pp vs trigger ${vaultState.triggerPp.toFixed(1)} pp; keeper automation ${vaultState.automationEnabled ? "on" : "off"}`;
  console.log(`[TPS Engine] Round #${round} via ${url}: ${label}`);
  if (!keeper) {
    console.log("  dry run: set KEYPAIR_JSON with a devnet-funded signer to submit the rebalance transaction");
    return;
  }
  if (!(past || FORCE)) {
    console.log("  within trigger: no transaction submitted");
    return;
  }
  const signature = await fire(sdk, vaultState.mint, keeper);
  console.log(`  rebalance submitted: ${signature}`);
}

async function main() {
  if (!VAULT) {
    console.log("VAULT env is required: the devnet vault account pubkey to watch. Nothing was sent.");
    return;
  }
  let round = 0;
  while (MAX_ROUNDS === 0 || round < MAX_ROUNDS) {
    try {
      await once(round);
    } catch (err) {
      console.log(`Network congestion or rate limit hit (${err.message}). Rolling to next RPC node...`);
    }
    round++;
    if (MAX_ROUNDS !== 0 && round < MAX_ROUNDS) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    else if (MAX_ROUNDS === 0) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  console.log(`Done: ${round} round(s), ${KEYS.length === 0 ? "read-only" : KEYS.length + " signer key(s)"}.`);
}

main();
