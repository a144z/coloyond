#!/usr/bin/env node
/** Run a scoped Hydra cranker for one configured standard-SPL vault. */
import { readFile } from 'node:fs/promises';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';

const HYDRA_ID = new PublicKey('eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf');
const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const CRANK_POLICY_SEED = Buffer.from('crank-policy');
const ROUTER_RPC = process.env.COLONYOND_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const BASE_RPC = process.env.COLONYOND_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const signerPath = process.env.COLONYOND_CRANKER_SIGNER ?? 'target/hydra-cranker-devnet.json';
const executor = new PublicKey(process.env.COLONYOND_EXECUTOR ?? '5kMK7ZWNrj9SXFoR1RgfYVe4McuPt2dr9Ex3x9kfMHoH');
const crank = new PublicKey(process.env.COLONYOND_HYDRA_CRANK ?? '5kaxs2PnxosiSJu5RG6mgWdpMCE3gXtUUg5QrpmQw9rY');
const state = new PublicKey(process.env.COLONYOND_VAULT_STATE ?? 'H1fupUxEGc781oFLcXDpDAWByLU7zTF1bUYTBiCxRC2h');
const cranker = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(signerPath, 'utf8'))));
const router = new ConnectionMagicRouter(ROUTER_RPC, 'confirmed');
const executorStatus = await router.getDelegationStatus(executor);
if (!executorStatus.isDelegated || !executorStatus.fqdn) throw new Error('The configured vault Executor is not available on an ER.');
const crankerStatus = await router.getDelegationStatus(cranker.publicKey);
if (!crankerStatus.isDelegated || crankerStatus.fqdn !== executorStatus.fqdn) {
  throw new Error('The dedicated cranker must be delegated to the same ER as the vault Executor.');
}

const host = new Connection(executorStatus.fqdn, 'confirmed');
const policy = PublicKey.findProgramAddressSync([CRANK_POLICY_SEED, state.toBuffer()], PROGRAM_ID)[0];
const base = new Connection(BASE_RPC, 'confirmed');
const policyInfo = await base.getAccountInfo(policy, 'confirmed');
if (!policyInfo || !policyInfo.owner.equals(PROGRAM_ID) || policyInfo.data.length < 92 || !policyInfo.data.subarray(8, 40).equals(state.toBuffer())) {
  throw new Error('The configured vault Crank Policy is missing or malformed.');
}
console.log(JSON.stringify({ event: 'watching', state: state.toBase58(), executor: executor.toBase58(), crank: crank.toBase58() }));
while (true) {
  try {
    const currentPolicy = await base.getAccountInfo(policy, 'confirmed');
    if (!currentPolicy || !currentPolicy.owner.equals(PROGRAM_ID) || currentPolicy.data.length < 92 || !currentPolicy.data.subarray(8, 40).equals(state.toBuffer())) {
      throw new Error('The configured vault Crank Policy is missing or malformed.');
    }
    const minIntervalSeconds = Number(currentPolicy.data.readBigUInt64LE(72));
    if (!Number.isInteger(minIntervalSeconds) || minIntervalSeconds < 60 || minIntervalSeconds > 86_400) throw new Error('The vault Crank Policy interval is out of range.');
    const expectedIntervalSlots = Math.ceil(minIntervalSeconds * 5_700 / 60);
    const crankInfo = await host.getAccountInfo(crank, 'confirmed');
    if (!crankInfo || !crankInfo.owner.equals(HYDRA_ID)) throw new Error('The configured Hydra crank is missing.');
    const data = crankInfo.data;
    const intervalSlots = Number(data.readBigUInt64LE(72));
    if (intervalSlots !== expectedIntervalSlots) throw new Error(`Expected a ${expectedIntervalSlots}-slot task; found ${intervalSlots}.`);
    const nextExecSlot = Number(data.readBigUInt64LE(64));
    const currentSlot = await host.getSlot('confirmed');
    if (currentSlot < nextExecSlot) {
      const delay = Math.min(5_000, Math.max(1_000, Math.ceil((nextExecSlot - currentSlot) * 1_000 / 94)));
      await sleep(delay);
      continue;
    }

    const regionLength = data.readUInt16LE(112);
    if (regionLength === 0 || data.length < 120 + regionLength) throw new Error('Hydra task template is malformed.');
    const scheduled = decodeInstruction(data.subarray(120, 120 + regionLength));
    const callback = Buffer.from([0xeb, 0xf6, 0x7d, 0x55, 0x89, 0x61, 0xde, 0xdf]);
    if (!scheduled.programId.equals(PROGRAM_ID) || !scheduled.data.subarray(0, 8).equals(callback)
      || !scheduled.keys[1]?.pubkey.equals(state) || !scheduled.keys[4]?.pubkey.equals(policy)) {
      throw new Error('The configured crank is not this vault program’s rebalance instruction.');
    }
    const trigger = new TransactionInstruction({
      programId: HYDRA_ID,
      keys: [
        { pubkey: crank, isSigner: false, isWritable: true },
        { pubkey: cranker.publicKey, isSigner: true, isWritable: true },
        { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    });
    const tx = new Transaction();
    const computeUnits = data.readUInt32LE(115);
    if (computeUnits > 0) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    tx.add(trigger, scheduled);
    tx.feePayer = cranker.publicKey;
    const signature = await router.sendAndConfirmTransaction(tx, [cranker]);
    console.log(JSON.stringify({ event: 'triggered', signature, currentSlot, intervalSlots }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'retry', error: error instanceof Error ? error.message : String(error) }));
    await sleep(3_000);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeInstruction(region) {
  let offset = 0;
  const count = region.readUInt16LE(offset); offset += 2;
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const flag = region[offset++];
    const pubkey = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
    keys.push({ pubkey, isSigner: false, isWritable: (flag & 2) !== 0 });
  }
  const programId = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
  const length = region.readUInt16LE(offset); offset += 2;
  if (offset + length !== region.length) throw new Error('Hydra callback data length is invalid.');
  return new TransactionInstruction({ programId, keys, data: region.subarray(offset, offset + length) });
}
