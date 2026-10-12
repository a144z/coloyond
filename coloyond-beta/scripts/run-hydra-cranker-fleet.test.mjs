import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { parseConfig, runFleet } from './run-hydra-cranker-fleet.mjs';

async function withHealthServer(handler, run) {
  const server = createServer((request, response) => handler(request, response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try { await run(port); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeConfig(port, overrides = {}) {
  return parseConfig(JSON.stringify({
    binaryPath: '/bin/fake-hydra',
    startupGraceMs: 0,
    healthCheckIntervalMs: 8,
    healthCheckTimeoutMs: 1_000,
    unhealthyThreshold: 2,
    healthyResetMs: 30,
    terminationGraceMs: 20,
    restartMinMs: 8,
    restartMaxMs: 20,
    ...overrides,
    rollups: [{ name: 'test-er', rpcUrl: 'http://127.0.0.1:8899', baseRpcUrl: 'http://127.0.0.1:8898', keypairPath: '/tmp/test-key.json', ...(port ? { metricsPort: port } : {}) }],
  }));
}

function fakeChildren({ onStart } = {}) {
  const children = [];
  let active = 0;
  let maxActive = 0;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      if (child.exitCode !== null || child.signalCode !== null) return false;
      child.signalCode = signal;
      queueMicrotask(() => child.emit('exit', null, signal));
      return true;
    };
    child.once('exit', () => { active -= 1; });
    children.push(child);
    active += 1;
    maxActive = Math.max(active, maxActive);
    onStart?.(child, children.length);
    return child;
  };
  return { children, spawnImpl, get active() { return active; }, get maxActive() { return maxActive; } };
}

function logger() {
  const events = [];
  return { events, logFn: (event, fields) => events.push({ event, ...fields }) };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test('unhealthy startup recovers and stays on the same child while health is sustained', async () => {
  let requestCount = 0;
  await withHealthServer((_request, response) => {
    response.writeHead(requestCount < 1 ? 503 : 200).end();
    requestCount += 1;
  }, async (port) => {
    const fleet = fakeChildren();
    const logs = logger();
    const controller = new AbortController();
    const running = runFleet(makeConfig(port, { unhealthyThreshold: 3 }), { signal: controller.signal, spawnImpl: fleet.spawnImpl, logFn: logs.logFn });
    try {
      await waitFor(() => logs.events.some((entry) => entry.event === 'cranker_health' && entry.status === 'healthy'), 'healthy status');
      await new Promise((resolve) => setTimeout(resolve, 55));
      assert.equal(fleet.children.length, 1, `a transient startup failure must not restart a healthy child: ${JSON.stringify(logs.events)}`);
      assert.ok(logs.events.some((entry) => entry.event === 'cranker_health_recovered'));
    } finally {
      controller.abort();
      await running;
    }
    assert.equal(fleet.active, 0);
  });
});

test('prolonged unhealthy /healthz restarts the child without overlapping processes', async () => {
  await withHealthServer((_request, response) => response.writeHead(503).end(), async (port) => {
    const fleet = fakeChildren();
    const logs = logger();
    const controller = new AbortController();
    const running = runFleet(makeConfig(port), { signal: controller.signal, spawnImpl: fleet.spawnImpl, logFn: logs.logFn });
    await waitFor(() => fleet.children.length >= 2, 'health-driven restart');
    controller.abort();
    await running;
    assert.equal(fleet.maxActive, 1, 'the prior process must exit before replacement starts');
    assert.ok(fleet.children[0].signalCode === 'SIGTERM');
    assert.ok(logs.events.some((entry) => entry.event === 'cranker_health_restart'));
  });
});

test('an exited child is restarted with backoff and shutdown stops the replacement', async () => {
  await withHealthServer((_request, response) => response.writeHead(200).end(), async (port) => {
    const fleet = fakeChildren({ onStart: (_child, count) => {
      if (count === 1) setTimeout(() => _child.emit('exit', 17, null), 5);
    } });
    const controller = new AbortController();
    const running = runFleet(makeConfig(port), { signal: controller.signal, spawnImpl: fleet.spawnImpl, logFn: logger().logFn });
    await waitFor(() => fleet.children.length >= 2, 'process-exit restart');
    controller.abort();
    await running;
    assert.equal(fleet.maxActive, 1);
    assert.equal(fleet.active, 0);
    assert.equal(fleet.children[1].signalCode, 'SIGTERM');
  });
});

test('health request timeout counts as unhealthy and triggers recovery', async () => {
  await withHealthServer((_request, _response) => {}, async (port) => {
    const fleet = fakeChildren();
    const logs = logger();
    const controller = new AbortController();
    const running = runFleet(makeConfig(port, { unhealthyThreshold: 1, healthCheckTimeoutMs: 10 }), {
      signal: controller.signal, spawnImpl: fleet.spawnImpl, logFn: logs.logFn,
    });
    await waitFor(() => fleet.children.length >= 2, 'health timeout restart');
    controller.abort();
    await running;
    assert.ok(logs.events.some((entry) => entry.event === 'cranker_health' && entry.error?.includes('timeout')));
    assert.equal(fleet.maxActive, 1);
  });
});

test('shutdown stops a child even when health monitoring is not configured', async () => {
  const fleet = fakeChildren();
  const controller = new AbortController();
  const running = runFleet(makeConfig(undefined), { signal: controller.signal, spawnImpl: fleet.spawnImpl, logFn: logger().logFn });
  await waitFor(() => fleet.children.length === 1, 'initial child');
  controller.abort();
  await running;
  assert.equal(fleet.children[0].signalCode, 'SIGTERM');
  assert.equal(fleet.active, 0);
});

test('health and restart timing config rejects invalid values', () => {
  assert.throws(() => makeConfig(9101, { unhealthyThreshold: 0 }), /unhealthyThreshold/);
  assert.throws(() => makeConfig(9101, { restartMinMs: -1 }), /restartMinMs/);
});
