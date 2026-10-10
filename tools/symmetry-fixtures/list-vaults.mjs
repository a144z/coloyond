// Read-only: lists mainnet Symmetry V3 vaults with 1-2 active assets.
import { Connection } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";
const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const sdk = new SymmetryCore({ connection: new Connection(rpc, "confirmed"), network: "mainnet" });
const vaults = await sdk.fetchAllVaults();
console.log(`total vaults: ${vaults.length}`);
const rows = vaults.map(v => v.formatted ?? v).map(f => ({
  pubkey: f.pubkey, name: f.name, symbol: f.symbol, mint: f.mint,
  supply: f.supply_outstanding, type: f.vault_type,
  assets: f.composition.filter(a => a.active).map(a => `${a.mint.slice(0,6)}:${a.weight}`),
  lastAuto: f.last_automation_execution_timestamp,
}));
const small = rows.filter(r => r.assets.length >= 1 && r.assets.length <= 2);
console.log(`1-2 asset vaults: ${small.length}`);
small.sort((a,b) => b.supply - a.supply).slice(0, 25).forEach(r => console.log(JSON.stringify(r)));
