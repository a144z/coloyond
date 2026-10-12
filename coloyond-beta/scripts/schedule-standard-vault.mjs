#!/usr/bin/env node
/** Register a configurable, guarded Hydra task for a standard-SPL vault on Devnet. */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  ConnectionMagicRouter,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  magicFeeVaultPdaFromValidator,
} from '@magicblock-labs/ephemeral-rollups-sdk';

const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const HYDRA_ID = new PublicKey('eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const MIN_INTERVAL_SECONDS = Number(process.env.COLONYOND_CRANK_INTERVAL_SECONDS ?? 60);
if (!Number.isInteger(MIN_INTERVAL_SECONDS) || MIN_INTERVAL_SECONDS < 60 || MIN_INTERVAL_SECONDS > 86_400) {
  throw new Error('COLONYOND_CRANK_INTERVAL_SECONDS must be a whole number from 60 to 86400.');
}
const INTERVAL_SLOTS = Math.ceil(MIN_INTERVAL_SECONDS * 5_700 / 60);
const SPONSOR_FUNDING_LAMPORTS = 5_000_000;
const forceReplace = process.env.COLONYOND_FORCE_REPLACE === '1';
const BASE_RPC = process.env.COLONYOND_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const ROUTER_RPC = process.env.COLONYOND_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const ownerPath = process.env.COLONYOND_CANARY_SIGNER ?? `${homedir()}/.config/solana/devnet-id.json`;
const crankerPath = process.env.COLONYOND_CRANKER_SIGNER ?? 'target/hydra-cranker-devnet.json';
const stateAddress = new PublicKey(process.env.COLONYOND_VAULT_STATE ?? 'H1fupUxEGc781oFLcXDpDAWByLU7zTF1bUYTBiCxRC2h');
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(ownerPath, 'utf8'))));
const base = new Connection(BASE_RPC, 'confirmed');
const router = new ConnectionMagicRouter(ROUTER_RPC, 'confirmed');
const discriminator = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const derive = (seeds, program = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, program)[0];
const u64 = (value) => { const data = Buffer.alloc(8); data.writeBigUInt64LE(BigInt(value)); return data; };

const stateInfo = await base.getAccountInfo(stateAddress, 'confirmed');
if (!stateInfo || !stateInfo.owner.equals(PROGRAM_ID) || stateInfo.data.length < 98) {
  throw new Error('Vault State is missing, malformed, or owned by a different program.');
}
if (!stateInfo.data.subarray(16, 48).equals(owner.publicKey.toBuffer())) {
  throw new Error('The configured signer is not this vault owner.');
}
if (stateInfo.data.readUInt8(80) !== 1) throw new Error('Vault is paused; activate it before scheduling.');

const assetCount = stateInfo.data.readUInt32LE(94);
if (assetCount < 2 || assetCount > 4 || stateInfo.data.length < 98 + assetCount * 99) {
  throw new Error('Vault State has an invalid asset list.');
}
const assets = Array.from({ length: assetCount }, (_, index) => {
  const offset = 98 + index * 99;
  return {
    mint: new PublicKey(stateInfo.data.subarray(offset, offset + 32)),
    feed: new PublicKey(stateInfo.data.subarray(offset + 35, offset + 67)),
  };
});
const [authority, shareMint, executor, schedulerConfig, crankPolicy, marketAuthority] = [
  derive([Buffer.from('vault-authority'), stateAddress.toBuffer()]),
  derive([Buffer.from('share-mint'), stateAddress.toBuffer()]),
  derive([Buffer.from('executor'), stateAddress.toBuffer()]),
  derive([Buffer.from('scheduler-config'), stateAddress.toBuffer()]),
  derive([Buffer.from('crank-policy'), stateAddress.toBuffer()]),
  derive([Buffer.from('market-authority')]),
];
const vaultTokens = assets.map(({ mint }) => getAssociatedTokenAddressSync(mint, authority, true));
const marketTokens = assets.map(({ mint }) => getAssociatedTokenAddressSync(mint, marketAuthority, true));
const feeds = assets.map(({ feed }) => feed).filter((feed) => !feed.equals(PublicKey.default));
if (feeds.length === 0) throw new Error('This vault has no Pyth-backed asset for the 0.1% movement guard.');
await setCrankPolicy(MIN_INTERVAL_SECONDS);

// Ensure the standard SPL market ATAs exist; these are reserve accounts, never vault custody.
const marketSetup = new Transaction();
for (let index = 0; index < assets.length; index += 1) {
  if (await base.getAccountInfo(marketTokens[index], 'confirmed')) continue;
  marketSetup.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: marketAuthority, isSigner: false, isWritable: false },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: assets[index].mint, isSigner: false, isWritable: false },
      { pubkey: marketTokens[index], isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('create_market_asset_account'),
  }));
}
let marketSetupSignature;
if (marketSetup.instructions.length) marketSetupSignature = await sendAndConfirmTransaction(base, marketSetup, [owner]);

// Only the Executor PDA is delegated. Every portfolio and market token account remains a
// standard SPL account on the base layer.
const executorStatus = await router.getDelegationStatus(executor);
if (!executorStatus.isDelegated) {
  const delegateExecutor = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(executor, PROGRAM_ID), isSigner: false, isWritable: true },
      { pubkey: delegationRecordPdaFromDelegatedAccount(executor), isSigner: false, isWritable: true },
      { pubkey: delegationMetadataPdaFromDelegatedAccount(executor), isSigner: false, isWritable: true },
      { pubkey: executor, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('delegate_executor'),
  });
  await sendAndConfirmTransaction(base, new Transaction().add(delegateExecutor), [owner]);
}
const hostStatus = await waitDelegation(executor);
const host = new ConnectionMagicRouter(hostStatus.fqdn, 'confirmed');
const hostConnection = new Connection(hostStatus.fqdn, 'confirmed');
const validatorResponse = await fetch(hostStatus.fqdn, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getIdentity', params: [] }),
});
const validatorBody = await validatorResponse.json();
if (!validatorResponse.ok || validatorBody.error || !validatorBody.result?.identity) {
  throw new Error('Could not resolve the validator hosting this portfolio Executor.');
}
const validator = new PublicKey(validatorBody.result.identity);

// Reuse a local delegated signer for the Hydra sponsor. This key is generated in ignored
// target/ and never printed; the owner funds only the small task-rent balance.
let cranker;
try {
  cranker = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(crankerPath, 'utf8'))));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await mkdir(dirname(crankerPath), { recursive: true });
  cranker = Keypair.generate();
  await writeFile(crankerPath, JSON.stringify([...cranker.secretKey]), { mode: 0o600, flag: 'wx' });
  await chmod(crankerPath, 0o600);
}
let crankerStatus = await router.getDelegationStatus(cranker.publicKey);
if (!crankerStatus.isDelegated) {
  await sendAndConfirmTransaction(base, new Transaction().add(SystemProgram.transfer({
    fromPubkey: owner.publicKey,
    toPubkey: cranker.publicKey,
    lamports: SPONSOR_FUNDING_LAMPORTS,
  })), [owner]);
  const buffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(cranker.publicKey, SystemProgram.programId);
  const delegateData = Buffer.alloc(49);
  delegateData.writeUInt32LE(0xffff_ffff, 8);
  delegateData.writeUInt32LE(0, 12);
  delegateData[16] = 1;
  validator.toBuffer().copy(delegateData, 17);
  const delegateSponsor = new TransactionInstruction({
    programId: DELEGATION_PROGRAM_ID,
    keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: cranker.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: delegationRecordPdaFromDelegatedAccount(cranker.publicKey), isSigner: false, isWritable: true },
      { pubkey: delegationMetadataPdaFromDelegatedAccount(cranker.publicKey), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: delegateData,
  });
  await sendAndConfirmTransaction(base, new Transaction().add(delegateSponsor), [owner, cranker]);
  crankerStatus = await waitDelegation(cranker.publicKey);
}
if (!crankerStatus.isDelegated || crankerStatus.fqdn !== hostStatus.fqdn) {
  throw new Error('Hydra sponsor and vault Executor must be delegated to the same ER.');
}

const crankFor = (sponsor) => derive([Buffer.from('crank'), sponsor.toBuffer(), stateAddress.toBuffer()], HYDRA_ID);
const configInfo = await base.getAccountInfo(schedulerConfig, 'confirmed');
if (configInfo && (!configInfo.owner.equals(PROGRAM_ID) || configInfo.data.length < 104)) {
  throw new Error('Scheduler Config is malformed.');
}
const configuredSponsor = configInfo ? new PublicKey(configInfo.data.subarray(72, 104)) : null;
const legacySystemSponsor = derive([Buffer.from('scheduler-sponsor'), stateAddress.toBuffer()]);
const candidates = [configuredSponsor, executor, legacySystemSponsor].filter((candidate, index, all) =>
  candidate && all.findIndex((other) => other?.equals(candidate)) === index);
let currentTask;
const replacedTasks = [];
for (const candidate of candidates) {
  const candidateCrank = crankFor(candidate);
  const crankInfo = await host.getAccountInfo(candidateCrank, 'confirmed');
  if (!crankInfo) continue;
  if (!crankInfo.owner.equals(HYDRA_ID)) throw new Error(`Task PDA ${candidateCrank} has an unexpected owner.`);
  const interval = Number(crankInfo.data.readBigUInt64LE(72));
  if (!forceReplace && candidate.equals(cranker.publicKey) && interval === INTERVAL_SLOTS &&
      callbackMatches(crankInfo.data, stateAddress, executor, schedulerConfig, crankPolicy)) {
    currentTask = { sponsor: candidate, crank: candidateCrank, interval };
    continue;
  }
  await setSchedulerSponsor(candidate);
  const cancel = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: executor, isSigner: false, isWritable: true },
      { pubkey: schedulerConfig, isSigner: false, isWritable: false },
      { pubkey: candidateCrank, isSigner: false, isWritable: true },
      { pubkey: EPHEMERAL_VAULT_ID, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: HYDRA_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator('cancel_rebalance'),
  });
  const cancelSignature = await router.sendAndConfirmTransaction(new Transaction().add(cancel), [owner]);
  for (let attempt = 0; attempt < 30 && await host.getAccountInfo(candidateCrank, 'confirmed'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (await host.getAccountInfo(candidateCrank, 'confirmed')) throw new Error('Old Hydra task remained after cancellation.');
  replacedTasks.push({ sponsor: candidate.toBase58(), crank: candidateCrank.toBase58(), interval, cancelSignature });
}
if (!currentTask) {
  await setSchedulerSponsor(cranker.publicKey);
  const metas = [
    { pubkey: new PublicKey('Sysvar1nstructions1111111111111111111111111'), isWritable: false },
    { pubkey: stateAddress, isWritable: false },
    { pubkey: executor, isWritable: true },
    { pubkey: schedulerConfig, isWritable: false },
    { pubkey: crankPolicy, isWritable: false },
    { pubkey: authority, isWritable: false },
    { pubkey: marketAuthority, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false },
    { pubkey: MAGIC_CONTEXT_ID, isWritable: true },
    { pubkey: magicFeeVaultPdaFromValidator(validator), isWritable: true },
    { pubkey: MAGIC_PROGRAM_ID, isWritable: false },
    ...vaultTokens.map((pubkey) => ({ pubkey, isWritable: false })),
    ...marketTokens.map((pubkey) => ({ pubkey, isWritable: false })),
    ...feeds.map((pubkey) => ({ pubkey, isWritable: false })),
  ];
  const callback = discriminator('rebalance_ephemeral');
  const createData = encodeCreate(stateAddress, executor, metas, callback, await host.getSlot('confirmed'));
  const crank = crankFor(cranker.publicKey);
  const createIx = new TransactionInstruction({
    programId: HYDRA_ID,
    keys: [
      { pubkey: cranker.publicKey, isSigner: true, isWritable: true },
      { pubkey: crank, isSigner: false, isWritable: true },
      { pubkey: EPHEMERAL_VAULT_ID, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: createData,
  });
  const createSignature = await router.sendAndConfirmTransaction(new Transaction().add(createIx), [cranker]);
  const crankInfo = await host.getAccountInfo(crank, 'confirmed');
  if (!crankInfo || !crankInfo.owner.equals(HYDRA_ID)) throw new Error('Hydra task account was not created on the ER.');
  const interval = Number(crankInfo.data.readBigUInt64LE(72));
  if (interval !== INTERVAL_SLOTS) throw new Error(`Hydra registered ${interval} slots, expected ${INTERVAL_SLOTS}.`);
  currentTask = { sponsor: cranker.publicKey, crank, interval, createSignature };
} else {
  // A stale legacy crank may have been canceled after the active task was found.
  // Put its sponsor back in the config that the recurring ER callback authenticates.
  await setSchedulerSponsor(currentTask.sponsor);
}

console.log(JSON.stringify({
  vaultState: stateAddress.toBase58(),
  vaultAuthority: authority.toBase58(),
  shareMint: shareMint.toBase58(),
  executor: executor.toBase58(),
  schedulerConfig: schedulerConfig.toBase58(),
  executorDelegated: true,
  sponsor: currentTask.sponsor.toBase58(),
  hydraCrank: currentTask.crank.toBase58(),
  requestedIntervalSlots: INTERVAL_SLOTS,
  registeredIntervalSlots: currentTask.interval,
  targetIntervalSeconds: MIN_INTERVAL_SECONDS,
  scheduleSignature: currentTask.createSignature ?? '',
  marketSetupSignature,
  replacedTasks,
  vaultTokenAccounts: vaultTokens.map((key) => key.toBase58()),
  marketTokenAccounts: marketTokens.map((key) => key.toBase58()),
  note: 'A Hydra cranker must be running on this ER. Slot cadence, cranker delay, fresh prices, and synthetic Devnet market liquidity determine when a Magic Action can settle.',
}, null, 2));

async function setSchedulerSponsor(sponsor) {
  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: schedulerConfig, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('set_scheduler_sponsor'), sponsor.toBuffer()]),
  });
  await sendAndConfirmTransaction(base, new Transaction().add(instruction), [owner]);
}

async function setCrankPolicy(seconds) {
  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: crankPolicy, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('set_crank_policy'), u64(seconds)]),
  });
  await sendAndConfirmTransaction(base, new Transaction().add(instruction), [owner]);
}

function callbackMatches(data, state, executorKey, scheduler, policy) {
  try {
    const length = data.readUInt16LE(112);
    if (!length || data.length < 120 + length) return false;
    const region = data.subarray(120, 120 + length);
    let offset = 0;
    const count = region.readUInt16LE(offset); offset += 2;
    const keys = [];
    for (let index = 0; index < count; index += 1) {
      offset += 1;
      keys.push(new PublicKey(region.subarray(offset, offset + 32)));
      offset += 32;
    }
    const program = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
    const dataLength = region.readUInt16LE(offset); offset += 2;
    const ixData = region.subarray(offset, offset + dataLength);
    return program.equals(PROGRAM_ID) && ixData.subarray(0, 8).equals(discriminator('rebalance_ephemeral')) &&
      keys[1]?.equals(state) && keys[2]?.equals(executorKey) && keys[3]?.equals(scheduler) && keys[4]?.equals(policy);
  } catch { return false; }
}

async function waitDelegation(account) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await router.getDelegationStatus(account);
    if (status.isDelegated && status.fqdn) return status;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`MagicBlock delegation for ${account} did not become available.`);
}

function encodeCreate(seed, authorityKey, metas, callback, currentSlot) {
  // One discriminator byte plus Hydra's 100-byte fixed prefix and its body.
  const data = Buffer.alloc(101 + 35 + 33 * metas.length + callback.length);
  let offset = 0;
  data[offset++] = 0;
  seed.toBuffer().copy(data, offset); offset += 32;
  authorityKey.toBuffer().copy(data, offset); offset += 32;
  u64(BigInt(currentSlot + INTERVAL_SLOTS)).copy(data, offset); offset += 8;
  u64(BigInt(INTERVAL_SLOTS)).copy(data, offset); offset += 8;
  u64(0n).copy(data, offset); offset += 8;
  u64(0n).copy(data, offset); offset += 8;
  data.writeUInt32LE(800_000, offset); offset += 4;
  data.writeUInt8(metas.length, offset++);
  data.writeUInt16LE(callback.length, offset); offset += 2;
  PROGRAM_ID.toBuffer().copy(data, offset); offset += 32;
  for (const meta of metas) {
    data.writeUInt8(meta.isWritable ? 0b10 : 0, offset++);
    meta.pubkey.toBuffer().copy(data, offset); offset += 32;
  }
  callback.copy(data, offset);
  return data;
}
