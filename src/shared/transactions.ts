import { Buffer } from 'buffer';
import { Connection, Transaction, type PublicKey, type TransactionInstruction } from '@solana/web3.js';
export interface Pending { signature: string; blockhash: string; lastValidBlockHeight: number; owner: string; genesis: string; program: string; action: string; createdAt: number }
export type Outcome = 'confirmed'|'failed'|'unknown'|'expired';
export interface Journal { read(): Pending|null; write(p: Pending): void; clear(): void }
// Small base58 encoder avoids pulling a Node-only crypto path into the browser.
export function signatureBase58(bytes: Uint8Array): string {
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),out='';
  while(n>0n){out=alphabet[Number(n%58n)]+out;n/=58n;}
  for(const byte of bytes){if(byte!==0)break;out='1'+out;}
  return out;
}
export async function reconcile(connection: Connection,p: Pending): Promise<Outcome> {
  const res=await connection.getSignatureStatuses([p.signature],{searchTransactionHistory:true});
  const status=res.value[0];
  if(status?.err) return 'failed';
  if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized')return 'confirmed';
  // Processed is unresolved even after expiry; do not race a fork/confirmation.
  if(status)return 'unknown';
  if(await connection.getBlockHeight('finalized') > p.lastValidBlockHeight)return 'expired';
  return 'unknown';
}
export async function submit(connection: Connection,program: PublicKey,owner: PublicKey,action: string,instructions: TransactionInstruction[],sign: (tx: Transaction)=>Promise<Transaction>,journal: Journal): Promise<Pending> {
  if(journal.read())throw new Error('A transaction is unresolved. Reconcile it before another wallet action.');
  const genesis=await connection.getGenesisHash();
  const block=await connection.getLatestBlockhash('confirmed');
  const tx=new Transaction({feePayer:owner,...block}).add(...instructions);
  const message=Buffer.from(tx.serializeMessage());
  const signed=await sign(tx);
  if(!Buffer.from(signed.serializeMessage()).equals(message)||!signed.signature)throw new Error('Wallet changed the transaction or did not sign');
  const bytes=signed.serialize();
  const pending:Pending={signature:signatureBase58(signed.signature),...block,owner:owner.toBase58(),genesis,program:program.toBase58(),action,createdAt:Date.now()};
  // Journal BEFORE broadcast; even a lost HTTP response retains its exact signature.
  journal.write(pending);
  try {const signature=await connection.sendRawTransaction(bytes,{skipPreflight:false,maxRetries:3});if(signature!==pending.signature)throw new Error('RPC returned unexpected signature');}
  catch { return pending; }
  return pending;
}
