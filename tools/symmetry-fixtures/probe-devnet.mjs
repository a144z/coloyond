// Read-only: confirms whether the Symmetry V3 program responds on devnet.
import { Connection, PublicKey } from "@solana/web3.js";
import sdkPkg from "@symmetry-hq/sdk";
const { SymmetryCore } = sdkPkg;
const DEVNET_WSOL = "So11111111111111111111111111111111111111112";
const DEVNET_USDC = "USDCoctVLVnvTXBEuP9s8hntucdJokbo17RwHuNXemT";

const network = process.env.NETWORK ?? "devnet";
const rpc = process.env.RPC_URL ?? (network === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
const connection = new Connection(rpc, "confirmed");
const sdk = new SymmetryCore({ connection, network });

console.log(`network=${network} rpc=${rpc}`);
console.log(`DEVNET WSOL=${DEVNET_WSOL} USDC=${DEVNET_USDC}`);
try {
  const programId = new PublicKey("BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate");
  const info = await connection.getAccountInfo(programId);
  console.log(`program account: ${info ? "EXISTS, executable=" + info.executable + " owner=" + info.owner.toBase58() : "MISSING"}`);
} catch (e) {
  console.log(`program account error: ${e.message}`);
}
try {
  const cfg = await sdk.fetchGlobalConfig();
  console.log(`global config: ok, symmetryFeeCollector=${cfg.symmetryFeeCollector?.toBase58?.() ?? cfg.symmetryFeeCollector}`);
} catch (e) {
  console.log(`fetchGlobalConfig FAILED: ${e.message}`);
}
try {
  const vaults = await sdk.fetchAllVaults();
  console.log(`vaults: ${vaults.length}`);
  vaults.slice(0, 10).forEach(v => {
    const f = v.formatted ?? v;
    console.log(`  ${f.pubkey?.slice(0, 8)} ${String(f.name).slice(0, 24)} supply=${f.supply_outstanding} assets=${f.composition?.filter(a => a.active).length} allowAuto=${f.automation_settings?.allow_automation}`);
  });
} catch (e) {
  console.log(`fetchAllVaults FAILED: ${e.message}`);
}
