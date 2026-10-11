import { actionApplied, actionKey, actionStillCurrent, selectEligibleAction } from "./selector.js";
import type { ActionProposalSource, ActionResult, ChainSnapshot, KeeperAction, KeeperConfig } from "./types.js";

export type SimulationResult = { ok: boolean; feeLamports: bigint | null; reason?: string };
export type ConfirmationResult = { status: "confirmed" | "failed" | "unknown"; reason?: string };

export interface KeeperRuntime {
  readState(): Promise<ChainSnapshot>;
  subscribe(onChange: () => void): Promise<() => Promise<void> | void>;
  simulate(action: KeeperAction, snapshot: ChainSnapshot): Promise<SimulationResult>;
  submit(action: KeeperAction, snapshot: ChainSnapshot): Promise<string>;
  confirm(signature: string): Promise<ConfirmationResult>;
}

export type KeeperObserver = (result: ActionResult | { status: "error"; reason: string }) => void;

type Pending = { action: KeeperAction; before: ChainSnapshot; signature: string };

export class KeeperService {
  private readonly dryRun: boolean;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private inFlight: Promise<void> | null = null;
  private dirty = false;
  private pending = new Map<string, Pending>();

  constructor(
    private readonly config: KeeperConfig,
    private readonly runtime: KeeperRuntime,
    private readonly proposals: ActionProposalSource = {},
    private readonly observe: KeeperObserver = () => {},
  ) {
    this.dryRun = config.dryRun ?? true;
    this.maxRetries = config.maxRetries ?? 2;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 250;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? 2_000;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 4) throw new Error("maxRetries must be an integer from 0 to 4");
    if (this.dryRun === false && (!config.maxFeeLamports || config.maxFeeLamports <= 0n)) throw new Error("Submitting requires a positive explicit maxFeeLamports");
  }

  async reconcile(): Promise<void> {
    this.dirty = true;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      while (this.dirty) {
        this.dirty = false;
        try { await this.reconcileOnce(); }
        catch (error) { this.emit({ status: "error", reason: safeError(error) }); }
      }
    })();
    try { await this.inFlight; }
    finally { this.inFlight = null; }
  }

  async run(signal: AbortSignal): Promise<void> {
    const pollMs = this.config.pollIntervalMs ?? 15_000;
    if (!Number.isInteger(pollMs) || pollMs < 1_000 || pollMs > 300_000) throw new Error("pollIntervalMs must be between 1000 and 300000");
    await this.reconcile();
    const unsubscribe = await this.runtime.subscribe(() => { void this.reconcile(); });
    let timer: NodeJS.Timeout | undefined;
    const stopPolling = (): void => { if (timer) clearTimeout(timer); };
    const poll = (): void => {
      if (signal.aborted) return;
      timer = setTimeout(() => { void this.reconcile().finally(poll); }, pollMs);
    };
    poll();
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    stopPolling();
    await unsubscribe();
  }

  private async reconcileOnce(): Promise<void> {
    const snapshot = await this.runtime.readState();
    for (const [key, pending] of this.pending) {
      const status = await this.runtime.confirm(pending.signature);
      const after = await this.runtime.readState();
      if (status.status === "confirmed" && after.vault.sequence > pending.before.vault.sequence) {
        this.pending.delete(key);
        this.emit({ status: "confirmed", action: pending.action, signature: pending.signature, sequence: after.vault.sequence, slot: after.slot });
        return;
      }
      if (actionApplied(pending.action, pending.before, after)) {
        this.pending.delete(key);
        this.emit({ status: "stale", reason: "Chain advanced while this signature remained unconfirmed; no duplicate was sent", slot: after.slot });
        return;
      }
      if (status.status === "failed") {
        this.pending.delete(key);
        this.dirty = true;
        return;
      }
      if (actionStillCurrent(pending.action, after)) {
        this.emit({ status: "pending", action: pending.action, signature: pending.signature, slot: after.slot });
        return;
      }
      this.pending.delete(key);
      this.emit({ status: "stale", reason: "A different chain transition superseded the pending candidate", slot: after.slot });
      return;
    }
    const selected = await selectEligibleAction(snapshot, this.proposals);
    if (!selected.action) {
      this.emit({ status: "idle", reason: selected.reason, slot: snapshot.slot });
      return;
    }
    const action = selected.action;
    const key = actionKey(action, snapshot.vaultAddress);
    if (this.pending.has(key)) return;
    await this.executeWithRetries(action, snapshot, key);
  }

  private async executeWithRetries(action: KeeperAction, first: ChainSnapshot, key: string): Promise<void> {
    let before = first;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await delay(backoffMs(attempt - 1, this.retryBaseDelayMs, this.retryMaxDelayMs));
      before = await this.runtime.readState();
      if (!actionStillCurrent(action, before)) {
        this.emit({ status: "stale", reason: "Chain sequence or intent changed before simulation/retry; candidate discarded", slot: before.slot });
        return;
      }
      const simulation = await this.runtime.simulate(action, before);
      if (!simulation.ok) {
        this.emit({ status: "rejected", action, reason: simulation.reason ?? "S2D simulation rejected candidate", slot: before.slot });
        return;
      }
      const feeCap = this.config.maxFeeLamports;
      if (feeCap !== undefined && simulation.feeLamports !== null && simulation.feeLamports > feeCap) {
        this.emit({ status: "rejected", action, reason: `Estimated network fee exceeds configured ${feeCap} lamport cap`, slot: before.slot });
        return;
      }
      if (this.dryRun) {
        this.emit({ status: "simulated", action, feeLamports: simulation.feeLamports, slot: before.slot });
        return;
      }
      if (simulation.feeLamports === null || feeCap === undefined) {
        this.emit({ status: "rejected", action, reason: "Submission requires an estimated fee and explicit fee cap", slot: before.slot });
        return;
      }
      const afterSimulation = await this.runtime.readState();
      if (!actionStillCurrent(action, afterSimulation)) {
        this.emit({ status: "stale", reason: "Chain sequence or intent changed after simulation", slot: afterSimulation.slot });
        return;
      }
      before = afterSimulation;
      let signature: string;
      try { signature = await this.runtime.submit(action, before); }
      catch (error) {
        const afterSend = await this.runtime.readState();
        const reason = actionStillCurrent(action, afterSend)
          ? `Submission outcome is unknown; will reconcile before any retry: ${safeError(error)}`
          : "Chain sequence changed while submit RPC outcome was unknown; candidate discarded";
        this.emit({ status: "stale", reason, slot: afterSend.slot });
        return;
      }
      // Record the known signature before any reporting callback or further RPC can fail.
      this.pending.set(key, { action, before, signature });
      this.emit({ status: "submitted", action, signature, slot: before.slot });
      const confirmation = await this.runtime.confirm(signature);
      const after = await this.runtime.readState();
      if (confirmation.status === "confirmed" && after.vault.sequence > before.vault.sequence) {
        this.pending.delete(key);
        this.emit({ status: "confirmed", action, signature, sequence: after.vault.sequence, slot: after.slot });
        return;
      }
      if (actionApplied(action, before, after)) {
        this.pending.delete(key);
        this.emit({ status: "stale", reason: "Chain advanced while this signature remains uncertain; no duplicate was sent", slot: after.slot });
        return;
      }
      if (confirmation.status === "unknown" || confirmation.status === "confirmed") {
        this.emit({ status: "pending", action, signature, slot: after.slot });
        return;
      }
      this.pending.delete(key);
      if (!actionStillCurrent(action, after)) {
        this.emit({ status: "stale", reason: "Chain sequence changed after a failed transaction; candidate discarded", slot: after.slot });
        return;
      }
      if (attempt === this.maxRetries) {
        this.emit({ status: "rejected", action, reason: confirmation.reason ?? "Transaction failed after bounded retry budget", slot: after.slot });
      }
    }
  }

  private emit(result: ActionResult | { status: "error"; reason: string }): void {
    try { this.observe(result); } catch { /* Reporting failures cannot interrupt transaction reconciliation. */ }
  }
}

export function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  if (!Number.isInteger(attempt) || attempt < 0 || baseMs < 0 || maxMs < baseMs) throw new Error("Invalid retry delay bounds");
  return Math.min(maxMs, baseMs * (2 ** attempt));
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeError(error: unknown): string { return error instanceof Error ? error.message : "Unknown keeper runtime error"; }
