// Read-only: dumps the real shape of a funded devnet vault.
import { Connection } from "@solana/web3.js";
import sdkPkg from "@symmetry-hq/sdk";
const { SymmetryCore } = sdkPkg;

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const sdk = new SymmetryCore({ connection, network: "devnet" });
const vaults = await sdk.fetchAllVaults();
const target = vaults.find(v => (v.formatted?.supply_outstanding ?? 0) > 1000) ?? vaults[0];
console.log("raw keys:", Object.keys(target).join(", "));
console.log("has formatted:", !!target.formatted);
if (target.formatted) console.log("formatted keys:", Object.keys(target.formatted).join(", "));
const f = target.formatted ?? target;
console.log("name:", f.name, "pubkey:", f.pubkey, "mint:", f.mint);
console.log("composition:", JSON.stringify(f.composition, null, 2)?.slice(0, 1500));
console.log("automation_settings:", JSON.stringify(f.automation_settings, null, 2));
console.log("last_automation_execution_timestamp:", f.last_automation_execution_timestamp);
console.log("bounty_balance:", f.bounty_balance);
console.log("settings keys:", f.settings ? Object.keys(f.settings).join(", ") : "(none)");
