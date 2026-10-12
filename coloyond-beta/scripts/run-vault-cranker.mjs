#!/usr/bin/env node
/** Run scheduled Hydra tasks for multiple standard-SPL vaults. */
import { readFile } from 'node:fs/promises';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';

const HYDRA_ID = new PublicKey('eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf');
const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const CALLBACK = Buffer.from([0xeb, 0xf6, 0x7d, 0x55, 0x89, 0x61, 0xde, 0xdf]);
const INTERVAL_SLOTS = 5_700;
const ROUTER_RPC = process.env.COLONYOND_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const BASE_RPC = process.env.COLONYOND_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const PROGRAM_SEED = Buffer.from('executor');
const CONFIG_SEED = Buffer.from('scheduler-config');
const CRANK_SEED = Buffer.from('crank');

if (process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

const states = parseStates(process.env.COLONYOND_VAULT_STATES ?? '');
const signerPaths = parseSignerPaths(process.env.COLONYOND_CRANKER_SIGNERS ?? '');
if (!states.length) throw new Error('Set COLONYOND_VAULT_STATES to comma-separated active Vault State PDA addresses.');
for (const state of states) {
  if (!signerPaths[state]) throw new Error(`No signer path configured for vault ${state}.`);
}

const router = new ConnectionMagicRouter(ROUTER_RPC, 'confirmed');
const base = new Connection(BASE_RPC, 'confirmed');
const vaults = [];
for (const stateText of states) {
  try {
    vaults.push(await configureVault(stateText, signerPaths[stateText]));
  } catch (error) {
    log('vault_error', { vaultState: stateText, error: errorText(error), retryInMs: 5_000 });
    vaults.push({ stateText, signerPath: signerPaths[stateText], retryAt: Date.now() + 5_000 });
  }
}

let cursor = 0;
log('watching', { vaultStates: states, intervalSlots: INTERVAL_SLOTS, vaultCount: states.length });
while (true) {
  const now = Date.now();
  let nextWakeMs = 5_000;
  for (let checked = 0; checked < vaults.length; checked += 1) {
    const index = (cursor + checked) % vaults.length;
    let vault = vaults[index];
    if (vault.retryAt && now < vault.retryAt) {
      nextWakeMs = Math.min(nextWakeMs, vault.retryAt - now);
      continue;
    }
    try {
      if (!vault.crank) {
        vault = await configureVault(vault.stateText, vault.signerPath);
        vaults[index] = vault;
      }
      const crankInfo = await vault.host.getAccountInfo(vault.crank, 'confirmed');
      if (!crankInfo || !crankInfo.owner.equals(HYDRA_ID)) throw new Error('Configured Hydra task is missing or has an unexpected owner.');
      const task = readTask(crankInfo.data, vault);
      const currentSlot = await vault.host.getSlot('confirmed');
      if (currentSlot < task.nextExecSlot) continue;

      const trigger = new TransactionInstruction({
        programId: HYDRA_ID,
        keys: [
          { pubkey: vault.crank, isSigner: false, isWritable: true },
          { pubkey: vault.signer.publicKey, isSigner: true, isWritable: true },
          { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]),
      });
      const tx = new Transaction();
      if (task.computeUnits > 0) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: task.computeUnits }));
      tx.add(trigger, task.callback);
      tx.feePayer = vault.signer.publicKey;
      const signature = await router.sendAndConfirmTransaction(tx, [vault.signer]);
      log('triggered', { vaultState: vault.stateText, crank: vault.crank.toBase58(), signature, currentSlot, intervalSlots: task.intervalSlots });
      vault.retryAt = 0;
      nextWakeMs = Math.min(nextWakeMs, 1_000);
    } catch (error) {
      log('vault_error', { vaultState: vault.stateText, error: errorText(error), retryInMs: 3_000 });
      vaults[index] = { ...vault, retryAt: Date.now() + 3_000 };
      nextWakeMs = Math.min(nextWakeMs, 3_000);
    }
  }
  cursor = (cursor + 1) % vaults.length;
  await sleep(Math.max(250, nextWakeMs));
}

async function configureVault(stateText, signerPath) {
  const state = new PublicKey(stateText);
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(signerPath, 'utf8'))));
  const derive = (seeds, programId = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  const executor = derive([PROGRAM_SEED, state.toBuffer()]);
  const schedulerConfig = derive([CONFIG_SEED, state.toBuffer()]);
  const crank = derive([CRANK_SEED, signer.publicKey.toBuffer(), state.toBuffer()], HYDRA_ID);
  const [stateInfo, configInfo] = await Promise.all([
    base.getAccountInfo(state, 'confirmed'),
    base.getAccountInfo(schedulerConfig, 'confirmed'),
  ]);
  if (!stateInfo || !stateInfo.owner.equals(PROGRAM_ID) || stateInfo.data.length < 81) throw new Error('Vault State is missing or malformed.');
  if (stateInfo.data.readUInt8(80) !== 1) throw new Error('Vault is inactive.');
  if (!configInfo || !configInfo.owner.equals(PROGRAM_ID) || configInfo.data.length < 104) throw new Error('Scheduler Config is missing or malformed.');
  if (!configInfo.data.subarray(8, 40).equals(state.toBuffer())) throw new Error('Scheduler Config belongs to a different vault.');
  const owner = new PublicKey(stateInfo.data.subarray(16, 48));
  if (!configInfo.data.subarray(40, 72).equals(owner.toBuffer())) throw new Error('Scheduler Config owner does not match the vault owner.');
  const sponsor = new PublicKey(configInfo.data.subarray(72, 104));
  if (!sponsor.equals(signer.publicKey)) throw new Error('Signer does not match the vault Scheduler Config sponsor.');
  const [executorStatus, sponsorStatus] = await Promise.all([
    router.getDelegationStatus(executor),
    router.getDelegationStatus(sponsor),
  ]);
  if (!executorStatus.isDelegated || !executorStatus.fqdn) throw new Error('Vault Executor is not delegated to an ER.');
  if (!sponsorStatus.isDelegated || sponsorStatus.fqdn !== executorStatus.fqdn) throw new Error('Scheduler sponsor is not delegated to the same ER as the vault Executor.');
  const host = new Connection(executorStatus.fqdn, 'confirmed');
  const crankInfo = await host.getAccountInfo(crank, 'confirmed');
  if (!crankInfo || !crankInfo.owner.equals(HYDRA_ID)) throw new Error('Hydra task is missing or owned by an unexpected program.');
  const vault = { state, stateText, owner, signer, sponsor, executor, schedulerConfig, crank, host, signerPath };
  readTask(crankInfo.data, vault);
  log('vault_ready', { vaultState: stateText, executor: executor.toBase58(), sponsor: sponsor.toBase58(), crank: crank.toBase58(), er: executorStatus.fqdn });
  return vault;
}

function readTask(data, vault) {
  if (data.length < 120) throw new Error('Hydra task template is malformed.');
  const nextExecSlot = safeNumber(data.readBigUInt64LE(64), 'next execution slot');
  const intervalSlots = safeNumber(data.readBigUInt64LE(72), 'interval');
  if (intervalSlots !== INTERVAL_SLOTS) throw new Error(`Expected a ${INTERVAL_SLOTS}-slot task; found ${intervalSlots}.`);
  const regionLength = data.readUInt16LE(112);
  if (regionLength === 0 || data.length < 120 + regionLength) throw new Error('Hydra task callback is malformed.');
  const callback = decodeInstruction(data.subarray(120, 120 + regionLength));
  const keys = callback.keys.map(({ pubkey }) => pubkey);
  if (!callback.programId.equals(PROGRAM_ID) || !callback.data.subarray(0, 8).equals(CALLBACK)
    || !keys[1]?.equals(vault.state) || !keys[2]?.equals(vault.executor) || !keys[3]?.equals(vault.schedulerConfig)) {
    throw new Error('Hydra task is not this vault program’s rebalance callback.');
  }
  return { nextExecSlot, intervalSlots, callback, computeUnits: data.readUInt32LE(115) };
}

function decodeInstruction(region) {
  let offset = 0;
  if (region.length < 2) throw new Error('Hydra callback account list is malformed.');
  const count = region.readUInt16LE(offset); offset += 2;
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 33 > region.length) throw new Error('Hydra callback account list is truncated.');
    const flag = region[offset++];
    const pubkey = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
    keys.push({ pubkey, isSigner: false, isWritable: (flag & 2) !== 0 });
  }
  if (offset + 34 > region.length) throw new Error('Hydra callback program or data length is missing.');
  const programId = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
  const length = region.readUInt16LE(offset); offset += 2;
  if (offset + length !== region.length) throw new Error('Hydra callback data length is invalid.');
  return new TransactionInstruction({ programId, keys, data: region.subarray(offset, offset + length) });
}

function parseStates(value) {
  const entries = value.split(',').map((item) => item.trim()).filter(Boolean);
  const states = entries.map((item) => new PublicKey(item).toBase58());
  if (new Set(states).size !== states.length) throw new Error('COLONYOND_VAULT_STATES contains duplicate addresses.');
  return states;
}

function parseSignerPaths(value) {
  let mapping;
  try { mapping = JSON.parse(value); } catch { throw new Error('COLONYOND_CRANKER_SIGNERS must be a JSON object mapping vault state addresses to signer file paths.'); }
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new Error('COLONYOND_CRANKER_SIGNERS must be a JSON object.');
  return mapping;
}

function safeNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Hydra ${label} exceeds the safe integer range.`);
  return number;
}

function log(event, fields) { console.log(JSON.stringify({ event, time: new Date().toISOString(), ...fields })); }
function errorText(error) { return error instanceof Error ? error.message : String(error); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function selfCheck() {
  const state = Keypair.generate().publicKey;
  const second = Keypair.generate().publicKey;
  const states = parseStates(`${state}, ${second}`);
  if (states.length !== 2 || states[0] !== state.toBase58()) throw new Error('State-list parsing self-check failed.');
  if (parseSignerPaths(`{"${state}":"/tmp/signer.json"}`)[state.toBase58()] !== '/tmp/signer.json') throw new Error('Signer-map parsing self-check failed.');
  const statePk = new PublicKey(states[0]);
  const executor = PublicKey.findProgramAddressSync([PROGRAM_SEED, statePk.toBuffer()], PROGRAM_ID)[0];
  const config = PublicKey.findProgramAddressSync([CONFIG_SEED, statePk.toBuffer()], PROGRAM_ID)[0];
  const callback = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [INSTRUCTIONS_SYSVAR, statePk, executor, config].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    data: CALLBACK,
  });
  const vault = { state: statePk, executor, schedulerConfig: config };
  const taskData = encodeTaskData(callback);
  const task = readTask(taskData, vault);
  if (task.intervalSlots !== INTERVAL_SLOTS) throw new Error('Valid task self-check failed.');
  const wrongVault = { ...vault, state: second };
  let rejected = false;
  try { readTask(taskData, wrongVault); } catch { rejected = true; }
  if (!rejected) throw new Error('Foreign task filter self-check failed.');
  log('self_check_passed', { checks: ['vault-list-parsing', 'signer-map-parsing', 'valid-task', 'foreign-task-rejected'] });
}

function encodeTaskData(callback) {
  const region = Buffer.alloc(2 + 33 * callback.keys.length + 34 + callback.data.length);
  let offset = 0;
  region.writeUInt16LE(callback.keys.length, offset); offset += 2;
  for (const key of callback.keys) {
    region[offset++] = key.isWritable ? 2 : 0;
    key.pubkey.toBuffer().copy(region, offset); offset += 32;
  }
  callback.programId.toBuffer().copy(region, offset); offset += 32;
  region.writeUInt16LE(callback.data.length, offset); offset += 2;
  callback.data.copy(region, offset);
  const data = Buffer.alloc(120 + region.length);
  data.writeBigUInt64LE(1234n, 64);
  data.writeBigUInt64LE(BigInt(INTERVAL_SLOTS), 72);
  data.writeUInt16LE(region.length, 112);
  data.writeUInt32LE(400_000, 115);
  region.copy(data, 120);
  return data;
}
