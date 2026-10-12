import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, PublicKey } from '@solana/web3.js';
import { AccountLayout,TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ASSETS,DEVNET_GENESIS } from '../src/shared/config.js';
import { snapshot,assertNetwork } from '../src/shared/rpc.js';
import { info,vault,encodeVault,priceData,program } from './helpers.js';
function token(authority:PublicKey,index:number,amount:bigint){const b=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:ASSETS[index]!.mint,owner:authority,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},b);return info(b,TOKEN_PROGRAM_ID);}
function clock(now:bigint){const b=Buffer.alloc(40);b.writeBigInt64LE(now,32);return info(b,new PublicKey('Sysvar1111111111111111111111111111111111111'));}
test('snapshot re-queries current membership when owner edits the basket',async()=>{
  const old=vault();const fresh=vault({revision:1n,assets:[{mint:ASSETS[1].mint,decimals:6,weight:10000}]});let calls=0;
  const c={getMultipleAccountsInfoAndContext:async(keys:PublicKey[])=>{calls++;if(calls===1)return{context:{slot:1},value:[info(encodeVault(fresh),program),null,null,null,null,clock(1000n)]};assert.equal(keys.length,4);assert.ok(keys[1]!.equals((await import('../src/shared/instructions.js')).ata(fresh.address,ASSETS[1].mint)));return{context:{slot:2},value:[info(encodeVault(fresh),program),token(fresh.address,1,123n),info(priceData(1,1000n,100000000n,10000n)),clock(1000n)]};}} as unknown as Connection;
  const result=await snapshot(c,program,old);assert.equal(calls,2);assert.equal(result.vault.revision,1n);assert.deepEqual(result.balances,[123n]);assert.equal(result.oracleError,null);
});
test('stale oracle blocks valuation, not custody readback or owner exits',async()=>{const v=vault();const c={getMultipleAccountsInfoAndContext:async()=>({context:{slot:1},value:[info(encodeVault(v),program),token(v.address,0,1n),token(v.address,1,2n),info(priceData(0,1n)),info(priceData(1,1n,100000000n,10000n)),clock(1000n)]})} as unknown as Connection;const s=await snapshot(c,program,v);assert.deepEqual(s.balances,[1n,2n]);assert.equal(s.prices,null);assert.match(s.oracleError!,/stale/);});
test('network checks reject Mainnet and arbitrary remote fallback',async()=>{const c=(url:string,genesis:string)=>({rpcEndpoint:url,getGenesisHash:async()=>genesis} as unknown as Connection);assert.equal(await assertNetwork(c('https://api.devnet.solana.com',DEVNET_GENESIS)),DEVNET_GENESIS);await assert.rejects(()=>assertNetwork(c('https://api.mainnet-beta.solana.com','mainnet')));await assert.rejects(()=>assertNetwork(c('https://untrusted.test','unknown'),true));await assertNetwork(c('http://127.0.0.1:8899','local'),true);});
