#!/usr/bin/env node
/** Verify configured Devnet Hydra trigger cycles through base-layer SPL settlement. */
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
const RPC_RETRY_ATTEMPTS = 7;
const RPC_RETRY_BASE_DELAY_MS = 500;
const RPC_RETRY_MAX_DELAY_MS = 5_000;
const RPC_ATTEMPT_TIMEOUT_MS = 15_000;
const SETTLEMENT_POLL_MS = 7_000;

if (process.argv.includes('--self-check')) {
  await selfCheck();
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
const cycleCount = parseCycleCount(process.env.COLONYOND_SMOKE_CYCLES ?? '1');
const requireSettlement = parseRequireSettlement(process.env.COLONYOND_SMOKE_REQUIRE_SETTLEMENT, cycleCount);
const base = new Connection(baseUrl, 'confirmed');
const router = new ConnectionMagicRouter(routerUrl, 'confirmed');
const derive = (seeds, program = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, program)[0];
const executor = derive([EXECUTOR_SEED, state.toBuffer()]);
const schedulerConfig = derive([CONFIG_SEED, state.toBuffer()]);
const crankPolicy = derive([POLICY_SEED, state.toBuffer()]);
const readDeadline = Date.now() + timeoutMs;
const stateInfo = await withRpcRetry(() => base.getAccountInfo(state, 'confirmed'), 'read Vault State', { deadline: readDeadline });
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
const before = await readTokenBalances(base, vaultAccounts, authority, readDeadline);
if (before.some((balance) => balance === null)) throw new Error('One or more vault SPL token accounts are missing.');

const [configInfo, policyInfo] = await Promise.all([
  withRpcRetry(() => base.getAccountInfo(schedulerConfig, 'confirmed'), 'read Scheduler Config', { deadline: readDeadline }),
  withRpcRetry(() => base.getAccountInfo(crankPolicy, 'confirmed'), 'read Crank Policy', { deadline: readDeadline }),
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

const trigger = new TransactionInstruction({
  programId: HYDRA_ID,
  keys: [
    { pubkey: crank, isSigner: false, isWritable: true },
    { pubkey: operator.publicKey, isSigner: true, isWritable: true },
    { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([1]),
});
let nextTask = task;
let cycleSettlements = 0;
const allCycleResults = [];
for (let cycle = 1; cycle <= cycleCount; cycle += 1) {
  const currentSlot = await waitUntilDue(host, nextTask.nextExecSlot, timeoutMs);
  const cycleReadDeadline = Date.now() + timeoutMs;
  const cycleState = await withRpcRetry(() => base.getAccountInfo(state, 'confirmed'), `cycle ${cycle} read Vault State`, { deadline: cycleReadDeadline });
  if (!cycleState?.owner.equals(PROGRAM_ID) || cycleState.data.length < 94) throw new Error(`Cycle ${cycle}: Vault State disappeared or became malformed.`);
  const cycleNonceBefore = cycleState.data.readBigUInt64LE(86);
  const cycleBalancesBefore = await readTokenBalances(base, vaultAccounts, authority, cycleReadDeadline);
  if (cycleBalancesBefore.some((balance) => balance === null)) throw new Error(`Cycle ${cycle}: a vault SPL token account is missing.`);

  const cycleTransaction = new Transaction();
  if (nextTask.computeUnits > 0) cycleTransaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: nextTask.computeUnits }));
  cycleTransaction.add(trigger, nextTask.callback);
  cycleTransaction.feePayer = operator.publicKey;
  const triggerSignature = await router.sendAndConfirmTransaction(cycleTransaction, [operator]);
  console.log(JSON.stringify({ event: 'hydra_trigger_confirmed', cycle, cycles: cycleCount, signature: triggerSignature, explorer: `https://explorer.solana.com/tx/${triggerSignature}?cluster=devnet`, currentSlot }));

  const updatedTask = await waitForTaskAdvance(host, crank, nextTask, timeoutMs);
  assertTaskAdvance(nextTask, updatedTask, 1);
  nextTask = updatedTask;
  const observed = await observeCycleSettlement({ base, stateAddress: state, vaultAccounts, authority, before: cycleBalancesBefore, nonceBefore: cycleNonceBefore, timeoutMs });
  if (observed.settled) cycleSettlements += 1;
  allCycleResults.push({ cycle, triggerSignature, dueSlot: currentSlot, nextExecSlot: nextTask.nextExecSlot, ...observed.summary });
  console.log(JSON.stringify({ event: observed.settled ? 'cycle_settled' : 'cycle_skipped_or_unsettled', cycle, cycles: cycleCount, ...observed.summary }));
}
if (requireSettlement && cycleSettlements === 0) {
  throw new Error('No base-layer settlement with both nonce and SPL balance changes was observed in the requested cycles. Callbacks may safely skip when the minimum delay or Pyth movement guard is not met.');
}
console.log(JSON.stringify({ event: 'closed_loop_smoke_passed', requestedCycles: cycleCount, settledCycles: cycleSettlements, settlementRequired: requireSettlement, initialNonce: nonceBefore.toString(), cycles: allCycleResults }, null, 2));

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

async function readTokenBalances(connection, accounts, authority, deadline = Date.now() + 15_000) {
  const values = [];
  for (const accountAddress of accounts) {
    try {
      const account = await withRpcRetry(() => getAccount(connection, accountAddress, 'confirmed'), `read SPL account ${accountAddress}`, { deadline });
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

function parseCycleCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('COLONYOND_SMOKE_CYCLES must be an integer from 1 through 5.');
  return count;
}

function parseRequireSettlement(value, cycleCount) {
  if (value === undefined) return cycleCount === 1;
  if (value !== 'true' && value !== 'false') throw new Error('COLONYOND_SMOKE_REQUIRE_SETTLEMENT must be true or false.');
  return value === 'true';
}

async function waitUntilDue(host, dueSlot, timeoutMs) {
  let currentSlot = await host.getSlot('confirmed');
  const deadline = Date.now() + timeoutMs;
  while (currentSlot < dueSlot && Date.now() < deadline) {
    await sleep(1_000);
    currentSlot = await host.getSlot('confirmed');
  }
  if (currentSlot < dueSlot) throw new Error(`Smoke timed out waiting for task due slot (${currentSlot}/${dueSlot}).`);
  return currentSlot;
}

async function waitForTaskAdvance(host, crankAddress, previousTask, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await host.getAccountInfo(crankAddress, 'confirmed');
    if (!info || !info.owner.equals(HYDRA_ID)) throw new Error('Hydra task disappeared or has an unexpected owner after trigger.');
    const updated = readTask(info.data, {
      state, executor, schedulerConfig, crankPolicy, expectedIntervalSlots: previousTask.intervalSlots,
    });
    if (updated.nextExecSlot !== previousTask.nextExecSlot) {
      assertTaskAdvance(previousTask, updated, 1);
      return updated;
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for Hydra nextExecSlot to advance from ${previousTask.nextExecSlot}.`);
}

function assertTaskAdvance(previous, current, taskCount = 1) {
  if (!current) throw new Error('Hydra task is missing after trigger.');
  if (taskCount !== 1) throw new Error(`Expected one Hydra task for this vault, found ${taskCount}.`);
  if (current.nextExecSlot <= previous.nextExecSlot) throw new Error('Hydra task schedule is stale and did not advance.');
  const expectedNext = previous.nextExecSlot + previous.intervalSlots;
  if (current.nextExecSlot !== expectedNext) throw new Error(`Hydra task advanced to ${current.nextExecSlot}; expected ${expectedNext}.`);
}

async function observeCycleSettlement({ base, stateAddress, vaultAccounts, authority, before, nonceBefore, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let latestState;
  let latestBalances = before;
  let settlement;
  let observationIncomplete = false;
  while (true) {
    const pauseMs = settlementPollDelay(deadline, Date.now());
    if (pauseMs <= 0) { observationIncomplete = true; break; }
    await sleep(pauseMs);
    // Do not launch RPC reads when the sleep consumed the remaining deadline.
    if (settlementPollDelay(deadline, Date.now()) <= 0) { observationIncomplete = true; break; }

    const [stateResult, balancesResult] = await Promise.allSettled([
      withRpcRetry(() => base.getAccountInfo(stateAddress, 'confirmed'), 'observe Vault State', { deadline }),
      readTokenBalances(base, vaultAccounts, authority, deadline),
    ]);
    for (const result of [stateResult, balancesResult]) {
      if (result.status === 'rejected') {
        if (!isTransientRpcError(result.reason)) throw result.reason;
        observationIncomplete = true;
      }
    }
    if (stateResult.status === 'fulfilled') {
      const stateInfo = stateResult.value;
      if (!stateInfo?.owner.equals(PROGRAM_ID) || stateInfo.data.length < 94) throw new Error('Vault State disappeared or became malformed while observing cycle.');
      latestState = stateInfo;
    }
    if (balancesResult.status === 'fulfilled') {
      if (balancesResult.value.some((balance) => balance === null)) throw new Error('A vault SPL token account disappeared while observing cycle.');
      latestBalances = balancesResult.value;
    }
    if (stateResult.status === 'rejected' || balancesResult.status === 'rejected') {
      if (Date.now() >= deadline) break;
      continue;
    }

    const nonce = latestState.data.readBigUInt64LE(86);
    if (nonce <= nonceBefore || settlement) continue;
    let signatures;
    try {
      signatures = await withRpcRetry(() => base.getSignaturesForAddress(stateAddress, { limit: 20 }, 'confirmed'), 'read settlement signatures', { deadline });
    } catch (error) {
      if (!isTransientRpcError(error)) throw error;
      observationIncomplete = true;
      if (Date.now() >= deadline) break;
      continue;
    }
    for (const candidate of signatures) {
      if (candidate.err) continue;
      let tx;
      try {
        tx = await withRpcRetry(() => base.getTransaction(candidate.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }), `read settlement transaction ${candidate.signature}`, { deadline });
      } catch (error) {
        if (!isTransientRpcError(error)) throw error;
        observationIncomplete = true;
        if (Date.now() >= deadline) break;
        continue;
      }
      const line = tx?.meta?.logMessages?.find((message) => message.includes(`Base-layer SPL rebalance settled atomically: nonce ${nonce}`));
      if (line) { settlement = { signature: candidate.signature, line }; break; }
    }
    if (settlement) break;
    if (Date.now() >= deadline) { observationIncomplete = true; break; }
  }
  const nonceAfter = latestState?.data.readBigUInt64LE(86) ?? nonceBefore;
  const balanceChanged = latestBalances.some((balance, index) => balance !== before[index]);
  if (nonceAfter > nonceBefore && balanceChanged && !settlement) throw new Error('Vault nonce and balances changed, but no successful atomic settlement transaction log was found.');
  if (settlement && !balanceChanged) throw new Error('Settlement nonce advanced, but no vault SPL balance changed.');
  return {
    settled: Boolean(settlement && nonceAfter > nonceBefore && balanceChanged),
    summary: {
      nonceBefore: nonceBefore.toString(), nonceAfter: nonceAfter.toString(),
      observationIncomplete,
      balances: vaultAccounts.map((account, index) => ({ address: account.toBase58(), before: before[index].toString(), after: latestBalances[index].toString() })),
      ...(settlement ? { settlementSignature: settlement.signature, settlementExplorer: `https://explorer.solana.com/tx/${settlement.signature}?cluster=devnet`, settlementLog: settlement.line } : {}),
    },
  };
}

function settlementPollDelay(deadline, now) { return Math.min(SETTLEMENT_POLL_MS, Math.max(0, deadline - now)); }

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

async function withRpcRetry(operation, label, {
  deadline = Date.now() + 15_000,
  maxAttempts = RPC_RETRY_ATTEMPTS,
  baseDelayMs = RPC_RETRY_BASE_DELAY_MS,
  maxDelayMs = RPC_RETRY_MAX_DELAY_MS,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (Date.now() >= deadline) throw rpcRetryDeadlineError(label, attempt - 1, lastError);
    try {
      return await runRpcAttempt(operation, Math.min(RPC_ATTEMPT_TIMEOUT_MS, deadline - Date.now()), label);
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
      if (attempt >= maxAttempts) {
        throw new Error(`${label} failed after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${errorMessage(error)}`, { cause: error });
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw rpcRetryDeadlineError(label, attempt, error);
      const backoffMs = Math.min(baseDelayMs * (2 ** (attempt - 1)), maxDelayMs, remainingMs);
      if (backoffMs > 0) await sleep(backoffMs);
    }
  }
  throw rpcRetryDeadlineError(label, maxAttempts, lastError);
}

async function runRpcAttempt(operation, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${label} RPC attempt timed out.`), { code: 'ETIMEDOUT' })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isTransientRpcError(error) {
  const messages = [];
  for (let current = error; current && messages.length < 4; current = current.cause) {
    if (typeof current.message === 'string') messages.push(current.message);
    const status = current.status ?? current.statusCode ?? current.response?.status;
    if (status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599)) return true;
    const code = String(current.code ?? '').toLowerCase();
    if (/^(econnreset|econnrefused|etimedout|esockettimedout|enotfound|eai_again|ehostunreach|enetunreach|epipe|abort_err)$/.test(code)) return true;
  }
  return /\b429\b|\b5\d\d\b|too many requests|rate.?limit|fetch failed|network error|timed? ?out|socket hang up|connection reset|connection refused|temporarily unavailable|gateway timeout|request aborted/i.test(messages.join(' '));
}

function errorMessage(error) { return error instanceof Error ? error.message : String(error); }

function rpcRetryDeadlineError(label, attempts, cause) {
  return new Error(`${label} exhausted its bounded retry deadline after ${attempts} attempt${attempts === 1 ? '' : 's'}${cause ? `: ${errorMessage(cause)}` : '.'}`, cause ? { cause } : undefined);
}

async function selfCheck() {
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
  assertTaskAdvance({ nextExecSlot: 5_700, intervalSlots: 5_700 }, { nextExecSlot: 11_400 }, 1);
  assertRejects(() => assertTaskAdvance({ nextExecSlot: 5_700, intervalSlots: 5_700 }, null, 1), 'missing task accepted');
  assertRejects(() => assertTaskAdvance({ nextExecSlot: 5_700, intervalSlots: 5_700 }, { nextExecSlot: 11_400 }, 2), 'duplicate task accepted');
  assertRejects(() => assertTaskAdvance({ nextExecSlot: 5_700, intervalSlots: 5_700 }, { nextExecSlot: 5_700 }, 1), 'stale task accepted');
  assertRejects(() => assertTaskAdvance({ nextExecSlot: 5_700, intervalSlots: 5_700 }, { nextExecSlot: 11_401 }, 1), 'incorrect schedule accepted');
  assertRejects(() => parseCycleCount('0'), 'zero cycles accepted');
  assertRejects(() => parseCycleCount('6'), 'more than five cycles accepted');
  assertRejects(() => parseCycleCount('2.5'), 'fractional cycles accepted');
  if (parseCycleCount('1') !== 1 || parseCycleCount('5') !== 5) throw new Error('Cycle count bounds self-check failed.');
  if (parseRequireSettlement(undefined, 1) !== true || parseRequireSettlement(undefined, 2) !== false || parseRequireSettlement('true', 2) !== true || parseRequireSettlement('false', 1) !== false) throw new Error('Settlement requirement default self-check failed.');
  const expiredDeadline = 1_000;
  if (settlementPollDelay(expiredDeadline, expiredDeadline) !== 0 || settlementPollDelay(expiredDeadline, expiredDeadline + 1) !== 0) throw new Error('Expired settlement deadline must start no pending reads.');
  if (settlementPollDelay(15_000, 5_000) !== SETTLEMENT_POLL_MS) throw new Error('Settlement polling interval self-check failed.');
  let attempts = 0;
  const recovered = await withRpcRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('Too Many Requests'), { status: 429 });
    return 'ok';
  }, 'self-check retry success', { deadline: Date.now() + 5_000, baseDelayMs: 0 });
  if (recovered !== 'ok' || attempts !== 2) throw new Error('Transient RPC retry recovery self-check failed.');
  let cappedAttempts = 0;
  await assertRejectsAsync(() => withRpcRetry(async () => {
    cappedAttempts += 1;
    throw Object.assign(new Error('HTTP 503 Service Unavailable'), { status: 503 });
  }, 'self-check retry cap', { deadline: Date.now() + 5_000, maxAttempts: 3, baseDelayMs: 0 }), 'retry cap accepted persistent errors');
  if (cappedAttempts !== 3) throw new Error(`RPC retry attempt cap self-check failed (${cappedAttempts}).`);
  let terminalAttempts = 0;
  await assertRejectsAsync(() => withRpcRetry(async () => {
    terminalAttempts += 1;
    throw Object.assign(new Error('Invalid request'), { status: 400 });
  }, 'self-check terminal error', { deadline: Date.now() + 5_000, baseDelayMs: 0 }), 'permanent RPC error was retried or accepted');
  if (terminalAttempts !== 1) throw new Error(`Permanent RPC error was retried ${terminalAttempts} times.`);
  console.log(JSON.stringify({ event: 'self_check_passed', checks: ['callback-decode', 'policy-and-state-binding', 'interval-check', 'foreign-vault-rejected', 'exact-schedule-advance', 'missing-task-rejected', 'duplicate-task-rejected', 'stale-task-rejected', 'cycle-count-bounds', 'settlement-requirement-mode', 'expired-deadline-no-read', 'lower-volume-settlement-poll', 'transient-rpc-retry-recovers', 'rpc-retry-attempt-cap', 'permanent-rpc-error-terminal'] }));
}

function assertRejects(action, message) {
  let rejected = false;
  try { action(); } catch { rejected = true; }
  if (!rejected) throw new Error(message);
}

async function assertRejectsAsync(action, message) {
  let rejected = false;
  try { await action(); } catch { rejected = true; }
  if (!rejected) throw new Error(message);
}
