import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { discriminator, u8, u16, u32, u64, vec, validateAllocation, type Allocation, type Vault } from './codec.js';
import { assetFor } from './config.js';
export const meta = (pubkey: PublicKey,isWritable=false,isSigner=false): AccountMeta => ({pubkey,isWritable,isSigner});
export const ata = (owner: PublicKey,mint: PublicKey) => getAssociatedTokenAddressSync(mint,owner,true);
export function vaultAddress(program: PublicKey,owner: PublicKey,id: bigint) { return PublicKey.findProgramAddressSync([Buffer.from('vault'),owner.toBuffer(),u64(id)],program)[0]; }
function ix(program: PublicKey,name: string,keys: AccountMeta[],args: Uint8Array[]=[]) { return new TransactionInstruction({programId:program,keys,data:Buffer.concat([discriminator('global',name),...args.map(a=>Buffer.from(a))])}); }
function policy(cooldown: number,threshold: number) { if (!Number.isInteger(cooldown) || cooldown<5 || cooldown>86400 || !Number.isInteger(threshold) || threshold<1 || threshold>5000) throw new Error('Cooldown must be 5–86400 seconds; tolerance 0.01–50%'); }
export function ensureAtas(payer: PublicKey,owner: PublicKey,assets: readonly Allocation[]) { return assets.map(a=>createAssociatedTokenAccountIdempotentInstruction(payer,ata(owner,a.mint),owner,a.mint)); }
export function createVault(program: PublicKey,owner: PublicKey,id: bigint,assets: Allocation[],cooldown: number,threshold: number) {
  validateAllocation(assets); policy(cooldown,threshold);
  return ix(program,'create_vault',[meta(owner,true,true),meta(vaultAddress(program,owner,id),true),meta(SystemProgram.programId)],[u64(id),vec(assets,a=>a.mint.toBytes()),vec(assets,a=>u16(a.weight)),u32(cooldown),u16(threshold)]);
}
function manageKeys(v: Vault) { return [meta(v.owner,true,true),meta(v.address,true),meta(TOKEN_PROGRAM_ID)]; }
export function custodyKeys(v: Vault) { return v.assets.map(a=>meta(ata(v.address,a.mint),true)); }
export function ownerMove(program: PublicKey,v: Vault,amounts: bigint[],withdraw: boolean) {
  if (amounts.length !== v.assets.length || !amounts.some(n=>n>0n) || amounts.some(n=>n<0n || n>(1n<<64n)-1n)) throw new Error('Invalid token amounts');
  return ix(program,withdraw?'withdraw':'deposit',[...manageKeys(v),...v.assets.flatMap(a=>[meta(a.mint),meta(ata(v.address,a.mint),true),meta(ata(v.owner,a.mint),true)])],[u64(v.revision),vec(amounts,u64)]);
}
export function updateVault(program: PublicKey,v: Vault,assets: Allocation[],cooldown: number,threshold: number,paused: boolean) {
  validateAllocation(assets); policy(cooldown,threshold);
  return ix(program,'update_allocation',[...manageKeys(v),...custodyKeys(v)],[u64(v.revision),vec(assets,a=>a.mint.toBytes()),vec(assets,a=>u16(a.weight)),u32(cooldown),u16(threshold),u8(paused?1:0)]);
}
export function closeVault(program: PublicKey,v: Vault) { return ix(program,'close_vault',[...manageKeys(v),...custodyKeys(v)]); }
export function rebalance(program: PublicKey,v: Vault,keeper: PublicKey,sell: number,buy: number,sold: bigint,paid: bigint) {
  if (sell===buy || !v.assets[sell] || !v.assets[buy] || sold<=0n || paid<=0n) throw new Error('Invalid fill');
  return ix(program,'rebalance',[meta(keeper,false,true),meta(v.address,true),meta(TOKEN_PROGRAM_ID),...v.assets.flatMap(a=>[meta(a.mint),meta(ata(v.address,a.mint),true),meta(assetFor(a.mint).feed)]),meta(ata(keeper,v.assets[sell]!.mint),true),meta(ata(keeper,v.assets[buy]!.mint),true)],[u64(v.revision),u8(sell),u8(buy),u64(sold),u64(paid)]);
}
