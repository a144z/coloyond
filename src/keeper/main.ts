import fs from 'node:fs';
import {refreshOracles} from './refreshOracles.js';
import path from 'node:path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type { Vault } from '../shared/codec.js';
import { DEFAULT_PROGRAM } from '../shared/config.js';
import { listVaults, snapshot, tokenAmount, assertNetwork, assertProgram } from '../shared/rpc.js';
import { ata, ensureAtas, rebalance } from '../shared/instructions.js';
import { planRebalance } from '../shared/math.js';
import { reconcile, submit, type Pending, type Journal } from '../shared/transactions.js';

const connection=new Connection(process.env.RPC_URL??'https://api.devnet.solana.com','confirmed');
const program=new PublicKey(process.env.PROGRAM_ID??DEFAULT_PROGRAM);
const send=process.argv.includes('--send'),once=process.argv.includes('--once');
const statePath=path.resolve(process.env.KEEPER_STATE??'.keeper-state.json');
const keyPath=process.env.KEEPER_KEYPAIR;
if(send&&!keyPath)throw new Error('--send requires KEEPER_KEYPAIR; keeper inventory and fees are operator-funded');
const signer=keyPath?Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath,'utf8')))):null;
let state:Record<string,Pending>=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{};
function persist(){const temp=statePath+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temp,statePath);}
function journal(key:string):Journal{return{read:()=>state[key]??null,write:p=>{state[key]=p;persist();},clear:()=>{delete state[key];persist();}};}
function log(data:unknown){console.log(JSON.stringify(data,(_k,v)=>typeof v==='bigint'?v.toString():v));}
// Exclusive process lock prevents two operators sharing a key/journal from racing.
const lock=statePath+'.lock';let lockFd:number|undefined;
if(send){lockFd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(lockFd,String(process.pid));}
let lastOracleAttempt=0;
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
try {
  const genesis=await assertNetwork(connection,process.env.ALLOW_LOCALNET==='1');await assertProgram(connection,program);
  log({event:'started',genesis,program:program.toBase58(),mode:send?'inventory-backed fills':'read-only',keeper:signer?.publicKey.toBase58()??null});
  do {
    // Reconcile every submitted transaction, including closed/edited vaults.
    for(const [key,p] of Object.entries(state)) {
      if(p.genesis!==genesis||p.program!==program.toBase58()||p.owner!==signer?.publicKey.toBase58())throw new Error('Journal identity mismatch; use a separate state file for this operator/network/program');
      try{const outcome=await reconcile(connection,p);log({event:'reconcile',vault:key,signature:p.signature,outcome});if(outcome!=='unknown')journal(key).clear();}catch(e){log({event:'reconcile_error',vault:key,error:String(e)});}
    }
    let vaults:Vault[];
    try {vaults=await listVaults(connection,program,process.env.VAULT_OWNER?new PublicKey(process.env.VAULT_OWNER):undefined);}
    catch(e){log({event:'discovery_error',error:String(e)});if(once)throw e;vaults=[];}
    for(const v of vaults){
      const key=v.address.toBase58();if(state[key])continue;
      try{
        let s=await snapshot(connection,program,v);
        if(!s.prices && send && signer && !process.argv.includes('--no-oracle-refresh') && Date.now()-lastOracleAttempt>=15000) {
          lastOracleAttempt=Date.now();
          if(await refreshOracles(connection,program,signer,journal('$oracle'),log))s=await snapshot(connection,program,s.vault);
        }
        if(!s.prices){log({event:'blocked',vault:key,reason:s.oracleError});continue;}
        let inventory:bigint[]|undefined;
        if(signer){const accounts=await connection.getMultipleAccountsInfo(s.vault.assets.map(a=>ata(signer.publicKey,a.mint)),'confirmed');inventory=s.vault.assets.map((a,i)=>accounts[i]?tokenAmount(accounts[i]!,signer.publicKey,a.mint):0n);}
        const plan=planRebalance(s.vault,s.balances,s.prices,s.now,inventory);
        log({event:plan?'planned':'no_fill',vault:key,revision:s.vault.revision,executions:s.vault.executions,plan,reason:!plan?'paused, cooldown, tolerance, dust, or insufficient inventory':null});
        if(!send||!plan||!signer)continue;
        const p=await submit(connection,program,signer.publicKey,'rebalance',[...ensureAtas(signer.publicKey,signer.publicKey,s.vault.assets),rebalance(program,s.vault,signer.publicKey,plan.sell,plan.buy,plan.sold,plan.paid)],async tx=>{tx.sign(signer);return tx;},journal(key));
        log({event:'submitted',vault:key,signature:p.signature});
      }catch(e){log({event:'vault_error',vault:key,error:String(e)});}
    }
    if(!once&&!stopped)await new Promise<void>(resolve=>{const cleanup=()=>{clearTimeout(timer);process.removeListener('SIGINT',done);process.removeListener('SIGTERM',done);resolve();};const done=()=>cleanup();const timer=setTimeout(cleanup,5000);process.once('SIGINT',done);process.once('SIGTERM',done);});
  }while(!once&&!stopped);
} finally {if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock);}}
