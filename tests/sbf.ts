/** Executes the compiled SBF program and real SPL CPIs in LiteSVM's bank.
 * Oracle/mint fixtures are synthetic; signatures are not Devnet/RPC evidence.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {LiteSVM,Clock,FailedTransactionMetadata} from 'litesvm';
import {getTransactionDecoder,type Address,type EncodedAccount,lamports} from '@solana/kit';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,ComputeBudgetProgram,type TransactionInstruction,type AccountInfo} from '@solana/web3.js';
import {MintLayout,TOKEN_PROGRAM_ID,createMintToInstruction,createSyncNativeInstruction} from '@solana/spl-token';
import {ASSETS,DEFAULT_PROGRAM,RECEIVER_ID} from '../src/shared/config.js';
import {createVault,ensureAtas,vaultAddress,ownerMove,updateVault,rebalance,closeVault,ata} from '../src/shared/instructions.js';
import {listVaults,snapshot,type Snapshot} from '../src/shared/rpc.js';
import {planRebalance} from '../src/shared/math.js';
import {signatureBase58} from '../src/shared/transactions.js';
import {priceData} from './helpers.js';
const artifact=path.resolve('target/deploy/coloyond_vault.so');if(!fs.existsSync(artifact))throw new Error('Build the SBF artifact first');
const svm=new LiteSVM(),program=new PublicKey(DEFAULT_PROGRAM),owner=Keypair.generate(),keeper=Keypair.generate(),attacker=Keypair.generate();
svm.setClock(new Clock(1n,1000n,0n,0n,1000n));svm.addProgramFromFile(program.toBase58() as Address,artifact);
for(const k of [owner,keeper,attacker])svm.airdrop(k.publicKey.toBase58() as Address,lamports(10_000000000n));
function fixture(address:PublicKey,data:Buffer,authority:PublicKey){svm.setAccount({address:address.toBase58() as Address,programAddress:authority.toBase58() as Address,data,lamports:lamports(100000000n),executable:false,space:BigInt(data.length)} as EncodedAccount);}
const mint=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:1,mintAuthority:keeper.publicKey,supply:0n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:SystemProgram.programId},mint);fixture(ASSETS[1].mint,mint,TOKEN_PROGRAM_ID);
// LiteSVM initializes core token programs; install the canonical native mint fixture explicitly.
const native=Buffer.alloc(MintLayout.span);MintLayout.encode({mintAuthorityOption:0,mintAuthority:SystemProgram.programId,supply:0n,decimals:9,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:SystemProgram.programId},native);fixture(ASSETS[0].mint,native,TOKEN_PROGRAM_ID);
for(let i=0;i<2;i++)fixture(ASSETS[i]!.feed,priceData(i,1000n,i===0?150_00000000n:1_00000000n,i===0?1000000n:10000n),RECEIVER_ID);
function rpcAccount(address:PublicKey):AccountInfo<Buffer>|null{const a=svm.getAccount(address.toBase58() as Address);if(!a.exists||a.lamports===0n)return null;return{data:Buffer.from(a.data),owner:new PublicKey(a.programAddress),lamports:Number(a.lamports),executable:a.executable,rentEpoch:0};}
const outcomes=new Map<string,unknown>();
const connection={
  getAccountInfo:async(key:PublicKey)=>rpcAccount(key),
  getMultipleAccountsInfo:async(keys:PublicKey[])=>keys.map(rpcAccount),
  getMultipleAccountsInfoAndContext:async(keys:PublicKey[])=>({context:{slot:Number(svm.getClock().slot)},value:keys.map(rpcAccount)}),
  getProgramAccounts:async(key:PublicKey,opts:{filters?:({dataSize?:number;memcmp?:{offset:number;bytes:string}})[]})=>svm.getProgramAccounts(key.toBase58() as Address).flatMap(a=>{const pubkey=new PublicKey(a.address),account=rpcAccount(pubkey);if(!account)return[];for(const f of opts.filters??[]){if(f.dataSize!==undefined&&account.data.length!==f.dataSize)return[];if(f.memcmp&&!account.data.subarray(f.memcmp.offset,f.memcmp.offset+32).equals(new PublicKey(f.memcmp.bytes).toBuffer()))return[];}return[{pubkey,account}];}),
  getLatestBlockhash:async()=>({blockhash:svm.latestBlockhash(),lastValidBlockHeight:100}),
  sendRawTransaction:async(bytes:Buffer)=>{const tx=Transaction.from(bytes),signature=signatureBase58(tx.signature!);const result=svm.sendTransaction(getTransactionDecoder().decode(bytes));const failed=result instanceof FailedTransactionMetadata;outcomes.set(signature,failed?String(result.err()):null);records.push({signature,failed,logs:failed?result.meta().logs():result.logs()});svm.expireBlockhash();return signature;},
  confirmTransaction:async(p:{signature:string})=>({value:{err:outcomes.get(p.signature)??null}}),
} as unknown as Connection;
const records:unknown[]=[];
function record(name:string,details:unknown){records.push({name,details});console.log(JSON.stringify({name,details},(_k,v)=>typeof v==='bigint'?v.toString():v));}
async function send(name:string,ixs:TransactionInstruction[],signer=owner){const block=await connection.getLatestBlockhash();const tx=new Transaction({feePayer:signer.publicKey,...block}).add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...ixs);tx.sign(signer);const signature=await connection.sendRawTransaction(tx.serialize());const result=await connection.confirmTransaction({signature,...block});if(result.value.err)throw new Error(name+': '+result.value.err+'\n'+JSON.stringify(records.at(-1)));record(name,{signature});return signature;}
async function load(id=1n):Promise<Snapshot>{const vs=await listVaults(connection,program,owner.publicKey);const v=vs.find(x=>x.id===id);assert.ok(v);return snapshot(connection,program,v);}
async function sleep(_ms:number){const c=svm.getClock();c.unixTimestamp+=6n;c.slot+=15n;svm.setClock(c);}
async function rejection(name:string,ixs:TransactionInstruction[],signer=keeper){
  const before=await load(),inventoryBefore=await connection.getMultipleAccountsInfo(before.vault.assets.map(a=>ata(keeper.publicKey,a.mint)));
  const block=await connection.getLatestBlockhash();const tx=new Transaction({feePayer:signer.publicKey,...block}).add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...ixs);tx.sign(signer);
  const signature=await connection.sendRawTransaction(tx.serialize());const result=await connection.confirmTransaction({signature,...block});assert.ok(result.value.err,name+' must fail in the SBF bank');if(name.includes('post-CPI')){const log=(records.at(-1) as {logs:string[]}).logs;assert.ok(log.filter(x=>x===`Program ${TOKEN_PROGRAM_ID.toBase58()} success`).length>=2 && log.some(x=>x.includes('Error Code: NoImprovement')),'both CPIs must execute before rollback');}
  record(name,{signature,error:result.value.err});
  const after=await load();assert.deepEqual(after.balances,before.balances);assert.equal(after.vault.executions,before.vault.executions);
  const inventoryAfter=await connection.getMultipleAccountsInfo(before.vault.assets.map(a=>ata(keeper.publicKey,a.mint)));inventoryBefore.forEach((a,i)=>assert.deepEqual(inventoryAfter[i]?.data,a?.data));
}
try {
  const assets=ASSETS.map(a=>({mint:a.mint,decimals:a.decimals,weight:5000})),address=vaultAddress(program,owner.publicKey,1n);
  await send('create+ATAs',[createVault(program,owner.publicKey,1n,assets,5,100),...ensureAtas(owner.publicKey,address,assets),...ensureAtas(owner.publicKey,owner.publicKey,assets)]);
  await send('second isolated vault',[createVault(program,owner.publicKey,2n,assets,5,100),...ensureAtas(owner.publicKey,vaultAddress(program,owner.publicKey,2n),assets)]);
  assert.equal((await listVaults(connection,program,owner.publicKey)).length,2);
  let s=await load();assert.equal(s.oracleError,null);assert.ok(s.prices);
  await send('fund owner balances',[SystemProgram.transfer({fromPubkey:owner.publicKey,toPubkey:ata(owner.publicKey,ASSETS[0].mint),lamports:1_000000000}),createSyncNativeInstruction(ata(owner.publicKey,ASSETS[0].mint))]);
  await send('keeper inventory',[...ensureAtas(keeper.publicKey,keeper.publicKey,assets),createMintToInstruction(ASSETS[1].mint,ata(keeper.publicKey,ASSETS[1].mint),keeper.publicKey,10_000_000000)],keeper);
  await send('deposit actual SPL tokens',[ownerMove(program,s.vault,[1_000000000n,0n],false)]);
  s=await load();assert.deepEqual(s.balances,[1_000000000n,0n]);
  const p=planRebalance(s.vault,s.balances,s.prices!,s.now)!;assert.ok(p);
  await rejection('underpayment rejected',[rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,1n)]);
  await rejection('oversized fill rejected',[rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,s.balances[p.sell]!/10n+1n,p.paid*100n)]);
  const bad=rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,p.paid);bad.keys[5]!.pubkey=ASSETS[1].feed;
  await rejection('wrong feed rejected',[bad]);
  const wrongDest=rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,p.paid);wrongDest.keys[9]!.pubkey=ata(owner.publicKey,ASSETS[0].mint);
  const restore=()=>fixture(ASSETS[0].feed,priceData(0,1000n,150_00000000n,1000000n),RECEIVER_ID);
  fixture(ASSETS[0].feed,priceData(0,900n,150_00000000n,1000000n),RECEIVER_ID);
  await rejection('stale oracle rejected',[rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,p.paid)]);restore();
  fixture(ASSETS[0].feed,priceData(0,1001n,150_00000000n,1000000n),RECEIVER_ID);
  await rejection('future oracle rejected',[rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,p.paid)]);restore();
  fixture(ASSETS[0].feed,priceData(0,1000n,150_00000000n,200_000000n),RECEIVER_ID);
  await rejection('wide confidence rejected',[rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,p.paid)]);restore();
  fixture(ASSETS[0].feed,priceData(0,1000n,150_00000000n,1000000n),SystemProgram.programId);
  await rejection('wrong oracle owner rejected',[rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,p.paid)]);restore();
  await rejection('foreign destination rejected',[wrongDest]);
  const wrongVault=rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,p.paid);wrongVault.keys[4]!.pubkey=ata(vaultAddress(program,owner.publicKey,2n),ASSETS[0].mint);
  await rejection('cross-vault custody rejected',[wrongVault]);
  await send('first real inventory-backed fill',[rebalance(program,s.vault,keeper.publicKey,p.sell,p.buy,p.sold,p.paid)],keeper);
  let next=await load();assert.equal(next.vault.executions,1n);assert.equal(next.balances[p.sell],s.balances[p.sell]!-p.sold);assert.equal(next.balances[p.buy],p.paid);assert.deepEqual((await load(2n)).balances,[0n,0n]);
  const nextPlan=planRebalance({...next.vault,lastRebalance:0n},next.balances,next.prices!,next.now)!;
  await rejection('cooldown rejected',[rebalance(program,next.vault,keeper.publicKey,nextPlan.sell,nextPlan.buy,nextPlan.sold,nextPlan.paid)]);
  const malicious=ownerMove(program,next.vault,[1n,0n],true);malicious.keys[0]!.pubkey=attacker.publicKey;
  await rejection('keeper cannot withdraw',[malicious],attacker);
  // Adversarial SECOND CPI failure: payment executes then sold reserve is too low.
  // The cap blocks this earlier. Instead exercise NoImprovement AFTER both successful CPIs.
  await sleep(5200);next=await load();
  const enormousPayment=9_000_000000n;
  await rejection('late post-CPI drift failure rolls payment back',[rebalance(program,next.vault,keeper.publicKey,0,1,1n,enormousPayment)]);
  const p2=planRebalance(next.vault,next.balances,next.prices!,next.now)!;assert.ok(p2);
  await send('second real fill',[rebalance(program,next.vault,keeper.publicKey,p2.sell,p2.buy,p2.sold,p2.paid)],keeper);
  next=await load();assert.equal(next.vault.executions,2n);
  const old=next.vault;
  const changed=assets.map((a,i)=>({...a,weight:i===0?2000:8000}));
  await send('owner weight edit',[updateVault(program,old,changed,5,100,false)]);
  next=await load();assert.equal(next.vault.revision,1n);
  await rejection('stale configuration rejected',[rebalance(program,old,keeper.publicKey,0,1,1n,enormousPayment)]);
  await send('pause',[updateVault(program,next.vault,next.vault.assets,5,100,true)]);
  next=await load();assert.ok(next.vault.paused);
  await rejection('paused fills rejected',[rebalance(program,next.vault,keeper.publicKey,0,1,1n,enormousPayment)]);
  const single=[{...assets[0]!,weight:10000}];
  await rejection('cannot strand removed token',[updateVault(program,next.vault,single,5,100,true)],owner);
  await send('remove token atomically, withdrawal remains available under pause',[ownerMove(program,next.vault,[0n,next.balances[1]!],true),updateVault(program,next.vault,single,5,100,true)]);
  next=await load();assert.equal(next.vault.assets.length,1);
  assert.equal(await connection.getAccountInfo(ata(address,ASSETS[1].mint)),null);
  await send('add token again and resume',[updateVault(program,next.vault,assets,5,100,false),...ensureAtas(owner.publicKey,address,assets)]);
  next=await load();assert.equal(next.vault.assets.length,2);assert.equal(next.balances[1],0n);
  if(next.now < next.vault.lastRebalance+5n) {await sleep(5200);next=await load();}
  const p3=planRebalance(next.vault,next.balances,next.prices!,next.now);assert.ok(p3);
  await send('fill after remove/re-add uses current basket and revision',[rebalance(program,next.vault,keeper.publicKey,p3.sell,p3.buy,p3.sold,p3.paid)],keeper);
  next=await load();assert.equal(next.vault.executions,3n);
  await send('partial withdrawal',[ownerMove(program,next.vault,[next.balances[0]!/4n,0n],true)]);
  next=await load();
  await send('full withdrawal and closure',[ownerMove(program,next.vault,next.balances,true),closeVault(program,next.vault)]);
  assert.equal(await connection.getAccountInfo(address),null);for(const a of assets)assert.equal(await connection.getAccountInfo(ata(address,a.mint)),null);
  assert.equal((await listVaults(connection,program,owner.publicKey)).length,1);

  record('PASS',{runtime:'LiteSVM SBF bank',program:program.toBase58(),syntheticOracleFixtures:true,independentVaults:true});
}finally{fs.mkdirSync('scratch',{recursive:true});fs.writeFileSync('scratch/sbf-evidence.json',JSON.stringify(records,(_k,v)=>typeof v==='bigint'?v.toString():v,2));}
