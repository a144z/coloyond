import type { ChainSnapshot, KeeperAction, StartCandidate } from "../src/types.js";
import type { ConfirmationResult, KeeperRuntime, SimulationResult } from "../src/keeper.js";

export const VAULT = "DVZ7tQAgko19RNUXKcMU1RXtcqff2kT415C6JA49NMMQ";

export function snapshot(overrides: Partial<ChainSnapshot> = {}): ChainSnapshot {
  return {
    slot: 200n,
    vaultAddress: VAULT,
    oracleAccountsReady: true,
    custodyAccountsReady: true,
    custodyAmounts: [20_000_000_000n, 500_000_000n],
    vault: {
      version: 1,
      status: "active",
      authority: VAULT,
      configurationRevision: 4n,
      assets: [
        { mint: "So11111111111111111111111111111111111111112", tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", custody: "11111111111111111111111111111111", decimals: 9, targetBps: 5_000 },
        { mint: "EPjFWdd5AufqSSqeM2qQY8rG9hWb5jW1xqNqWqC1v7C", tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", custody: "SysvarRent111111111111111111111111111111111", decimals: 6, targetBps: 5_000 },
      ],
      accountedAmounts: [20_000_000_000n, 500_000_000n],
      sequence: 3n,
    },
    governance: { version: 1, vault: VAULT, configurationRevision: 4n, targetBps: [5_000, 5_000], riskPaused: false },
    policy: { version: 1, vault: VAULT, configurationRevision: 4n, maximumAgeSeconds: 60n, minimumDriftBps: 500, maximumTradeValueQ9: 500_000_000_000n, cooldownSlots: 10n, lastCompletedSlot: null, durationSlots: 100n, maximumBountyPerFill: 1_000_000n, valid: true },
    intent: null,
    ...overrides,
  };
}

export const startCandidate = (state: ChainSnapshot): StartCandidate => ({ kind: "start", expectedVaultSequence: state.vault.sequence, sellAsset: 0, initialSellAmount: 1_000_000_000n });

export class FakeRuntime implements KeeperRuntime {
  state: ChainSnapshot;
  simulations = 0;
  reads = 0;
  sends = 0;
  onChange: (() => void) | null = null;
  confirmationResults: ConfirmationResult[] = [{ status: "confirmed" }];
  applyOnConfirm = true;
  lastAction: KeeperAction | null = null;

  constructor(initial = snapshot()) { this.state = initial; }
  async readState(): Promise<ChainSnapshot> { this.reads++; return structuredClone(this.state); }
  async subscribe(onChange: () => void): Promise<() => void> { this.onChange = onChange; return () => { this.onChange = null; }; }
  async simulate(): Promise<SimulationResult> { this.simulations++; return { ok: true, feeLamports: 500n }; }
  async submit(action: KeeperAction): Promise<string> { this.sends++; this.lastAction = action; return `signature-${this.sends}`; }
  async confirm(): Promise<ConfirmationResult> {
    const result = this.confirmationResults.shift() ?? { status: "unknown" as const };
    if (result.status === "confirmed" && this.applyOnConfirm && this.lastAction) apply(this.state, this.lastAction);
    return result;
  }
}

function apply(state: ChainSnapshot, action: KeeperAction): void {
  if (action.kind === "start") {
    state.vault.sequence++;
    state.intent = { version: 1, vault: state.vaultAddress, sequence: state.vault.sequence, targetRevision: state.vault.configurationRevision, policyRevision: state.policy!.configurationRevision, sellAsset: action.sellAsset, initialSellAmount: action.initialSellAmount, remainingSellAmount: action.initialSellAmount, endSlot: state.slot + 100n };
  } else if (action.kind === "fill") {
    state.vault.sequence++;
    state.intent!.sequence++;
    state.intent!.remainingSellAmount -= action.sellAmount;
  } else {
    state.vault.sequence++;
    state.intent = null;
  }
}
