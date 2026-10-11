import { conditionActionApplied, conditionActionStillCurrent, selectConditionActions } from "./scheduler.js";
import type { ConditionAction, ConditionSnapshot } from "./scheduler.js";

export type ConditionSimulation = { ok: boolean; feeLamports: bigint | null; reason?: string };
export type ConditionConfirmation = { status: "confirmed" | "failed" | "unknown"; reason?: string };

export interface ConditionRuntime {
  readState(): Promise<ConditionSnapshot>;
  subscribe(onChange: () => void): Promise<() => Promise<void> | void>;
  simulate(action: ConditionAction, snapshot: ConditionSnapshot): Promise<ConditionSimulation>;
  submit(action: ConditionAction, snapshot: ConditionSnapshot): Promise<string>;
  confirm(signature: string): Promise<ConditionConfirmation>;
}

export type ConditionSchedulerConfig = {
  dryRun?: boolean;
  maxFeeLamports?: bigint;
  pollIntervalMs?: number;
};

export type ConditionSchedulerResult =
  | { status: "idle" | "stale" | "rejected" | "simulated" | "submitted" | "confirmed" | "observed" | "pending" | "error"; reason?: string; action?: ConditionAction; signature?: string; feeLamports?: bigint | null; slot?: bigint };

export type ConditionSchedulerObserver = (result: ConditionSchedulerResult) => void;

export class UncertainConditionSubmissionError extends Error {
  constructor(readonly signature: string, message: string) { super(message); this.name = "UncertainConditionSubmissionError"; }
}

type Pending = { action: ConditionAction; before: ConditionSnapshot; signature: string };

export class ConditionScheduler {
  private readonly dryRun: boolean;
  private inFlight: Promise<void> | null = null;
  private dirty = false;
  private pending: Pending | null = null;

  constructor(
    private readonly config: ConditionSchedulerConfig,
    private readonly runtime: ConditionRuntime,
    private readonly observe: ConditionSchedulerObserver = () => {},
  ) {
    this.dryRun = config.dryRun ?? true;
    if (!this.dryRun && (!config.maxFeeLamports || config.maxFeeLamports <= 0n)) throw new Error("Condition submission requires an explicit positive fee cap");
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
    let unsubscribe: () => Promise<void> | void = () => {};
    try { unsubscribe = await this.runtime.subscribe(() => { void this.reconcile(); }); }
    catch (error) { this.emit({ status: "error", reason: `Account subscription unavailable; periodic chain reconciliation remains active: ${safeError(error)}` }); }
    let timer: NodeJS.Timeout | undefined;
    const poll = (): void => {
      if (signal.aborted) return;
      timer = setTimeout(() => { void this.reconcile().finally(poll); }, pollMs);
    };
    poll();
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    if (timer) clearTimeout(timer);
    await unsubscribe();
  }

  private async reconcileOnce(): Promise<void> {
    if (this.pending) {
      const pending = this.pending;
      const confirmation = await this.runtime.confirm(pending.signature);
      const after = await this.runtime.readState();
      if (conditionActionApplied(pending.action, pending.before, after)) {
        this.pending = null;
        if (confirmation.status === "confirmed") {
          this.emit({ status: "confirmed", action: pending.action, signature: pending.signature, slot: after.slot });
        } else if (confirmation.status === "failed") {
          this.emit({ status: "rejected", action: pending.action, signature: pending.signature, reason: `${confirmation.reason ?? "Condition transaction failed"}; matching action is visible on-chain, but this signature did not apply it`, slot: after.slot });
        } else {
          this.emit({ status: "observed", action: pending.action, signature: pending.signature, reason: "Matching action is visible on-chain, but this signature remains unconfirmed; attribution is unknown", slot: after.slot });
        }
        return;
      }
      if (confirmation.status === "failed") {
        this.pending = null;
        this.emit({ status: "rejected", action: pending.action, signature: pending.signature, reason: confirmation.reason ?? "Condition transaction failed", slot: after.slot });
        return;
      }
      if (conditionActionStillCurrent(pending.action, after)) {
        this.emit({ status: "pending", action: pending.action, signature: pending.signature, reason: confirmation.reason, slot: after.slot });
        return;
      }
      this.pending = null;
      this.emit({ status: "stale", action: pending.action, signature: pending.signature, reason: "Chain state changed while the transaction result was uncertain", slot: after.slot });
      return;
    }

    const snapshot = await this.runtime.readState();
    const selection = selectConditionActions(snapshot);
    if (selection.actions.length === 0) {
      this.emit({ status: "idle", reason: selection.reason, slot: snapshot.slot });
      return;
    }

    let selected: ConditionAction | null = null;
    let feeLamports: bigint | null = null;
    let simulationReason: string | undefined;
    for (const candidate of selection.actions) {
      const simulation = await this.runtime.simulate(candidate, snapshot);
      if (!simulation.ok) { simulationReason = simulation.reason; continue; }
      selected = candidate;
      feeLamports = simulation.feeLamports;
      break;
    }
    if (!selected) {
      this.emit({ status: "rejected", action: selection.actions[0], reason: simulationReason ?? "No condition transaction passed simulation", slot: snapshot.slot });
      return;
    }
    if (this.dryRun) {
      this.emit({ status: "simulated", action: selected, feeLamports, slot: snapshot.slot });
      return;
    }
    if (feeLamports === null || this.config.maxFeeLamports === undefined) {
      this.emit({ status: "rejected", action: selected, reason: "Submission requires an estimated fee and explicit fee cap", slot: snapshot.slot });
      return;
    }
    if (feeLamports > this.config.maxFeeLamports) {
      this.emit({ status: "rejected", action: selected, reason: "Estimated network fee exceeds configured fee cap", slot: snapshot.slot });
      return;
    }

    const beforeSend = await this.runtime.readState();
    if (!conditionActionStillCurrent(selected, beforeSend)) {
      this.emit({ status: "stale", action: selected, reason: "On-chain condition sequence, nonce, revision, or readiness changed after simulation", slot: beforeSend.slot });
      return;
    }
    try {
      const signature = await this.runtime.submit(selected, beforeSend);
      this.emit({ status: "submitted", action: selected, signature, slot: beforeSend.slot });
      await this.finishSubmission(selected, beforeSend, signature);
    } catch (error) {
      if (error instanceof UncertainConditionSubmissionError) {
        this.pending = { action: selected, before: beforeSend, signature: error.signature };
        const confirmation = await this.runtime.confirm(error.signature);
        const afterSend = await this.runtime.readState();
        if (conditionActionApplied(selected, beforeSend, afterSend)) {
          this.pending = null;
          if (confirmation.status === "confirmed") {
            this.emit({ status: "confirmed", action: selected, signature: error.signature, reason: "RPC response was lost; this signature is confirmed and the on-chain transition is visible", slot: afterSend.slot });
          } else if (confirmation.status === "failed") {
            this.emit({ status: "rejected", action: selected, signature: error.signature, reason: `${confirmation.reason ?? "Condition transaction failed"}; matching action is visible on-chain, but this signature did not apply it`, slot: afterSend.slot });
          } else {
            this.emit({ status: "observed", action: selected, signature: error.signature, reason: "RPC response was lost; matching action is visible on-chain, but this signature remains unconfirmed and attribution is unknown", slot: afterSend.slot });
          }
        } else if (confirmation.status === "failed") {
          this.pending = null;
          this.emit({ status: "rejected", action: selected, signature: error.signature, reason: confirmation.reason ?? "Condition transaction failed", slot: afterSend.slot });
        } else {
          this.emit({ status: "pending", action: selected, signature: error.signature, reason: safeError(error), slot: afterSend.slot });
        }
        return;
      }
      const afterSend = await this.runtime.readState();
      this.emit({ status: "error", action: selected, reason: `${safeError(error)}; chain state was reread before any retry`, slot: afterSend.slot });
    }
  }

  private async finishSubmission(action: ConditionAction, before: ConditionSnapshot, signature: string): Promise<void> {
    const confirmation = await this.runtime.confirm(signature);
    const after = await this.runtime.readState();
    if (conditionActionApplied(action, before, after)) {
      if (confirmation.status === "confirmed") {
        this.emit({ status: "confirmed", action, signature, slot: after.slot });
      } else if (confirmation.status === "failed") {
        this.emit({ status: "rejected", action, signature, reason: `${confirmation.reason ?? "Condition transaction failed"}; matching action is visible on-chain, but this signature did not apply it`, slot: after.slot });
      } else {
        this.emit({ status: "observed", action, signature, reason: "Matching action is visible on-chain, but this signature remains unconfirmed; attribution is unknown", slot: after.slot });
      }
      return;
    }
    if (confirmation.status === "failed") {
      this.emit({ status: "rejected", action, signature, reason: confirmation.reason ?? "Condition transaction failed", slot: after.slot });
      return;
    }
    if (conditionActionStillCurrent(action, after)) {
      this.pending = { action, before, signature };
      this.emit({ status: "pending", action, signature, reason: confirmation.reason, slot: after.slot });
      return;
    }
    this.emit({ status: "stale", action, signature, reason: "Chain advanced before this condition action was observed", slot: after.slot });
  }

  private emit(result: ConditionSchedulerResult): void {
    try { this.observe(result); } catch { /* Observers cannot stop chain reconciliation. */ }
  }
}

function safeError(error: unknown): string { return error instanceof Error ? error.message : "Unknown condition scheduler error"; }
