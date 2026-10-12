#!/usr/bin/env node
/** One-time devnet migration: delegate reserve inventory and approve the ER PDA. */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { delegateSpl } from '@magicblock-labs/ephemeral-rollups-sdk';
import { base58 } from '@scure/base';
import keysJson from '../target/demo-keys.json' with { type: 'json' };

const BASE_RPC = 'https://api.devnet.solana.com';
const ER_RPC = 'https://devnet-as.magicblock.app/';
const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const RESERVE_DELEGATE_SEED = Buffer.from('reserve-delegate');
const AUTHORIZE_RESERVE_DISCRIMINATOR = Buffer.from('e714de41eb8d2141', 'hex');
const connection = new Connection(BASE_RPC, 'confirmed');
const ephemeral = new Connection(ER_RPC, 'confirmed');
const reserve = Keypair.fromSecretKey(base58.decode(keysJson.reserveSecretB58));
const mints = [
  { name: 'WSOL', key: NATIVE_MINT },
  ...['tusd', 'tbtc', 'teth'].map((id) => ({ name: id.toUpperCase(), key: new PublicKey(keysJson.mints[id].address) })),
];
const delegate = PublicKey.findProgramAddressSync([RESERVE_DELEGATE_SEED, reserve.publicKey.toBuffer()], PROGRAM_ID)[0];

async function send(rpc, tx, signers, label) {
  const blockhash = await rpc.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash.blockhash;
  tx.lastValidBlockHeight = blockhash.lastValidBlockHeight;
  tx.feePayer = signers[0].publicKey;
  const sig = await rpc.sendTransaction(tx, signers);
  const confirmation = await rpc.confirmTransaction({ signature: sig, ...blockhash }, 'confirmed');
  if (confirmation.value.err) throw new Error(`${label} failed: ${JSON.stringify(confirmation.value.err)}`);
  console.log(`${label}: ${sig}`);
}

for (const mint of mints) {
  const ata = getAssociatedTokenAddressSync(mint.key, reserve.publicKey);
  const currentErAccount = await ephemeral.getAccountInfo(ata, 'confirmed');
  if (!currentErAccount) {
    const amount = await connection.getTokenAccountBalance(ata, 'confirmed').then((v) => BigInt(v.value.amount));
    const instructions = await delegateSpl(reserve.publicKey, mint.key, amount, {
      idempotent: false,
      payer: reserve.publicKey,
    });
    await send(connection, new Transaction().add(...instructions), [reserve], `Delegate ${mint.name} reserve balance`);
  }

  for (let attempt = 0; attempt < 30 && !(await ephemeral.getAccountInfo(ata, 'confirmed')); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!(await ephemeral.getAccountInfo(ata, 'confirmed'))) throw new Error(`${mint.name} reserve ATA did not appear on the ER`);

  const authorize = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: reserve.publicKey, isSigner: true, isWritable: false },
      { pubkey: delegate, isSigner: false, isWritable: false },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: AUTHORIZE_RESERVE_DISCRIMINATOR,
  });
  await send(ephemeral, new Transaction().add(authorize), [reserve], `Approve program reserve allowance for ${mint.name}`);
}

console.log(`Reserve execution authority is configured for ${reserve.publicKey.toBase58()} via ${delegate.toBase58()}.`);
