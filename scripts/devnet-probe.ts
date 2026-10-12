import {Connection,PublicKey} from '@solana/web3.js';
import {ASSETS,DEFAULT_PROGRAM} from '../src/shared/config.js';
import {assertNetwork} from '../src/shared/rpc.js';
import {readPrice} from '../src/shared/oracle.js';
const c=new Connection(process.env.RPC_URL??'https://api.devnet.solana.com','confirmed');
const program=new PublicKey(process.env.PROGRAM_ID??DEFAULT_PROGRAM);
await assertNetwork(c);
const res=await c.getMultipleAccountsInfoAndContext([program,...ASSETS.map(a=>a.feed),new PublicKey('SysvarC1ock11111111111111111111111111111111')],{commitment:'confirmed'});
const now=res.value.at(-1)!.data.readBigInt64LE(32);
console.log(JSON.stringify({slot:res.context.slot,program:program.toBase58(),deployed:!!res.value[0]?.executable}));
for(let i=0;i<ASSETS.length;i++){try{const info=res.value[i+1];if(!info)throw new Error('Missing feed');const price=readPrice(ASSETS[i]!.mint,ASSETS[i]!.feed,info,now);console.log(JSON.stringify({asset:ASSETS[i]!.symbol,ready:true,price},(_k,v)=>typeof v==='bigint'?v.toString():v));}catch(e){console.log(JSON.stringify({asset:ASSETS[i]!.symbol,ready:false,error:String(e)}));}}
