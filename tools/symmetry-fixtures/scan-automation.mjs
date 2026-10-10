// Read-only: which mainnet vaults allow keeper automation, with their thresholds.
import { Connection } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";
const sdk = new SymmetryCore({ connection: new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed"), network: "mainnet" });
const vaults = (await sdk.fetchAllVaults()).map(v => v.formatted);
const rows = vaults.map(f => ({
  name: f.name.slice(0, 28), pubkey: f.pubkey, assets: f.composition.filter(a => a.weight > 0).length, supply: f.supply_outstanding,
  allowAuto: f.automation_settings.allow_automation, absBps: f.automation_settings.rebalance_activation_threshold_abs_bps,
  relBps: f.automation_settings.rebalance_activation_threshold_rel_bps, cooldown: f.automation_settings.rebalance_activation_cooldown,
  lastAuto: f.last_automation_execution_timestamp ? new Date(f.last_automation_execution_timestamp * 1000).toISOString().slice(0, 10) : 0,
  bounty: f.bounty_balance,
}));
rows.sort((a, b) => (b.allowAuto - a.allowAuto) || (b.supply - a.supply));
console.table(rows.map(({ pubkey, ...r }) => r));
console.log(JSON.stringify(rows.filter(r => r.allowAuto).map(r => [r.name, r.pubkey])));
