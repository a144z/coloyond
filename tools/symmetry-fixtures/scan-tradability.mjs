// Read-only: for every mainnet vault, check Jupiter tradability and last vault activity.
import { Connection, PublicKey } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";
const conn = new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
const sdk = new SymmetryCore({ connection: conn, network: "mainnet" });
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vaults = (await sdk.fetchAllVaults()).map(v => v.formatted);
const rows = [];
for (const f of vaults) {
  const q = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${f.mint}&amount=1000000&slippageBps=50`).then(r => r.json()).catch(e => ({ errorCode: String(e) }));
  let last = null;
  try { const s = await conn.getSignaturesForAddress(new PublicKey(f.pubkey), { limit: 1 }); last = s[0]?.blockTime ? new Date(s[0].blockTime * 1000).toISOString().slice(0, 10) : null; } catch {}
  rows.push({ name: f.name, assets: f.composition.filter(a => a.weight > 0).length, supply: f.supply_outstanding, type: f.vault_type, last, jup: q.outAmount ? `route ${q.routePlan.map(r => r.swapInfo.label).join(">")}` : q.errorCode ?? q.error });
  await sleep(300);
}
rows.sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));
console.table(rows);
