import { Buffer } from 'buffer';
import { Connection, PublicKey, type AccountInfo } from '@solana/web3.js';
import { AccountLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { decodeVault, discriminator, type Vault } from './codec.js';
import { assetFor, DEVNET_GENESIS } from './config.js';
import { ata, vaultAddress } from './instructions.js';
import { readPrice, type Price } from './oracle.js';
export interface Snapshot { vault: Vault; balances: bigint[]; prices: Price[] | null; oracleError: string | null; slot: number; now: bigint }
export async function assertNetwork(connection: Connection,allowLocalnet=false) {
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS && !(allowLocalnet && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(connection.rpcEndpoint))) throw new Error('Only Devnet or explicit localhost Localnet is supported');
  return genesis;
}
export async function assertProgram(connection: Connection,program: PublicKey) {
  const info = await connection.getAccountInfo(program,'confirmed');
  if (!info?.executable) throw new Error('MVP program is not deployed at the configured address');
}
export function tokenAmount(info: AccountInfo<Buffer> | null,authority: PublicKey,mint: PublicKey): bigint {
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length !== AccountLayout.span) throw new Error('Missing or invalid SPL token account');
  const t = AccountLayout.decode(info.data);
  if (!t.owner.equals(authority) || !t.mint.equals(mint) || t.state !== 1 || t.delegateOption !== 0 || t.closeAuthorityOption !== 0) throw new Error('Invalid token custody authority, mint, or state');
  return t.amount;
}
export async function listVaults(connection: Connection,program: PublicKey,owner?: PublicKey): Promise<Vault[]> {
  const filters = [{dataSize:172},...(owner?[{memcmp:{offset:8,bytes:owner.toBase58()}}]:[])];
  const accounts = await connection.getProgramAccounts(program,{commitment:'confirmed',filters});
  return accounts.flatMap(({pubkey,account})=>{
    if (!account.data.subarray(0,8).equals(discriminator('account','Vault'))) return [];
    const v=decodeVault(pubkey,account.data);
    if (!vaultAddress(program,v.owner,v.id).equals(pubkey)) throw new Error('Invalid vault PDA');
    return [v];
  });
}
/** Reread configuration together with custody, oracle and clock in a single RPC context.
 * If token membership changed, retry with its NEW account set, never reuse the old indices.
 */
export async function snapshot(connection: Connection,program: PublicKey,initial: Vault): Promise<Snapshot> {
  let v=initial;
  for (let attempt=0;attempt<3;attempt++) {
    const clockKey=new PublicKey('SysvarC1ock11111111111111111111111111111111');
    const keys=[v.address,...v.assets.map(a=>ata(v.address,a.mint)),...v.assets.map(a=>assetFor(a.mint).feed),clockKey];
    const res=await connection.getMultipleAccountsInfoAndContext(keys,{commitment:'confirmed'});
    const account=res.value[0];
    if (!account || !account.owner.equals(program)) throw new Error('Vault closed or wrong program owner');
    const fresh=decodeVault(v.address,account.data);
    if (!vaultAddress(program,fresh.owner,fresh.id).equals(fresh.address)) throw new Error('Invalid vault PDA');
    if (fresh.revision !== v.revision) {v=fresh;continue;}
    const clock=res.value.at(-1);
    if (!clock || clock.data.length !== 40 || !clock.owner.equals(new PublicKey('Sysvar1111111111111111111111111111111111111'))) throw new Error('Invalid chain clock');
    const now=clock.data.readBigInt64LE(32);
    const balances=fresh.assets.map((a,i)=>tokenAmount(res.value[1+i]!,fresh.address,a.mint));
    let prices: Price[]|null=null,oracleError:string|null=null;
    try {prices=fresh.assets.map((a,i)=>{const info=res.value[1+fresh.assets.length+i];if(!info)throw new Error('Pyth feed is missing');return readPrice(a.mint,assetFor(a.mint).feed,info,now);});}
    catch(e) {oracleError=e instanceof Error?e.message:String(e);}
    return {vault:fresh,balances,prices,oracleError,slot:res.context.slot,now};
  }
  throw new Error('Portfolio changed repeatedly; refresh');
}
