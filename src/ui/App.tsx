import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import { createSyncNativeInstruction } from '@solana/spl-token';
import { ASSETS, PROGRAM_ID, assetFor } from '../shared/config.js';
import { formatUnits, parseUnits, type Allocation } from '../shared/codec.js';
import { assertNetwork, assertProgram, listVaults, snapshot, type Snapshot } from '../shared/rpc.js';
import { ata, closeVault, createVault, ensureAtas, ownerMove, updateVault, vaultAddress } from '../shared/instructions.js';
import { drift, value } from '../shared/math.js';
import { reconcile, submit, type Journal, type Pending } from '../shared/transactions.js';

function err(e:unknown){return e instanceof Error?e.message:String(e);}
function percentage(input:string){const n=parseUnits(input,2);if(n>10000n)throw new Error('Weight exceeds 100%');return Number(n);}
function readPending(key:string):Pending|null {const raw=localStorage.getItem(key);if(!raw)return null;const p=JSON.parse(raw) as Pending;if(typeof p.signature!=='string'||!Number.isInteger(p.lastValidBlockHeight))throw new Error('Transaction journal is damaged; inspect it before retrying');return p;}
type Run=(label:string,instructions:TransactionInstruction[])=>Promise<void>;
function AllocationEditor({selected,setSelected,weights,setWeights}:{selected:boolean[];setSelected:(a:boolean[])=>void;weights:string[];setWeights:(a:string[])=>void}){
  return <div className="allocation">{ASSETS.map((a,i)=><div className="asset-input" key={a.symbol}><label><input type="checkbox" checked={selected[i]} onChange={e=>setSelected(selected.map((x,n)=>n===i?e.target.checked:x))}/><strong>{a.symbol}</strong><small>{a.label}</small></label><label className="weight"><input aria-label={`${a.symbol} target percent`} type="text" inputMode="decimal" disabled={!selected[i]} value={weights[i]} onChange={e=>setWeights(weights.map((x,n)=>n===i?e.target.value:x))}/><span>%</span></label></div>)}</div>;
}
function allocations(selected:boolean[],weights:string[]):Allocation[]{return ASSETS.flatMap((a,i)=>selected[i]?[{mint:a.mint,decimals:a.decimals,weight:percentage(weights[i]!)}]:[]);}
function VaultCard({s,run,busy}:{s:Snapshot;run:Run;busy:boolean}){
  const v=s.vault;
  const [selected,setSelected]=useState(ASSETS.map(a=>v.assets.some(x=>x.mint.equals(a.mint))));
  const [weights,setWeights]=useState(ASSETS.map(a=>String((v.assets.find(x=>x.mint.equals(a.mint))?.weight??5000)/100)));
  const [cooldown,setCooldown]=useState(String(v.cooldown)),[threshold,setThreshold]=useState(String(v.threshold/100));
  const [amounts,setAmounts]=useState(v.assets.map(()=>''));
  const [localError,setLocalError]=useState('');
  const guarded=async(fn:()=>Promise<void>)=>{try{setLocalError('');await fn();}catch(e){setLocalError(err(e));}};
  let driftLabel='Unavailable';
  if(s.prices){try{driftLabel=`${Number(drift(s.balances.map((n,i)=>value(n,s.prices![i]!.midpoint,v.assets[i]!.decimals)),v.assets.map(a=>a.weight)))/100}%`;}catch{driftLabel='Empty vault';}}
  const update=async()=>{
    const next=allocations(selected,weights),removed=v.assets.map((a,i)=>next.some(x=>x.mint.equals(a.mint))?0n:s.balances[i]!);
    const instructions=[...ensureAtas(v.owner,v.owner,v.assets)];
    if(removed.some(n=>n>0n))instructions.push(ownerMove(PROGRAM_ID,v,removed,true));
    instructions.push(updateVault(PROGRAM_ID,v,next,Number(cooldown),percentage(threshold),v.paused),...ensureAtas(v.owner,v.address,next));
    await run('Update allocation and return removed tokens',instructions);
  };
  const move=async(withdraw:boolean,all=false)=>{
    const units=all?s.balances:v.assets.map((a,i)=>parseUnits(amounts[i]||'0',a.decimals));
    const instructions=[...ensureAtas(v.owner,v.owner,v.assets),...ensureAtas(v.owner,v.address,v.assets)];
    if(!withdraw){for(const [i,a]of v.assets.entries()){if(a.mint.equals(ASSETS[0].mint)&&units[i]!>0n){instructions.push(SystemProgram.transfer({fromPubkey:v.owner,toPubkey:ata(v.owner,a.mint),lamports:units[i]!}),createSyncNativeInstruction(ata(v.owner,a.mint)));}}}
    instructions.push(ownerMove(PROGRAM_ID,v,units,withdraw));await run(withdraw?'Withdraw tokens':'Fund vault',instructions);
  };
  const close=async()=>{
    const instructions=[...ensureAtas(v.owner,v.owner,v.assets)];
    if(s.balances.some(n=>n>0n))instructions.push(ownerMove(PROGRAM_ID,v,s.balances,true));
    instructions.push(closeVault(PROGRAM_ID,v));await run('Withdraw all and close vault',instructions);
  };
  const total=s.prices?s.balances.reduce((sum,n,i)=>sum+value(n,s.prices![i]!.midpoint,v.assets[i]!.decimals),0n):0n;
  return <article className="vault"><div className="vault-heading"><div><small>Personal vault · revision {v.revision.toString()}</small><h2>{v.address.toBase58().slice(0,8)}…{v.address.toBase58().slice(-6)}</h2></div><span className={v.paused?'badge muted':'badge'}>{v.paused?'Paused':'Open to cranker fills'}</span></div>
    <div className="facts"><div><small>Allocation drift</small><strong>{driftLabel}</strong></div><div><small>Confirmed fills</small><strong>{v.executions.toString()}</strong></div><div><small>Last fill · chain time</small><strong>{v.lastRebalance===0n?'None':new Date(Number(v.lastRebalance)*1000).toLocaleString()}</strong></div></div>
    {s.oracleError&&<p className="notice">Rebalancing blocked: {s.oracleError}. Owner withdrawals remain available.</p>}
    <table><thead><tr><th>Asset</th><th>Custody balance</th><th>Target</th><th>Actual value weight</th></tr></thead><tbody>{v.assets.map((a,i)=><tr key={a.mint.toBase58()}><td>{assetFor(a.mint).symbol}</td><td>{formatUnits(s.balances[i]!,a.decimals)}</td><td>{a.weight/100}%</td><td>{s.prices&&total>0n?`${Number(value(s.balances[i]!,s.prices[i]!.midpoint,a.decimals)*10000n/total)/100}%`:'—'}</td></tr>)}</tbody></table>
    {v.executions>0n&&<p className="receipt">Last fill sold {v.lastSold.toString()} base units and received {v.lastPaid.toString()} base units. Values are stored on-chain; see transaction activity for historical token identities.</p>}
    <details><summary>Edit tokens and target weights</summary><AllocationEditor {...{selected,setSelected,weights,setWeights}}/><div className="policy"><label>Cooldown (seconds)<input value={cooldown} onChange={e=>setCooldown(e.target.value)} inputMode="numeric"/></label><label>Drift tolerance (%)<input value={threshold} onChange={e=>setThreshold(e.target.value)} inputMode="decimal"/></label></div><p className="hint">Removing a token returns its remaining holdings to your wallet atomically. Added tokens start empty; fund them below.</p><button disabled={busy} onClick={()=>void guarded(update)}>Save with wallet</button></details>
    <details><summary>Fund or withdraw</summary><div className="policy">{v.assets.map((a,i)=><label key={a.mint.toBase58()}>{assetFor(a.mint).symbol}<input aria-label={`${assetFor(a.mint).symbol} amount`} value={amounts[i]??''} placeholder="0.00" inputMode="decimal" onChange={e=>setAmounts(amounts.map((x,n)=>n===i?e.target.value:x))}/></label>)}</div><p className="hint">A WSOL deposit wraps the entered amount of wallet SOL. Test USDC must already be in your wallet. Withdrawals return SPL tokens.</p><div className="actions"><button disabled={busy} onClick={()=>void guarded(()=>move(false))}>Deposit</button><button className="secondary" disabled={busy} onClick={()=>void guarded(()=>move(true))}>Withdraw amounts</button><button className="secondary" disabled={busy||!s.balances.some(n=>n>0n)} onClick={()=>void guarded(()=>move(true,true))}>Withdraw all</button></div></details>
    <div className="actions footer-actions"><button className="secondary" disabled={busy} onClick={()=>void guarded(()=>run(v.paused?'Resume fills':'Pause fills',[updateVault(PROGRAM_ID,v,v.assets,v.cooldown,v.threshold,!v.paused)]))}>{v.paused?'Resume':'Pause'} automation</button><button className="danger" disabled={busy} onClick={()=>void guarded(close)}>Withdraw all & close</button><a href={`https://explorer.solana.com/address/${v.address}?cluster=devnet`} target="_blank" rel="noreferrer">Chain activity ↗</a></div>{localError&&<p className="error" role="alert">{localError}</p>}
  </article>;
}
export function App(){
  const {connection}=useConnection(),{publicKey,signTransaction}=useWallet();
  const [vaults,setVaults]=useState<Snapshot[]>([]),[ready,setReady]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('Checking network…');
  const [busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null);
  const [selected,setSelected]=useState([true,true]),[weights,setWeights]=useState(['50','50']);
  const request=useRef(0),operation=useRef(false);
  const journalKey=`coloyond:mvp:${connection.rpcEndpoint}:${PROGRAM_ID}:${publicKey??'none'}`;
  const journal:Journal={read:()=>readPending(journalKey),write:p=>{localStorage.setItem(journalKey,JSON.stringify(p));setPending(p);},clear:()=>{localStorage.removeItem(journalKey);setPending(null);}};
  const refresh=useCallback(async()=>{
    const seq=++request.current;
    try{await assertNetwork(connection,import.meta.env.VITE_ALLOW_LOCALNET==='1');await assertProgram(connection,PROGRAM_ID);
      const vs=publicKey?await listVaults(connection,PROGRAM_ID,publicKey):[];
      const snapshots=await Promise.all(vs.map(v=>snapshot(connection,PROGRAM_ID,v)));
      if(seq!==request.current)return;setVaults(snapshots);setReady(true);setStatus(publicKey?`Read from confirmed chain state · ${snapshots.length} vaults`:'Connect your wallet to create or manage vaults');setError('');
    }catch(e){if(seq===request.current){setReady(false);setError(err(e));setStatus('Deployment or RPC unavailable');}}
  },[connection,publicKey]);
  useEffect(()=>{setVaults([]);setReady(false);try{setPending(readPending(journalKey));}catch(e){setError(err(e));}void refresh();const timer=setInterval(()=>void refresh(),10000);return()=>{clearInterval(timer);request.current++;};},[refresh,journalKey]);
  const checkPending=async()=>{
    const p=journal.read();if(!p)return;
    if(p.genesis!==await connection.getGenesisHash()||p.program!==PROGRAM_ID.toBase58()||p.owner!==publicKey?.toBase58())throw new Error('Pending transaction identity does not match this wallet/network/program');
    const outcome=await reconcile(connection,p);setStatus(`${p.action}: ${outcome}`);
    if(outcome!=='unknown'){journal.clear();await refresh();setStatus(`${p.action}: ${outcome}`);if(outcome==='failed')setError('Transaction failed on-chain; refreshed custody balances.');}
  };
  useEffect(()=>{if(!pending)return;const timer=setInterval(()=>void checkPending().catch(e=>setError(err(e))),4000);return()=>clearInterval(timer);},[pending,journalKey,connection,publicKey]);
  const run:Run=async(label,instructions)=>{
    if(operation.current)throw new Error('Another wallet operation is in progress');
    if(!publicKey||!signTransaction)throw new Error('Connect a wallet that supports transaction signing');
    operation.current=true;setBusy(true);setError('');setStatus(`Wallet review: ${label}`);
    try{await assertNetwork(connection,import.meta.env.VITE_ALLOW_LOCALNET==='1');await assertProgram(connection,PROGRAM_ID);
      const p=await submit(connection,PROGRAM_ID,publicKey,label,instructions,signTransaction,journal);setStatus(`Submitted or awaiting reconciliation: ${p.signature}`);await checkPending();
    }catch(e){setError(err(e));throw e;}finally{operation.current=false;setBusy(false);}
  };
  const create=async()=>{
    if(!publicKey)return;
    try{const assets=allocations(selected,weights);const bytes=crypto.getRandomValues(new Uint8Array(8));let id=0n;for(let i=0;i<8;i++)id|=BigInt(bytes[i]!)<<BigInt(i*8);
      const address=vaultAddress(PROGRAM_ID,publicKey,id);await run('Create personal vault',[createVault(PROGRAM_ID,publicKey,id,assets,5,100),...ensureAtas(publicKey,address,assets)]);
    }catch(e){setError(err(e));}
  };
  const disabled=!ready||busy||!!pending;
  return <div className="shell"><header><a className="brand" href="/">coloyond<span>✳</span></a><div className="header-right"><span className="network">Solana Devnet MVP</span><WalletMultiButton/></div></header><main><section className="intro"><p className="eyebrow">01 / Personal portfolio vaults</p><h1>Your allocation.<br/>Your custody rules.</h1><p>Create and fund a vault with your wallet. Independent crankers can fill oracle-priced trades that reduce its drift. Your wallet controls the portfolio and withdrawals.</p></section><section className="connection"><div><strong>{status}</strong><small>Program: {PROGRAM_ID.toBase58()}</small></div><button className="secondary" onClick={()=>void refresh()}>Refresh chain state</button></section>{error&&<p role="alert" className="error">{error}</p>}{pending&&<section className="notice"><strong>Unresolved wallet transaction</strong><p>{pending.action} · {pending.signature}</p><button onClick={()=>void checkPending().catch(e=>setError(err(e)))}>Reconcile signature</button><p>Further actions stay blocked until confirmation, failure, or verified blockhash expiry.</p></section>}
    <section className="create"><div><p className="eyebrow">A / Start a portfolio</p><h2>Create a vault</h2><p className="hint">Supported Devnet assets are WSOL and Test USDC. Test USDC is a test token, not backed or redeemable USD. Target weights must total 100%.</p></div><div><AllocationEditor {...{selected,setSelected,weights,setWeights}}/><button disabled={disabled||!publicKey} onClick={()=>void create()}>Create with wallet</button></div></section><div className="section-heading"><h2>Your on-chain vaults</h2><span>{vaults.length.toString().padStart(2,'0')}</span></div>{vaults.map(s=><VaultCard key={`${s.vault.address}:${s.vault.revision}`} s={s} run={run} busy={disabled}/>)}{ready&&publicKey&&!vaults.length&&<p className="empty">No MVP vaults found for this wallet. Create your first portfolio above.</p>}</main><footer><span>Owner-signed custody. Permissionless, inventory-backed rebalancing.</span><span>Cranker availability and oracle freshness determine execution.</span></footer></div>;
}
