#!/usr/bin/env node
/** Keep one official MagicBlock Hydra cranker process running per configured ER. */
import { access, constants, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const configPath = process.env.COLONYOND_HYDRA_CRANKER_CONFIG;
const children = new Set();
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    log('service_stopping', { signal });
    for (const child of children) child.kill('SIGTERM');
  });
}

if (process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

if (process.argv.includes('--validate-config')) {
  const config = await loadConfig();
  await access(config.binaryPath, constants.X_OK);
  for (const rollup of config.rollups) await access(rollup.keypairPath, constants.R_OK);
  log('config_validated', { rollups: config.rollups.map(({ name, rpcUrl }) => ({ name, rpcUrl })) });
  process.exit(0);
}

const config = await loadConfig();
await access(config.binaryPath, constants.X_OK);
for (const rollup of config.rollups) await access(rollup.keypairPath, constants.R_OK);

log('service_starting', { rollups: config.rollups.map(({ name, rpcUrl }) => ({ name, rpcUrl })) });
await Promise.all(config.rollups.map(runRollup));

async function loadConfig() {
  if (!configPath || !path.isAbsolute(configPath)) {
    throw new Error('Set COLONYOND_HYDRA_CRANKER_CONFIG to an absolute JSON config path.');
  }
  return parseConfig(await readFile(configPath, 'utf8'));
}

async function runRollup(rollup) {
  const args = crankerArgs(rollup);
  let backoffMs = 1_000;
  while (!stopping) {
    log('cranker_starting', { rollup: rollup.name, rpcUrl: rollup.rpcUrl, ephemeral: true });
    const child = spawn(config.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    streamLines(child.stdout, rollup.name, 'stdout');
    streamLines(child.stderr, rollup.name, 'stderr');
    const code = await new Promise((resolve) => {
      child.once('error', (error) => {
        log('cranker_spawn_error', { rollup: rollup.name, error: error.message });
        resolve(null);
      });
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    children.delete(child);
    if (stopping) break;
    log('cranker_exited', { rollup: rollup.name, result: code, restartInMs: backoffMs });
    await delay(backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

function streamLines(stream, rollup, source) {
  const lines = createInterface({ input: stream });
  lines.on('line', (line) => log('cranker_log', { rollup, source, line }));
}

function parseConfig(value) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error('Hydra cranker config must be valid JSON.'); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Hydra cranker config must be a JSON object.');
  if (typeof parsed.binaryPath !== 'string' || !path.isAbsolute(parsed.binaryPath)) throw new Error('binaryPath must be an absolute path to the official hydra-cranker binary.');
  if (!Array.isArray(parsed.rollups) || parsed.rollups.length === 0) throw new Error('rollups must contain at least one ER endpoint.');
  const names = new Set();
  const endpoints = new Set();
  const signerPaths = new Set();
  const ports = new Set();
  const rollups = parsed.rollups.map((entry, index) => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') throw new Error(`rollups[${index}] must be an object.`);
    const name = requiredString(entry.name, `rollups[${index}].name`);
    const rpcUrl = requiredHttpUrl(entry.rpcUrl, `rollups[${index}].rpcUrl`);
    const baseRpcUrl = requiredHttpUrl(entry.baseRpcUrl, `rollups[${index}].baseRpcUrl`);
    const keypairPath = requiredString(entry.keypairPath, `rollups[${index}].keypairPath`);
    if (!path.isAbsolute(keypairPath)) throw new Error(`rollups[${index}].keypairPath must be absolute.`);
    if (names.has(name)) throw new Error(`Duplicate rollup name: ${name}.`);
    if (endpoints.has(rpcUrl)) throw new Error(`Duplicate ER endpoint: ${rpcUrl}.`);
    if (signerPaths.has(keypairPath)) throw new Error('Use a distinct operator keypair for each ER process.');
    names.add(name); endpoints.add(rpcUrl); signerPaths.add(keypairPath);
    const wsUrl = entry.wsUrl === undefined ? undefined : requiredWsUrl(entry.wsUrl, `rollups[${index}].wsUrl`);
    const metricsPort = entry.metricsPort === undefined ? undefined : Number(entry.metricsPort);
    if (metricsPort !== undefined) {
      if (!Number.isInteger(metricsPort) || metricsPort < 1 || metricsPort > 65_535) throw new Error(`rollups[${index}].metricsPort must be a valid TCP port.`);
      if (ports.has(metricsPort)) throw new Error(`Duplicate metrics port: ${metricsPort}.`);
      ports.add(metricsPort);
    }
    return { name, rpcUrl, baseRpcUrl, keypairPath, wsUrl, metricsPort };
  });
  return { binaryPath: parsed.binaryPath, rollups };
}

function crankerArgs(rollup) {
  const args = ['--keypair', rollup.keypairPath, '--rpc-url', rollup.rpcUrl, '--base-rpc-url', rollup.baseRpcUrl, '--ephemeral'];
  if (rollup.wsUrl) args.push('--ws-url', rollup.wsUrl);
  if (rollup.metricsPort) args.push('--prometheus-port', String(rollup.metricsPort));
  return args;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  if (value.includes('\n') || value.includes('\0')) throw new Error(`${label} contains invalid characters.`);
  return value;
}

function requiredHttpUrl(value, label) {
  const url = new URL(requiredString(value, label));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS.`);
  return url.toString();
}

function requiredWsUrl(value, label) {
  const url = new URL(requiredString(value, label));
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error(`${label} must use WS or WSS.`);
  return url.toString();
}

function log(event, fields = {}) { console.log(JSON.stringify({ event, time: new Date().toISOString(), ...fields })); }

function selfCheck() {
  const config = parseConfig(JSON.stringify({
    binaryPath: '/opt/homebrew/bin/hydra-cranker',
    rollups: [{ name: 'devnet-er-a', rpcUrl: 'https://er.example/', baseRpcUrl: 'https://api.devnet.solana.com', keypairPath: '/keys/a.json', metricsPort: 9101 }],
  }));
  const args = crankerArgs(config.rollups[0]);
  for (const required of ['--keypair', '/keys/a.json', '--rpc-url', '--base-rpc-url', '--ephemeral', '--prometheus-port', '9101']) {
    if (!args.includes(required)) throw new Error(`Missing cranker argument in service self-check: ${required}`);
  }
  let duplicateRejected = false;
  try {
    parseConfig(JSON.stringify({ binaryPath: '/bin/hydra-cranker', rollups: [
      { name: 'a', rpcUrl: 'https://er.example', baseRpcUrl: 'https://api.devnet.solana.com', keypairPath: '/keys/same.json' },
      { name: 'b', rpcUrl: 'https://er2.example', baseRpcUrl: 'https://api.devnet.solana.com', keypairPath: '/keys/same.json' },
    ] }));
  } catch { duplicateRejected = true; }
  if (!duplicateRejected) throw new Error('Duplicate operator-key self-check failed.');
  console.log('Official Hydra cranker fleet self-check passed.');
}

