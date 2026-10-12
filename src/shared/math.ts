import type { Vault } from './codec.js';
import type { Price } from './oracle.js';
export function ceilDiv(a: bigint,b: bigint) { return (a+b-1n)/b; }
export function value(amount: bigint, price: bigint, decimals: number) { return amount*price/10n**BigInt(decimals); }
export function drift(values: readonly bigint[],weights: readonly number[]): bigint {
  const total = values.reduce((s,x) => s+x,0n); if (total === 0n) throw new Error('Empty portfolio');
  return values.reduce((s,x,i) => { const d=x*10_000n-total*BigInt(weights[i]!); return s+(d<0n ? -d : d); },0n)/total/2n;
}
export interface Plan { sell: number; buy: number; sold: bigint; paid: bigint; before: bigint; after: bigint }
export function planRebalance(vault: Vault, balances: readonly bigint[], prices: readonly Price[], now: bigint, inventory?: readonly bigint[]): Plan | null {
  if (vault.paused || now < vault.lastRebalance+BigInt(vault.cooldown) || vault.assets.length < 2) return null;
  if (balances.length !== vault.assets.length || prices.length !== balances.length) throw new Error('Incomplete snapshot');
  const weights=vault.assets.map(a=>a.weight), values=balances.map((n,i)=>value(n,prices[i]!.midpoint,vault.assets[i]!.decimals));
  const total=values.reduce((s,x)=>s+x,0n); if (!total) return null;
  const before=drift(values,weights); if (before < BigInt(vault.threshold)) return null;
  const deltas=values.map((v,i)=>v-total*BigInt(weights[i]!)/10_000n);
  const sell=deltas.indexOf(deltas.reduce((a,b)=>a>b?a:b)), buy=deltas.indexOf(deltas.reduce((a,b)=>a<b?a:b));
  if (sell === buy || deltas[sell]! <= 0n || deltas[buy]! >= 0n) return null;
  const sellScale=10n**BigInt(vault.assets[sell]!.decimals), buyScale=10n**BigInt(vault.assets[buy]!.decimals);
  const excess=deltas[sell]!*sellScale/prices[sell]!.midpoint;
  let sold=excess < balances[sell]!/10n ? excess : balances[sell]!/10n;
  // Avoid overshoot and inventory exhaustion; integer binary shrinking is deterministic.
  for (let n=0;n<64 && sold>0n;n++,sold/=2n) {
    const sellValue=ceilDiv(sold*prices[sell]!.upper,sellScale);
    // 10 bps payment cushion covers small movement between planning and execution.
    const paid=ceilDiv(ceilDiv(sellValue*buyScale,prices[buy]!.lower)*10_010n,10_000n);
    if (inventory && paid > inventory[buy]!) continue;
    const next=[...balances]; next[sell]-=sold; next[buy]+=paid;
    if (next[buy]! > (1n<<64n)-1n) continue;
    const after=drift(next.map((n,i)=>value(n,prices[i]!.midpoint,vault.assets[i]!.decimals)),weights);
    if (after < before) return {sell,buy,sold,paid,before,after};
  }
  return null;
}
