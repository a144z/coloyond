// Read-only: NAV, recent activity and Jupiter availability for candidate vaults.
import { Connection, PublicKey } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";
const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpc, "confirmed");
const sdk = new SymmetryCore({ connection: conn, network: "mainnet" });
const ids = process.argv.slice(2);
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
for (const id of ids) {
  const out = { id };
  try {
    let v = await sdk.fetchVault(id);
    try { v = await sdk.loadVaultPrice(v); out.price = v.formatted?.price ?? v.price ?? "(see keys)"; out.priceKeys = Object.keys(v).filter(k => /price|nav|tvl/i.test(k)); }
    catch (e) { out.priceErr = String(e.message ?? e).slice(0, 160); }
    const f = v.formatted;
    out.name = f.name; out.mint = f.mint; out.supply = f.supply_outstanding; out.type = f.vault_type;
    out.composition = f.composition.map(a => ({ mint: a.mint, weight: a.weight, amount: a.amount, active: a.active }));
    out.fees = { dep: f.fee_settings.creator_deposit_fee_bps, wd: f.fee_settings.creator_withdraw_fee_bps };
    const mintInfo = await conn.getParsedAccountInfo(new PublicKey(f.mint));
    out.decimals = mintInfo.value?.data?.parsed?.info?.decimals;
    const sigs = await conn.getSignaturesForAddress(new PublicKey(id), { limit: 10 });
    out.recentSigs = sigs.map(s => ({ sig: s.signature.slice(0, 12), t: s.blockTime && new Date(s.blockTime * 1000).toISOString(), err: !!s.err }));
    const pr = await fetch(`https://lite-api.jup.ag/price/v3?ids=${f.mint}`).then(r => r.json()).catch(e => ({ e: String(e) }));
    out.jupPrice = pr[f.mint] ?? pr;
    const q = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC}&outputMint=${f.mint}&amount=10000000&slippageBps=50`).then(r => r.json()).catch(e => ({ e: String(e) }));
    out.jupBuy10Usdc = q.outAmount ? { out: q.outAmount, impact: q.priceImpactPct, route: q.routePlan?.map(r => r.swapInfo.label) } : q;
  } catch (e) { out.err = String(e.message ?? e).slice(0, 200); }
  console.log(JSON.stringify(out, null, 1));
}
