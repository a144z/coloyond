import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { buildActivateConditionInstruction, buildObserveConditionInstruction, buildProposeConditionRuleInstruction, conditionStateAddress } from "../conditionInstructions.js";
import { PROGRAM_ID } from "../solana.js";
import { SolanaConditionRuntime } from "./solanaRuntime.js";
import { ConditionScheduler, UncertainConditionSubmissionError } from "./service.js";
import type { ConditionConfirmation, ConditionRuntime, ConditionSchedulerResult, ConditionSimulation } from "./service.js";
import { decodeConditionState } from "./state.js";
import type { ConditionSnapshot } from "./scheduler.js";

type Manifest = {
  rpcUrl: string;
  expectedGenesisHash: string;
  programId: string;
  vault: string;
  oraclePublishTime: string;
};

type Outcome = { signature: string; slot: number; logs: string[] };

const DROP_MARKER = "INJECTED_DROP_BEFORE_RPC_SEND";
const UNCERTAIN_MARKER = "INJECTED_RESPONSE_LOSS_AFTER_RPC_SEND";
const scriptPath = process.argv[1] ? resolve(process.argv[1]) : "";

if (scriptPath === resolve(new URL(import.meta.url).pathname)) {
  void runLocalnetLiveness().catch((error: unknown) => {
    console.error(`S3F Localnet liveness failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}

/**
 * Deterministic S3F exercise against the already-deployed Localnet SBF program.
 * The fault hooks control only the two keeper transports; every successful
 * transition is signed and submitted through SolanaConditionRuntime or the
 * permissionless Coloyond instruction builders below.
 */
async function runLocalnetLiveness(): Promise<void> {
  const manifestPath = resolve(process.env.COLOYOND_LOCALNET_MANIFEST ?? "public/localnet-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const runtimeHome = process.env.COLOYOND_LOCALNET_HOME
    ?? resolve(process.env.XDG_STATE_HOME ?? `${homedir()}/.local/state`, "coloyond/localnet");
  const governancePath = process.env.COLOYOND_LOCALNET_WALLET ?? resolve(runtimeHome, "wallet.json");
  const governanceSigner = keypairFromFile(governancePath);
  const rpcA = process.env.COLOYOND_LIVENESS_RPC_A ?? process.env.COLOYOND_LOCALNET_RPC_URL ?? manifest.rpcUrl;
  const rpcB = process.env.COLOYOND_LIVENESS_RPC_B ?? process.env.COLOYOND_LOCALNET_RPC_URL ?? manifest.rpcUrl;
  const genesis = manifest.expectedGenesisHash;
  const vault = new PublicKey(manifest.vault);
  const conditionAddress = conditionStateAddress(vault);
  assert.equal(manifest.programId, PROGRAM_ID.toBase58(), "manifest program ID differs from the pinned Coloyond program");

  const connectionA = new Connection(rpcA, { commitment: "confirmed" });
  const connectionB = new Connection(rpcB, { commitment: "confirmed" });
  assert.equal(await connectionA.getGenesisHash(), genesis, "Keeper A RPC genesis differs from the Localnet manifest");
  assert.equal(await connectionB.getGenesisHash(), genesis, "Keeper B RPC genesis differs from the Localnet manifest");
  const program = await connectionA.getAccountInfo(PROGRAM_ID, "confirmed");
  assert.ok(program?.executable, "pinned Coloyond SBF program is not executable on this Localnet");
  assert.equal((await connectionA.getAccountInfo(vault, "confirmed"))?.owner.toBase58(), PROGRAM_ID.toBase58(), "vault is not owned by the deployed Coloyond program");
  assert.equal(await connectionA.getAccountInfo(conditionAddress, "confirmed"), null, "condition PDA is already initialized; start from a fresh S3E Localnet ledger");

  const keeperA = Keypair.generate();
  const keeperB = Keypair.generate();
  const unrelatedCaller = Keypair.generate();
  const identities = [governanceSigner.publicKey, keeperA.publicKey, keeperB.publicKey, unrelatedCaller.publicKey].map((key) => key.toBase58());
  assert.equal(new Set(identities).size, identities.length, "governance, keeper and unrelated-caller signers must all be distinct");
  await fund(connectionA, keeperA.publicKey);
  await fund(connectionB, keeperB.publicKey);
  await fund(connectionA, unrelatedCaller.publicKey);

  const seedRuntime = new SolanaConditionRuntime({
    cluster: "localnet", rpcUrl: rpcA, expectedGenesisHash: genesis, vaultAddress: vault.toBase58(),
    callerPublicKey: governanceSigner.publicKey.toBase58(), signer: governanceSigner, dryRun: false, maxFeeLamports: 1_000_000n,
  });
  const before = await seedRuntime.readState();
  assert.ok(before.policy?.valid, "Localnet auction policy must be valid before proposing the condition");
  const startSlot = BigInt(await connectionA.getSlot("confirmed"));
  const now = BigInt((await connectionA.getBlockTime(Number(startSlot))) ?? Math.floor(Date.now() / 1_000));
  const maxAge = before.policy.maximumAgeSeconds < 600n ? before.policy.maximumAgeSeconds : 600n;
  assert.ok(maxAge > 0n, "Localnet policy must publish a positive maximum oracle age");
  const proposalIx = buildProposeConditionRuleInstruction(vault, governanceSigner.publicKey, {
    targetBps: [6_000, 4_000],
    expiresAt: now + 900n,
    expiresSlot: startSlot + 20_000n,
    predicate: { kind: "schedule", assetIndex: 0, notBeforeUnixTimestamp: now + 5n, notBeforeSlot: startSlot + 5n },
  }, {
    maximumObservationAgeSeconds: maxAge,
    minimumObservationSeparationSeconds: 1n,
    minimumObservationSeparationSlots: 1n,
    maximumRuleLifetimeSeconds: 1_800n,
    maximumRuleLifetimeSlots: 20_000n,
    maximumScheduleDelaySeconds: 300n,
    maximumScheduleDelaySlots: 1_000n,
    maximumHysteresisBps: 100,
  });
  const proposal = await submitConfirmed(connectionA, governanceSigner, proposalIx);
  const proposedInfo = await connectionA.getAccountInfo(conditionAddress, "confirmed");
  if (!proposedInfo || !proposedInfo.owner.equals(PROGRAM_ID)) throw new Error("governance proposal did not create a program-owned condition PDA");
  const proposed = decodeConditionState(proposedInfo.data);
  const pending = proposed.pending;
  if (!pending) throw new Error("on-chain pending condition proposal is absent");
  log("condition_proposed", { signature: proposal.signature, slot: proposal.slot, nonce: pending.rule.nonce.toString(), activateAfterSlot: pending.activateAfterSlot.toString() });

  const runtimeA = new FaultRuntime(new SolanaConditionRuntime({
    cluster: "localnet", rpcUrl: rpcA, expectedGenesisHash: genesis, vaultAddress: vault.toBase58(),
    callerPublicKey: keeperA.publicKey.toBase58(), signer: keeperA, dryRun: false, maxFeeLamports: 1_000_000n,
  }), { dropFirstSubmission: true });
  const runtimeB = new FaultRuntime(new SolanaConditionRuntime({
    cluster: "localnet", rpcUrl: rpcB, expectedGenesisHash: genesis, vaultAddress: vault.toBase58(),
    callerPublicKey: keeperB.publicKey.toBase58(), signer: keeperB, dryRun: false, maxFeeLamports: 1_000_000n,
  }), { subscriptionUnavailable: true, loseFirstResponse: true, gateSecondRead: true });
  const keeperAEvents = new ResultLog("keeper_a");
  const keeperBEvents = new ResultLog("keeper_b");
  const config = { dryRun: false, maxFeeLamports: 1_000_000n, pollIntervalMs: 1_000 };
  const schedulerA = new ConditionScheduler(config, runtimeA, (event) => keeperAEvents.push(event));
  const schedulerB = new ConditionScheduler(config, runtimeB, (event) => keeperBEvents.push(event));
  const controllerA = new AbortController();
  const controllerB = new AbortController();
  const runA = schedulerA.run(controllerA.signal);
  const runB = schedulerB.run(controllerB.signal);
  try {
    await keeperAEvents.waitFor((event) => event.status === "idle", 10_000);
    await keeperBEvents.waitFor((event) => event.status === "idle", 10_000);
    await runtimeB.waitForGatedRead(10_000);
    const eligibility = await waitForSlot(connectionA, pending.activateAfterSlot);
    log("condition_eligible", { slot: eligibility.slot.toString(), observedAt: new Date(eligibility.observedAt).toISOString() });

    const dropped = await keeperAEvents.waitFor((event) => event.status === "error" && event.reason?.includes(DROP_MARKER) === true, 20_000);
    controllerA.abort();
    await runA;
    log("keeper_a_stopped_after_injected_pre_send_drop", { action: dropped.action?.kind ?? null, chainSubmission: false });

    runtimeB.releaseGatedRead();
    const uncertain = await keeperBEvents.waitFor((event) => event.status === "confirmed" && event.action?.kind === "execute", 45_000);
    controllerB.abort();
    await runB;
    const submittedAt = runtimeB.uncertainSubmissionAt;
    assert.ok(runtimeB.uncertainSignature, "Keeper B did not submit the expected uncertain transaction");
    const submitDelayMs = submittedAt === null ? null : submittedAt - eligibility.observedAt;
    log("keeper_b_recovered_by_poll_and_chain_reconciliation", {
      signature: uncertain.signature ?? runtimeB.uncertainSignature,
      caller: keeperB.publicKey.toBase58(),
      confirmation: "confirmed_from_rpc_state",
      injectedFault: UNCERTAIN_MARKER,
      eligibleToSubmittedMs: submitDelayMs,
    });
  } finally {
    controllerA.abort();
    controllerB.abort();
    runtimeB.releaseGatedRead();
    await Promise.allSettled([runA, runB]);
  }
  log("both_keepers_stopped", { keeperA: keeperA.publicKey.toBase58(), keeperB: keeperB.publicKey.toBase58() });

  const oracleTime = BigInt(manifest.oraclePublishTime);
  await waitForUnixTime(connectionA, oracleTime + 1n);
  const observe = await submitConfirmed(connectionA, unrelatedCaller, buildObserveConditionInstruction(vault));
  const observedInfo = await connectionA.getAccountInfo(conditionAddress, "confirmed");
  if (!observedInfo || !observedInfo.owner.equals(PROGRAM_ID)) throw new Error("condition PDA lost program ownership after observation");
  const observed = decodeConditionState(observedInfo.data);
  assert.equal(observed.activeRule?.pendingActivation, true, "third-party observation did not make the on-chain schedule eligible");
  const nonce = observed.activeRule!.nonce;
  const activate = await submitConfirmed(connectionA, unrelatedCaller, buildActivateConditionInstruction(vault, nonce));
  const afterExternalAction = await seedRuntime.readState();
  assert.deepEqual(afterExternalAction.vault.assets.map((asset) => asset.targetBps), [6_000, 4_000], "unrelated caller did not apply the exact published target on chain");
  assert.equal(afterExternalAction.vault.configurationRevision, before.vault.configurationRevision + 1n, "target revision did not advance exactly once");
  log("unrelated_caller_completed_eligible_sbf_action", {
    caller: unrelatedCaller.publicKey.toBase58(),
    observeSignature: observe.signature,
    activationSignature: activate.signature,
    finalSlot: afterExternalAction.slot.toString(),
    targetBps: afterExternalAction.vault.assets.map((asset) => asset.targetBps),
    configurationRevision: afterExternalAction.vault.configurationRevision.toString(),
    syntheticOracleFixture: true,
  });

  const restarted = new ConditionScheduler(config, runtimeA, (event) => keeperAEvents.push(event));
  const submissionCountBeforeRestart = runtimeA.submissions;
  await restarted.reconcile();
  const reconciled = keeperAEvents.events.at(-1);
  assert.equal(reconciled?.status, "idle", "restarted keeper did not reconstruct the terminal state from RPC");
  assert.equal(runtimeA.submissions, submissionCountBeforeRestart, "restarted keeper attempted to replay an already-consumed condition");
  log("keeper_restart_reconciled_without_replay", { status: reconciled?.status, slot: reconciled?.slot?.toString() ?? null });
  log("limitations", {
    localnetSbf: "verified by confirmed Coloyond program transactions",
    pyth: "synthetic PriceUpdateV2-shaped Localnet fixture; not authenticated",
    rpcIndependence: rpcA === rpcB ? "two distinct clients share one Localnet RPC endpoint" : "distinct configured endpoints on one Localnet validator; not independent operators",
    operatorIndependence: "not proven by this single-process deterministic harness",
    droppedRequest: "injected before RPC send; no network packet-loss claim",
    devnet: "not tested",
  });
}

class FaultRuntime implements ConditionRuntime {
  submissions = 0;
  uncertainSignature: string | null = null;
  uncertainSubmissionAt: number | null = null;
  private readCount = 0;
  private gatedReadResolve: (() => void) | null = null;
  private releaseReadResolve: (() => void) | null = null;
  private readonly gatedRead: Promise<void>;
  private readonly releaseRead: Promise<void>;
  private firstSubmission = true;

  constructor(private readonly inner: ConditionRuntime, private readonly faults: {
    dropFirstSubmission?: boolean;
    loseFirstResponse?: boolean;
    subscriptionUnavailable?: boolean;
    gateSecondRead?: boolean;
  }) {
    this.gatedRead = new Promise((resolve) => { this.gatedReadResolve = resolve; });
    this.releaseRead = new Promise((resolve) => { this.releaseReadResolve = resolve; });
  }

  async readState(): Promise<ConditionSnapshot> {
    this.readCount++;
    if (this.faults.gateSecondRead && this.readCount === 2) {
      this.gatedReadResolve?.();
      await this.releaseRead;
    }
    return this.inner.readState();
  }

  async subscribe(onChange: () => void): Promise<() => Promise<void> | void> {
    if (this.faults.subscriptionUnavailable) throw new Error("INJECTED_WEBSOCKET_SETUP_LOSS; scheduler must continue through bounded polling");
    return this.inner.subscribe(onChange);
  }

  simulate(action: Parameters<ConditionRuntime["simulate"]>[0], snapshot: ConditionSnapshot): Promise<ConditionSimulation> {
    return this.inner.simulate(action, snapshot);
  }

  async submit(action: Parameters<ConditionRuntime["submit"]>[0], snapshot: ConditionSnapshot): Promise<string> {
    this.submissions++;
    if (this.firstSubmission && this.faults.dropFirstSubmission) {
      this.firstSubmission = false;
      throw new Error(`${DROP_MARKER}; retry requires a fresh RPC reconciliation`);
    }
    if (this.firstSubmission && this.faults.loseFirstResponse) {
      this.firstSubmission = false;
      const signature = await this.inner.submit(action, snapshot);
      this.uncertainSignature = signature;
      this.uncertainSubmissionAt = Date.now();
      throw new UncertainConditionSubmissionError(signature, `${UNCERTAIN_MARKER}; signed transaction was sent before the response was hidden`);
    }
    return this.inner.submit(action, snapshot);
  }

  confirm(signature: string): Promise<ConditionConfirmation> { return this.inner.confirm(signature); }
  waitForGatedRead(timeoutMs: number): Promise<void> { return withTimeout(this.gatedRead, timeoutMs, "Keeper B did not reach its scheduled poll"); }
  releaseGatedRead(): void { this.releaseReadResolve?.(); }
}

class ResultLog {
  readonly events: ConditionSchedulerResult[] = [];
  private readonly waiters = new Set<{ predicate: (event: ConditionSchedulerResult) => boolean; resolve: (event: ConditionSchedulerResult) => void; reject: (error: Error) => void }>();

  constructor(private readonly keeper: string) {}

  push(event: ConditionSchedulerResult): void {
    this.events.push(event);
    log(`${this.keeper}_event`, { status: event.status, action: event.action?.kind ?? null, signature: event.signature ?? null, reason: event.reason ?? null, slot: event.slot?.toString() ?? null });
    for (const waiter of this.waiters) {
      if (waiter.predicate(event)) {
        this.waiters.delete(waiter);
        waiter.resolve(event);
      }
    }
  }

  waitFor(predicate: (event: ConditionSchedulerResult) => boolean, timeoutMs: number): Promise<ConditionSchedulerResult> {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return withTimeout(new Promise((resolve, reject) => {
      this.waiters.add({ predicate, resolve, reject });
    }), timeoutMs, `${this.keeper} did not emit the expected scheduler state`);
  }
}

async function submitConfirmed(connection: Connection, signer: Keypair, instruction: TransactionInstruction): Promise<Outcome> {
  const blockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash.blockhash }).add(instruction);
  transaction.partialSign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" });
  const confirmation = await connection.confirmTransaction({ signature, ...blockhash }, "confirmed");
  assert.equal(confirmation.value.err, null, `Localnet transaction failed (${signature}): ${JSON.stringify(confirmation.value.err)}`);
  const transactionInfo = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  assert.ok(transactionInfo, `confirmed transaction details are unavailable for ${signature}`);
  assert.equal(transactionInfo.meta?.err, null, `program transaction failed (${signature})`);
  const logs = transactionInfo.meta?.logMessages ?? [];
  assert.ok(logs.some((line) => line.includes(PROGRAM_ID.toBase58())), `transaction did not invoke the pinned Coloyond program (${signature})`);
  return { signature, slot: transactionInfo.slot, logs };
}

async function fund(connection: Connection, address: PublicKey): Promise<void> {
  const signature = await connection.requestAirdrop(address, 1_000_000_000);
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  assert.equal(confirmation.value.err, null, `Localnet airdrop failed for ${address.toBase58()}`);
  assert.ok((await connection.getBalance(address, "confirmed")) > 0, `Localnet signer ${address.toBase58()} was not funded`);
}

async function waitForSlot(connection: Connection, target: bigint): Promise<{ slot: bigint; observedAt: number }> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const slot = BigInt(await connection.getSlot("confirmed"));
    if (slot >= target) return { slot, observedAt: Date.now() };
    await sleep(100);
  }
  throw new Error(`Localnet did not reach eligible slot ${target} within 120 seconds`);
}

async function waitForUnixTime(connection: Connection, target: bigint): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const slot = await connection.getSlot("confirmed");
    const blockTime = await connection.getBlockTime(slot);
    if (blockTime !== null && BigInt(blockTime) >= target) return;
    await sleep(250);
  }
  throw new Error(`Localnet did not reach synthetic oracle publish time ${target} within 120 seconds`);
}

function keypairFromFile(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function log(event: string, details: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...details }));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
