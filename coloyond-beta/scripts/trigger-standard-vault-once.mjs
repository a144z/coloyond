#!/usr/bin/env node
/** Safely fire only the configured portfolio Hydra task once for its Devnet canary. */
import { readFile } from 'node:fs/promises';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';

const HYDRA_ID = new PublicKey('eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf');
const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const ROUTER_RPC = process.env.COLONYOND_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const signerPath = process.env.COLONYOND_CRANKER_SIGNER ?? 'target/hydra-cranker-devnet.json';
const executor = new PublicKey(process.env.COLONYOND_EXECUTOR ?? '5kMK7ZWNrj9SXFoR1RgfYVe4McuPt2dr9Ex3x9kfMHoH');
const crank = new PublicKey(process.env.COLONYOND_HYDRA_CRANK ?? '5kaxs2PnxosiSJu5RG6mgWdpMCE3gXtUUg5QrpmQw9rY');
const cranker = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(signerPath, 'utf8'))));
const router = new ConnectionMagicRouter(ROUTER_RPC, 'confirmed');
const status = await router.getDelegationStatus(executor);
if (!status.isDelegated || !status.fqdn) throw new Error('The vault Executor is not available on its ER.');
const crankerStatus = await router.getDelegationStatus(cranker.publicKey);
if (!crankerStatus.isDelegated || crankerStatus.fqdn !== status.fqdn) {
  throw new Error('The dedicated canary cranker is not delegated to the vault Executor ER.');
}
const host = new Connection(status.fqdn, 'confirmed');
const crankInfo = await host.getAccountInfo(crank, 'confirmed');
if (!crankInfo || !crankInfo.owner.equals(HYDRA_ID)) throw new Error('The configured Hydra crank is missing.');
const data = crankInfo.data;
const nextExecSlot = Number(data.readBigUInt64LE(64));
const intervalSlots = Number(data.readBigUInt64LE(72));
const regionLength = data.readUInt16LE(112);
const computeUnits = data.readUInt32LE(115);
if (intervalSlots !== 5_700) throw new Error(`Expected a 5,700-slot task; found ${intervalSlots}.`);
if (regionLength === 0 || data.length < 120 + regionLength) throw new Error('Hydra task instruction template is malformed.');
const scheduled = decodeInstruction(data.subarray(120, 120 + regionLength));
if (!scheduled.programId.equals(PROGRAM_ID) || scheduled.data.length < 8 ||
    !scheduled.data.subarray(0, 8).equals(Buffer.from([0xeb, 0xf6, 0x7d, 0x55, 0x89, 0x61, 0xde, 0xdf]))) {
  throw new Error('The task does not contain this vault program’s rebalance instruction.');
}

let currentSlot = await host.getSlot('confirmed');
for (let attempt = 0; currentSlot < nextExecSlot && attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  currentSlot = await host.getSlot('confirmed');
}
if (currentSlot < nextExecSlot) throw new Error(`Task is not due yet (${currentSlot}/${nextExecSlot} ER slots).`);

const trigger = new TransactionInstruction({
  programId: HYDRA_ID,
  keys: [
    { pubkey: crank, isSigner: false, isWritable: true },
    { pubkey: cranker.publicKey, isSigner: true, isWritable: true },
    { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([1]),
});
const transaction = new Transaction();
if (computeUnits > 0) transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
transaction.add(trigger, scheduled);
transaction.feePayer = cranker.publicKey;
const signature = await router.sendAndConfirmTransaction(transaction, [cranker]);
console.log(JSON.stringify({
  signature,
  crank: crank.toBase58(),
  currentSlot,
  intervalSlots,
  callback: 'rebalance_ephemeral',
  note: 'This sends Trigger for this one crank only; it does not run a global Hydra cranker.',
}, null, 2));

function decodeInstruction(region) {
  let offset = 0;
  const accountsLength = region.readUInt16LE(offset); offset += 2;
  const metas = [];
  for (let index = 0; index < accountsLength; index += 1) {
    const flags = region[offset++];
    const pubkey = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
    metas.push({ pubkey, isSigner: false, isWritable: (flags & 2) !== 0 });
  }
  const programId = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
  const dataLength = region.readUInt16LE(offset); offset += 2;
  if (offset + dataLength !== region.length) throw new Error('Hydra callback template has invalid lengths.');
  return { programId, keys: metas, data: region.subarray(offset, offset + dataLength) };
}
