import { ExecutionPhase, ExecutionStatus, Route } from "./types.js";

export class ColoyondExecutor {
  private status: ExecutionStatus;

  constructor(private readonly route: Route) {
    this.status = {
      phase: "await-route",
      currentStep: 0,
      totalSteps: route.steps.length,
      txHashes: [],
    };
  }

  getStatus(): ExecutionStatus {
    return this.status;
  }

  private advance(phase: ExecutionPhase, message?: string): ExecutionStatus {
    this.status = { ...this.status, phase, message };
    return this.status;
  }

  lockSource(txHash: string): ExecutionStatus {
    this.status.txHashes.push(txHash);
    return this.advance("source-locked", "assets held by ColoyondExecutor");
  }

  executeStep(stepIndex: number, txHash: string): ExecutionStatus {
    const step = this.route.steps[stepIndex];
    if (!step) throw new Error(`no step ${stepIndex}`);
    this.status.txHashes.push(txHash);
    this.status.currentStep = stepIndex + 1;
    if (step.kind === "bridge") return this.advance("bridge-confirming");
    return stepIndex === 0
      ? this.advance("step-sent")
      : this.advance("dest-swap-executing");
  }

  confirmBridge(): ExecutionStatus {
    return this.advance("bridge-confirming", "2FA (Axelar+CCIP+LayerZero+Wormhole) ok");
  }

  complete(): ExecutionStatus {
    return this.advance("complete", "output delivered to recipient");
  }

  fail(reason: string, autoRecover = true): ExecutionStatus {
    return this.advance(autoRecover ? "rolled-back" : "manual-recovery", reason);
  }
}
