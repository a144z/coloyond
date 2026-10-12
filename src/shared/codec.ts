import { sha256 } from '@noble/hashes/sha256';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { assetFor } from './config.js';
export function discriminator(namespace: string, name: string): Buffer { return Buffer.from(sha256(new TextEncoder().encode(`${namespace}:${name}`))).subarray(0,8); }
export const u8 = (n: number) => Buffer.from([n]);
export function u16(n: number) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
export function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
export function u64(n: bigint) { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; }
export function vec<T>(a: readonly T[], encode: (n: T) => Uint8Array) { return Buffer.concat([u32(a.length),...a.map(n => Buffer.from(encode(n)))]); }
export interface Allocation { mint: PublicKey; decimals: number; weight: number }
export interface Vault {
  address: PublicKey; owner: PublicKey; id: bigint; bump: number; revision: bigint; cooldown: number; threshold: number; paused: boolean;
  lastRebalance: bigint; executions: bigint; lastSell: number; lastBuy: number; lastSold: bigint; lastPaid: bigint; assets: Allocation[];
}
export function validateAllocation(a: readonly Allocation[]) {
  if (!a.length || a.length > 2 || new Set(a.map(x => x.mint.toBase58())).size !== a.length || a.some(x => !Number.isInteger(x.weight) || x.weight < 1 || assetFor(x.mint).decimals !== x.decimals) || a.reduce((s,x) => s+x.weight,0) !== 10_000) throw new Error('Select supported tokens with positive weights totaling 100%');
}
export function decodeVault(address: PublicKey, bytes: Uint8Array): Vault {
  const b = Buffer.from(bytes); let i = 8;
  if (b.length !== 172 || !b.subarray(0,8).equals(discriminator('account','Vault'))) throw new Error('Incompatible vault ABI');
  const read64 = () => { const n = b.readBigUInt64LE(i); i += 8; return n; };
  const owner = new PublicKey(b.subarray(i,i+32)); i += 32;
  const id = read64(); const bump = b[i++]!; const revision = read64();
  const cooldown = b.readUInt32LE(i); i += 4; const threshold = b.readUInt16LE(i); i += 2;
  const pausedByte = b[i++]!; if (pausedByte > 1) throw new Error('Invalid pause flag');
  const lastRebalance = b.readBigInt64LE(i); i += 8; const executions = read64();
  const lastSell = b[i++]!; const lastBuy = b[i++]!; const lastSold = read64(); const lastPaid = read64();
  const count = b.readUInt32LE(i); i += 4; if (count < 1 || count > 2) throw new Error('Invalid asset count');
  const assets: Allocation[] = [];
  for (let n=0;n<count;n++) { const mint = new PublicKey(b.subarray(i,i+32)); i += 32; const decimals = b[i++]!; const weight = b.readUInt16LE(i); i += 2; assets.push({mint,decimals,weight}); }
  validateAllocation(assets);
  if (cooldown < 5 || cooldown > 86400 || threshold < 1 || threshold > 5000 || lastRebalance < 0n) throw new Error('Invalid vault policy');
  return { address,owner,id,bump,revision,cooldown,threshold,paused:pausedByte === 1,lastRebalance,executions,lastSell,lastBuy,lastSold,lastPaid,assets };
}
export function parseUnits(text: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Enter a nonnegative token amount');
  const [whole,fraction=''] = text.split('.'); if (fraction.length > decimals) throw new Error('Too many decimal places');
  const n = BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0') || '0');
  if (n > (1n<<64n)-1n) throw new Error('Token amount exceeds u64'); return n;
}
export function formatUnits(n: bigint, decimals: number) { const d = 10n**BigInt(decimals); const fraction=(n%d).toString().padStart(decimals,'0').replace(/0+$/,''); return `${n/d}${fraction ? '.'+fraction : ''}`; }
