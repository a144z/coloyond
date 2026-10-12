#!/usr/bin/env node
/** Verify one configured Devnet vault from Hydra trigger through base-layer SPL settlement. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';

const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const HYDRA_ID = new PublicKey('eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const CALLBACK = Buffer.from([0xeb, 0xf6, 0x7d, 0x55, 0x89, 0x61, 0xde, 0xdf]);
const EXECUTOR_SEED = Buffer.from('executor');
const CONFIG_SEED = Buffer.from('scheduler-config');
const POLICY_SEED = Buffer.from('crank-policy');
const CRANK_SEED = Buffer.from('crank');

if (process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

const state = requiredPublicKey('COLONYOND_SMOKE_VAULT_STATE');
const operatorPath = process.env.COLONYOND_SMOKE_OPERATOR_KEYPAIR ?? 'target/hydra-cranker-devnet.json';
const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(operatorPath, 'utf8'))));
const baseUrl = process.env.COLONYOND_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const routerUrl = process.env.COLONYOND_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const timeoutMs = Number(process.env.COLONYOND_SMOKE_TIMEOUT_MS ?? 240_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
  throw new Error('COLONYOND_SMOKE_TIMEOUT_MS must be 30000..900000.');
}
const base = new Connection(baseUrl, 'confirmed');
const router = new ConnectionMagicRouter(routerUrl, 'confirmed');
const derive = (seeds, program = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, program)[0];
const executor = derive([EXECUTOR_SEED, state.toBuffer()]);
const schedulerConfig = derive([CONFIG_SEED, state.toBuffer()]);
const crankPolicy = derive([POLICY_SEED, state.toBuffer()]);
const stateInfo = await base.getAccountInfo(state, 'confirmed');
if (!stateInfo || !stateInfo.owner.equals(PROGRAM_ID) || stateInfo.data.length < 98) {
  throw new Error('Configured Vault State is missing, malformed, or owned by another program.');
}
const owner = new PublicKey(stateInfo.data.subarray(16, 48));
if (stateInfo.data[80] !== 1) throw new Error('Configured vault is inactive; resume it before running the smoke check.');
const nonceBefore = stateInfo.data.readBigUInt64LE(86);
const count = stateInfo.data.readUInt32LE(94);
if (count < 1 || count > 4 || stateInfo.data.length < 98 + count * 99) throw new Error('Vault State has an invalid asset list.');
const assets = Array.from({ length: count }, (_, index) => ({
  mint: new PublicKey(stateInfo.data.subarray(98 + index * 99, 130 + index * 99)),
}));
const authority = derive([Buffer.from('vault-authority'), state.toBuffer()]);
const vaultAccounts = assets.map(({ mint }) => deriveAssociatedAddress(mint, authority));
const before = await readTokenBalances(base, vaultAccounts, authority);
if (before.some((balance) => balance === null)) throw new Error('One or more vault SPL token accounts are missing.');

const [configInfo, policyInfo] = await Promise.all([
  base.getAccountInfo(schedulerConfig, 'confirmed'),
  base.getAccountInfo(crankPolicy, 'confirmed'),
]);
if (!configInfo || !configInfo.owner.equals(PROGRAM_ID) || configInfo.data.length < 104 ||
    !configInfo.data.subarray(8, 40).equals(state.toBuffer()) || !configInfo.data.subarray(40, 72).equals(owner.toBuffer())) {
  throw new Error('Vault Scheduler Config is missing or does not match the state owner.');
}
if (!policyInfo || !policyInfo.owner.equals(PROGRAM_ID) || policyInfo.data.length < 92 ||
    !policyInfo.data.subarray(8, 40).equals(state.toBuffer()) || !policyInfo.data.subarray(40, 72).equals(owner.toBuffer())) {
  throw new Error('Vault Crank Policy is missing or does not match the state owner.');
}
const minIntervalSeconds = Number(policyInfo.data.readBigUInt64LE(72));
if (!Number.isInteger(minIntervalSeconds) || minIntervalSeconds < 60 || minIntervalSeconds > 86_400) throw new Error('Vault Crank Policy interval is out of range.');
const expectedIntervalSlots = Math.ceil(minIntervalSeconds * 5_700 / 60);
const sponsor = new PublicKey(configInfo.data.subarray(72, 104));
const [executorStatus, sponsorStatus, operatorStatus] = await Promise.all([
  router.getDelegationStatus(executor),
  router.getDelegationStatus(sponsor),
  router.getDelegationStatus(operator.publicKey),
]);
if (!executorStatus.isDelegated || !executorStatus.fqdn) throw new Error('Vault Executor is not delegated to a MagicBlock ER.');
if (!sponsorStatus.isDelegated || sponsorStatus.fqdn !== executorStatus.fqdn) throw new Error('Hydra sponsor and vault Executor are not on the same ER.');
if (!operatorStatus.isDelegated || operatorStatus.fqdn !== executorStatus.fqdn) throw new Error('Smoke operator must be delegated to the vault ER and funded to pay trigger fees.');

const host = new Connection(executorStatus.fqdn, 'confirmed');
const crank = derive([CRANK_SEED, sponsor.toBuffer(), state.toBuffer()], HYDRA_ID);
const crankInfo = await host.getAccountInfo(crank, 'confirmed');
if (!crankInfo || !crankInfo.owner.equals(HYDRA_ID)) throw new Error('Configured Hydra task is missing.');
const task = readTask(crankInfo.data, { state, executor, schedulerConfig, crankPolicy, expectedIntervalSlots });
const balancesBefore = before.map((balance) => balance.toString());
console.log(JSON.stringify({
  event: 'smoke_ready', vaultState: state.toBase58(), owner: owner.toBase58(), operator: operator.publicKey.toBase58(),
  er: executorStatus.fqdn, hydraCrank: crank.toBase58(), nonceBefore: nonceBefore.toString(), minIntervalSeconds,
  intervalSlots: task.intervalSlots, vaultTokenAccounts: vaultAccounts.map((account, index) => ({ address: account.toBase58(), amount: balancesBefore[index] })),
}));

let currentSlot = await host.getSlot('confirmed');
const dueDeadline = Date.now() + timeoutMs;
while (currentSlot < task.nextExecSlot && Date.now() < dueDeadline) {
  await sleep(1_000);
  currentSlot = await host.getSlot('confirmed');
}
if (currentSlot < task.nextExecSlot) throw new Error(`Smoke timed out waiting for task due slot (${currentSlot}/${task.nextExecSlot}).`);

const trigger = new TransactionInstruction({
  programId: HYDRA_ID,
  keys: [
    { pubkey: crank, isSigner: false, isWritable: true },
    { pubkey: operator.publicKey, isSigner: true, isWritable: true },
    { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([1]),
});
const transaction = new Transaction();
if (task.computeUnits > 0) transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: task.computeUnits }));
transaction.add(trigger, task.callback);
transaction.feePayer = operator.publicKey;
const triggerSignature = await router.sendAndConfirmTransaction(transaction, [operator]);
console.log(JSON.stringify({ event: 'hydra_trigger_confirmed', signature: triggerSignature, explorer: `https://explorer.solana.com/tx/${triggerSignature}?cluster=devnet`, currentSlot }));

const settlementDeadline = Date.now() + timeoutMs;
let settledTransaction;
let stateAfter;
while (Date.now() < settlementDeadline) {
  await sleep(2_000);
  const [latestState, signatures] = await Promise.all([
    base.getAccountInfo(state, 'confirmed'),
    base.getSignaturesForAddress(state, { limit: 20 }, 'confirmed'),
  ]);
  if (latestState?.owner.equals(PROGRAM_ID) && latestState.data.length >= 94) {
    stateAfter = latestState;
    if (latestState.data.readBigUInt64LE(86) > nonceBefore) {
      for (const candidate of signatures) {
        if (candidate.err) continue;
        const tx = await base.getTransaction(candidate.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        const line = tx?.meta?.logMessages?.find((message) => message.includes('Base-layer SPL rebalance settled atomically: nonce '));
        if (line) { settledTransaction = { signature: candidate.signature, tx, line }; break; }
      }
      if (settledTransaction) break;
    }
  }
}
if (!settledTransaction || !stateAfter) {
  throw new Error('No base-layer settlement was observed before timeout. The scheduled callback may have safely skipped because the minimum delay or >0.1% Pyth price-movement guard was not met, or the Magic Action/venue did not settle.');
}
const after = await readTokenBalances(base, vaultAccounts, authority);
if (!after.some((balance, index) => balance !== before[index])) throw new Error('Settlement nonce advanced, but no vault SPL balance changed.');
const nonceAfter = stateAfter.data.readBigUInt64LE(86);
console.log(JSON.stringify({
  event: 'closed_loop_smoke_passed', triggerSignature, settlementSignature: settledTransaction.signature,
  settlementExplorer: `https://explorer.solana.com/tx/${settledTransaction.signature}?cluster=devnet`,
  nonceBefore: nonceBefore.toString(), nonceAfter: nonceAfter.toString(),
  vaultTokenAccounts: vaultAccounts.map((account, index) => ({ address: account.toBase58(), before: balancesBefore[index], after: after[index].toString() })),
  settlementLog: settledTransaction.line,
}, null, 2));

function requiredPublicKey(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to an active synthetic Devnet vault before running this live smoke test.`);
  return new PublicKey(value);
}

function deriveAssociatedAddress(mint, authority) {
  const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const associatedProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  return PublicKey.findProgramAddressSync([authority.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], associatedProgram)[0];
}

async function readTokenBalances(connection, accounts, authority) {
  const values = [];
  for (const accountAddress of accounts) {
    try {
      const account = await getAccount(connection, accountAddress, 'confirmed');
      if (!account.owner.equals(authority)) throw new Error(`SPL account ${accountAddress} is not controlled by the vault Authority PDA.`);
      values.push(account.amount);
    } catch (error) {
      if (error?.name === 'TokenAccountNotFoundError') values.push(null);
      else throw error;
    }
  }
  return values;
}

function readTask(data, expected) {
  if (data.length < 120) throw new Error('Hydra task account data is truncated.');
  const nextExecSlot = safeNumber(data.readBigUInt64LE(64), 'next execution slot');
  const intervalSlots = safeNumber(data.readBigUInt64LE(72), 'interval');
  if (intervalSlots !== expected.expectedIntervalSlots) throw new Error(`Task interval is ${intervalSlots}; policy requires ${expected.expectedIntervalSlots}.`);
  const regionLength = data.readUInt16LE(112);
  if (!regionLength || data.length < 120 + regionLength) throw new Error('Hydra callback template is malformed.');
  const callback = decodeInstruction(data.subarray(120, 120 + regionLength));
  const keys = callback.keys.map(({ pubkey }) => pubkey);
  if (!callback.programId.equals(PROGRAM_ID) || !callback.data.subarray(0, 8).equals(CALLBACK) ||
      !keys[1]?.equals(expected.state) || !keys[2]?.equals(expected.executor) ||
      !keys[3]?.equals(expected.schedulerConfig) || !keys[4]?.equals(expected.crankPolicy)) {
    throw new Error('Hydra task callback does not target this vault and its Crank Policy.');
  }
  return { nextExecSlot, intervalSlots, callback, computeUnits: data.readUInt32LE(115) };
}

function decodeInstruction(region) {
  let offset = 0;
  const count = region.readUInt16LE(offset); offset += 2;
  const keys = [];
  for (let index = 0; index < count; index += 1) {
    const flags = region[offset++];
    keys.push({ pubkey: new PublicKey(region.subarray(offset, offset + 32)), isSigner: false, isWritable: (flags & 2) !== 0 });
    offset += 32;
  }
  const programId = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
  const length = region.readUInt16LE(offset); offset += 2;
  if (offset + length !== region.length) throw new Error('Hydra callback data length is invalid.');
  return new TransactionInstruction({ programId, keys, data: region.subarray(offset) });
}

function safeNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Hydra ${label} exceeds the safe integer range.`);
  return number;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function selfCheck() {
  const state = Keypair.generate().publicKey;
  const executor = Keypair.generate().publicKey;
  const schedulerConfig = Keypair.generate().publicKey;
  const crankPolicy = Keypair.generate().publicKey;
  const callback = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [INSTRUCTIONS_SYSVAR, state, executor, schedulerConfig, crankPolicy].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    data: CALLBACK,
  });
  const region = Buffer.alloc(2 + callback.keys.length * 33 + 34 + callback.data.length);
  let offset = 0;
  region.writeUInt16LE(callback.keys.length, offset); offset += 2;
  for (const key of callback.keys) { region[offset++] = 0; key.pubkey.toBuffer().copy(region, offset); offset += 32; }
  callback.programId.toBuffer().copy(region, offset); offset += 32;
  region.writeUInt16LE(callback.data.length, offset); offset += 2;
  callback.data.copy(region, offset);
  const parsed = decodeInstruction(region);
  const taskData = Buffer.alloc(120 + region.length);
  taskData.writeBigUInt64LE(5_700n, 72);
  taskData.writeUInt16LE(region.length, 112);
  taskData.writeUInt32LE(400_000, 115);
  region.copy(taskData, 120);
  const task = readTask(taskData, { state, executor, schedulerConfig, crankPolicy, expectedIntervalSlots: 5_700 });
  if (!parsed.data.equals(CALLBACK) || task.intervalSlots !== 5_700) throw new Error('Closed-loop task parser self-check failed.');
  let rejected = false;
  try { readTask(taskData, { state: Keypair.generate().publicKey, executor, schedulerConfig, crankPolicy, expectedIntervalSlots: 5_700 }); } catch { rejected = true; }
  if (!rejected) throw new Error('Foreign callback self-check failed.');
  console.log(JSON.stringify({ event: 'self_check_passed', checks: ['callback-decode', 'policy-and-state-binding', 'interval-check', 'foreign-vault-rejected'] }));
}
