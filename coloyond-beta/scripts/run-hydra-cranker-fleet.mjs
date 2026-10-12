#!/usr/bin/env node
/** Keep one official MagicBlock Hydra cranker process running per configured ER. */
import { access, constants, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultConfigPath = path.join(projectDir, 'target', 'hydra-cranker-fleet.json');

export function resolveConfigPath(override) {
  if (override === undefined) return defaultConfigPath;
  if (!path.isAbsolute(override)) throw new Error('COLONYOND_HYDRA_CRANKER_CONFIG must be an absolute JSON config path.');
  return override;
}

export function parseConfig(value) {
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
  const health = {
    startupGraceMs: positiveInteger(parsed.startupGraceMs, 30_000, 'startupGraceMs', true),
    intervalMs: positiveInteger(parsed.healthCheckIntervalMs, 10_000, 'healthCheckIntervalMs'),
    timeoutMs: positiveInteger(parsed.healthCheckTimeoutMs, 3_000, 'healthCheckTimeoutMs'),
    unhealthyThreshold: positiveInteger(parsed.unhealthyThreshold, 3, 'unhealthyThreshold'),
    healthyResetMs: positiveInteger(parsed.healthyResetMs, 60_000, 'healthyResetMs'),
    terminationGraceMs: positiveInteger(parsed.terminationGraceMs, 5_000, 'terminationGraceMs'),
    restartMinMs: positiveInteger(parsed.restartMinMs, 1_000, 'restartMinMs'),
    restartMaxMs: positiveInteger(parsed.restartMaxMs, 30_000, 'restartMaxMs'),
  };
  if (health.restartMaxMs < health.restartMinMs) throw new Error('restartMaxMs must be at least restartMinMs.');
  return {
    binaryPath: parsed.binaryPath,
    rollups,
    health,
  };
}

export function crankerArgs(rollup) {
  const args = ['--keypair', rollup.keypairPath, '--rpc-url', rollup.rpcUrl, '--base-rpc-url', rollup.baseRpcUrl, '--ephemeral'];
  if (rollup.wsUrl) args.push('--ws-url', rollup.wsUrl);
  if (rollup.metricsPort) args.push('--prometheus-port', String(rollup.metricsPort));
  return args;
}

/** Run one process per ER, restarting on exit or sustained /healthz failure. */
export async function runFleet(config, {
  signal,
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  logFn = log,
} = {}) {
  await Promise.all(config.rollups.map((rollup) => runRollup(rollup, config, { signal, spawnImpl, fetchImpl, logFn })));
}

async function runRollup(rollup, config, deps) {
  const { signal, spawnImpl, fetchImpl, logFn } = deps;
  const args = crankerArgs(rollup);
  const healthUrl = rollup.metricsPort ? `http://127.0.0.1:${rollup.metricsPort}/healthz` : undefined;
  let backoffMs = config.health.restartMinMs;
  while (!signal?.aborted) {
    let child;
    try {
      logFn('cranker_starting', { rollup: rollup.name, rpcUrl: rollup.rpcUrl, ephemeral: true });
      child = spawnImpl(config.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      logFn('cranker_spawn_error', { rollup: rollup.name, error: error.message });
      if (await waitBeforeRestart(backoffMs, signal)) break;
      backoffMs = Math.min(backoffMs * 2, config.health.restartMaxMs);
      continue;
    }

    streamLines(child.stdout, rollup.name, 'stdout', logFn);
    streamLines(child.stderr, rollup.name, 'stderr', logFn);
    const exitPromise = waitForChildExit(child, logFn, rollup.name);
    const healthAbort = new AbortController();
    const onStop = () => healthAbort.abort();
    signal?.addEventListener('abort', onStop, { once: true });
    let outcome;
    const healthPromise = healthUrl
      ? monitorHealth(healthUrl, rollup.name, config.health, { signal: healthAbort.signal, fetchImpl, logFn,
        onSustainedHealthy: () => { backoffMs = config.health.restartMinMs; },
      }).then((reason) => ({ type: reason ? 'unhealthy' : 'stopped', reason }))
      : new Promise(() => {});
    let onFleetStop;
    const stopPromise = signal?.aborted
      ? Promise.resolve({ type: 'stopped' })
      : signal
      ? new Promise((resolve) => {
        onFleetStop = () => resolve({ type: 'stopped' });
        signal.addEventListener('abort', onFleetStop, { once: true });
      })
      : new Promise(() => {});
    try {
      outcome = await Promise.race([
        exitPromise.then((exit) => ({ type: 'exit', exit })),
        healthPromise,
        stopPromise,
      ]);
    } finally {
      healthAbort.abort();
      signal?.removeEventListener('abort', onStop);
      if (onFleetStop) signal?.removeEventListener('abort', onFleetStop);
    }

    if (outcome.type === 'unhealthy' || signal?.aborted) {
      if (outcome.type === 'unhealthy') logFn('cranker_health_restart', { rollup: rollup.name, reason: outcome.reason });
      await terminateChild(child, exitPromise, config.health.terminationGraceMs);
    }
    const exit = await exitPromise;
    logFn('cranker_exited', { rollup: rollup.name, result: exit, restartInMs: signal?.aborted ? undefined : backoffMs });
    if (signal?.aborted) break;
    if (await waitBeforeRestart(backoffMs, signal)) break;
    backoffMs = Math.min(backoffMs * 2, config.health.restartMaxMs);
  }
}

async function monitorHealth(url, rollup, options, { signal, fetchImpl, logFn, onSustainedHealthy }) {
  if (options.startupGraceMs && await abortableDelay(options.startupGraceMs, signal)) return undefined;
  let consecutiveFailures = 0;
  let healthySince;
  let healthyReset = false;
  while (!signal.aborted) {
    const result = await getHealth(url, options.timeoutMs, fetchImpl);
    if (signal.aborted) return undefined;
    if (result.ok) {
      consecutiveFailures = 0;
      healthySince ??= Date.now();
      if (!healthyReset && Date.now() - healthySince >= options.healthyResetMs) {
        healthyReset = true;
        onSustainedHealthy();
        logFn('cranker_health_recovered', { rollup, healthyForMs: Date.now() - healthySince });
      }
      logFn('cranker_health', { rollup, status: 'healthy', statusCode: result.status });
    } else {
      healthySince = undefined;
      healthyReset = false;
      consecutiveFailures += 1;
      logFn('cranker_health', { rollup, status: 'unhealthy', statusCode: result.status, error: result.error, consecutiveFailures });
      if (consecutiveFailures >= options.unhealthyThreshold) {
        return `healthz failed ${consecutiveFailures} consecutive checks${result.status ? ` (HTTP ${result.status})` : ` (${result.error})`}`;
      }
    }
    if (await abortableDelay(options.intervalMs, signal)) break;
  }
  return undefined;
}

async function getHealth(url, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    return { ok: response.status === 200, status: response.status };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function waitForChildExit(child, logFn, rollup) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    child.once('error', (error) => {
      logFn('cranker_spawn_error', { rollup, error: error.message });
      done({ exitCode: null, signal: null, error: error.message });
    });
    child.once('exit', (exitCode, signal) => done({ exitCode, signal }));
  });
}

async function terminateChild(child, exitPromise, graceMs) {
  if (child.exitCode !== null || child.signalCode !== null) return exitPromise;
  child.kill('SIGTERM');
  const exited = await Promise.race([exitPromise.then(() => true), delay(graceMs).then(() => false)]);
  if (!exited) child.kill('SIGKILL');
  return exitPromise;
}

async function waitBeforeRestart(ms, signal) {
  return abortableDelay(ms, signal);
}

async function abortableDelay(ms, signal) {
  if (signal?.aborted) return true;
  if (!signal) { await delay(ms); return false; }
  let listener;
  const aborted = new Promise((resolve) => {
    listener = () => resolve(true);
    signal.addEventListener('abort', listener, { once: true });
  });
  const result = await Promise.race([delay(ms).then(() => false), aborted]);
  signal.removeEventListener('abort', listener);
  return result;
}

function streamLines(stream, rollup, source, logFn) {
  if (!stream) return;
  const lines = createInterface({ input: stream });
  lines.on('line', (line) => logFn('cranker_log', { rollup, source, line }));
}

function positiveInteger(value, fallback, label, allowZero = false) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < (allowZero ? 0 : 1)) throw new Error(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} integer.`);
  return result;
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
  if (resolveConfigPath(undefined) !== defaultConfigPath) throw new Error('Default config path self-check failed.');
  if (resolveConfigPath('/tmp/crankers.json') !== '/tmp/crankers.json') throw new Error('Config override self-check failed.');
  let relativeOverrideRejected = false;
  try { resolveConfigPath('crankers.json'); } catch { relativeOverrideRejected = true; }
  if (!relativeOverrideRejected) throw new Error('Relative config override self-check failed.');

  const config = parseConfig(JSON.stringify({
    binaryPath: '/opt/homebrew/bin/hydra-cranker',
    rollups: [{ name: 'devnet-er-a', rpcUrl: 'https://er.example/', baseRpcUrl: 'https://api.devnet.solana.com', keypairPath: '/keys/a.json', metricsPort: 9101 }],
  }));
  const args = crankerArgs(config.rollups[0]);
  for (const required of ['--keypair', '/keys/a.json', '--rpc-url', '--base-rpc-url', '--ephemeral', '--prometheus-port', '9101']) {
    if (!args.includes(required)) throw new Error(`Missing cranker argument in service self-check: ${required}`);
  }
  if (config.health.unhealthyThreshold !== 3) throw new Error('Health defaults self-check failed.');
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

async function main() {
  if (process.argv.includes('--self-check')) { selfCheck(); return; }
  const config = parseConfig(await readFile(resolveConfigPath(process.env.COLONYOND_HYDRA_CRANKER_CONFIG), 'utf8'));
  await access(config.binaryPath, constants.X_OK);
  for (const rollup of config.rollups) await access(rollup.keypairPath, constants.R_OK);
  log('service_starting', { rollups: config.rollups.map(({ name, rpcUrl, metricsPort }) => ({ name, rpcUrl, metricsPort })) });
  const shutdown = new AbortController();
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      log('service_stopping', { signal });
      shutdown.abort();
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try { await runFleet(config, { signal: shutdown.signal }); }
  finally { for (const [signal, handler] of handlers) process.off(signal, handler); }
}

if (process.argv.includes('--validate-config')) {
  const config = parseConfig(await readFile(resolveConfigPath(process.env.COLONYOND_HYDRA_CRANKER_CONFIG), 'utf8'));
  await access(config.binaryPath, constants.X_OK);
  for (const rollup of config.rollups) await access(rollup.keypairPath, constants.R_OK);
  log('config_validated', { rollups: config.rollups.map(({ name, rpcUrl }) => ({ name, rpcUrl })) });
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
