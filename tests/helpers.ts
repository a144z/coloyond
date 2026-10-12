import { Buffer } from 'buffer';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { ASSETS, RECEIVER_ID, DEFAULT_PROGRAM } from '../src/shared/config.js';
import { discriminator, u8,u16,u32,u64,vec, type Vault } from '../src/shared/codec.js';
import { vaultAddress } from '../src/shared/instructions.js';
export const program=new PublicKey(DEFAULT_PROGRAM),owner=new PublicKey('11111111111111111111111111111111');
export function vault(overrides:Partial<Vault>={}):Vault{return{address:vaultAddress(program,owner,1n),owner,id:1n,bump:PublicKey.findProgramAddressSync([Buffer.from('vault'),owner.toBuffer(),u64(1n)],program)[1],revision:0n,cooldown:5,threshold:100,paused:false,lastRebalance:0n,executions:0n,lastSell:0,lastBuy:0,lastSold:0n,lastPaid:0n,assets:ASSETS.map(a=>({mint:a.mint,decimals:a.decimals,weight:5000})),...overrides};}
export function encodeVault(v:Vault){const b=Buffer.concat([discriminator('account','Vault'),v.owner.toBuffer(),u64(v.id),u8(v.bump),u64(v.revision),u32(v.cooldown),u16(v.threshold),u8(v.paused?1:0),u64(v.lastRebalance),u64(v.executions),u8(v.lastSell),u8(v.lastBuy),u64(v.lastSold),u64(v.lastPaid),vec(v.assets,a=>Buffer.concat([a.mint.toBuffer(),u8(a.decimals),u16(a.weight)]))]);return Buffer.concat([b,Buffer.alloc(172-b.length)]);}
export function priceData(index:number,now:bigint,price=150_00000000n,conf=1000000n){const b=Buffer.alloc(134);discriminator('account','PriceUpdateV2').copy(b);b[40]=1;Buffer.from(ASSETS[index]!.feedId,'hex').copy(b,41);b.writeBigInt64LE(price,73);b.writeBigUInt64LE(conf,81);b.writeInt32LE(-8,89);b.writeBigInt64LE(now,93);b.writeBigInt64LE(now-1n,101);b.writeBigInt64LE(price,109);b.writeBigUInt64LE(conf,117);b.writeBigUInt64LE(1n,125);return b;}
export function info(data:Buffer,owner=RECEIVER_ID):AccountInfo<Buffer>{return{data,owner,lamports:10000000,executable:false,rentEpoch:0};}
