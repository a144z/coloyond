import { PythSolanaReceiver } from '@pythnetwork/pyth-solana-receiver';
import { Connection,Keypair,PublicKey,Transaction,VersionedTransaction } from '@solana/web3.js';
import { ASSETS,RECEIVER_ID } from '../shared/config.js';
import { reconcile,submit,type Journal } from '../shared/transactions.js';

export async function fetchSignedUpdates(fetcher:typeof fetch=fetch,apiKey=process.env.PYTH_API_KEY??''):Promise<string[]>{
  const url=new URL('https://hermes.pyth.network/v2/updates/price/latest');
  for(const a of ASSETS)url.searchParams.append('ids[]',a.feedId);
  url.searchParams.set('encoding','base64');
  const res=await fetcher(url,{signal:AbortSignal.timeout(15000),headers:apiKey?{Authorization:`Bearer ${apiKey}`}:{}});
  if(!res.ok)throw new Error(res.status===401?'Pyth Hermes requires an operator PYTH_API_KEY (Bearer authorization); no vault fill was submitted':`Pyth Hermes HTTP ${res.status}`);
  const data=await res.json() as {binary?:{encoding?:unknown;data?:unknown}};
  const updates=data.binary?.data;
  if(data.binary?.encoding!=='base64'||!Array.isArray(updates)||!updates.length||updates.length>8||updates.some(x=>typeof x!=='string'||x.length>65536||!/^[A-Za-z0-9+/=]+$/.test(x)))throw new Error('Invalid Hermes signed-update payload');
  return updates as string[];
}
/** Official SDK FULL Wormhole verification, then update the exact shard-0
 * sponsored feed PDAs. HTTP parsed prices are never used as execution authority.
 * Funding/rent/fees belong to the operator, never the vault.
 */
export async function refreshOracles(connection:Connection,program:PublicKey,keeper:Keypair,journal:Journal,log:(data:unknown)=>void):Promise<boolean>{
  if(journal.read())return false;
  const wallet={publicKey:keeper.publicKey,
    async signTransaction<T extends Transaction|VersionedTransaction>(tx:T):Promise<T>{if(tx instanceof Transaction)tx.partialSign(keeper);else tx.sign([keeper]);return tx;},
    async signAllTransactions<T extends Transaction|VersionedTransaction>(txs:T[]):Promise<T[]>{for(const tx of txs)await this.signTransaction(tx);return txs;},
  };
  const receiver=new PythSolanaReceiver({connection,wallet,receiverProgramId:RECEIVER_ID});
  for(const a of ASSETS)if(!receiver.getPriceFeedAccountAddress(0,a.feedId).equals(a.feed))throw new Error('Pyth SDK feed derivation differs from immutable registry');
  const builder=receiver.newTransactionBuilder({closeUpdateAccounts:true});
  // Recover encoded VAA rent left by a prior interrupted operator-only refresh.
  await builder.addClosePreviousEncodedVaasInstructions(4);
  await builder.addUpdatePriceFeed(await fetchSignedUpdates(),0);
  const batches=builder.buildLegacyTransactions({computeUnitPriceMicroLamports:1000});
  for(const [i,{tx,signers}]of batches.entries()){
    const pending=await submit(connection,program,keeper.publicKey,`Pyth Full refresh ${i+1}/${batches.length}`,tx.instructions,async fresh=>{fresh.partialSign(keeper,...signers);return fresh;},journal);
    log({event:'oracle_update_submitted',batch:i+1,total:batches.length,signature:pending.signature});
    let outcome:'confirmed'|'failed'|'unknown'|'expired'='unknown';
    for(let tries=0;tries<20;tries++){outcome=await reconcile(connection,pending);if(outcome!=='unknown')break;await new Promise(r=>setTimeout(r,500));}
    if(outcome==='unknown')return false;
    journal.clear();
    if(outcome!=='confirmed')throw new Error(`Pyth refresh ${outcome}; no vault trade submitted`);
  }
  return true;
}
