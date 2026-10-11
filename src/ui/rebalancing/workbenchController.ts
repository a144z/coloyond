export type WorkbenchScenario = "eligible" | "stale-oracle" | "paused";
export type WorkbenchPhase = "ready" | "open" | "partial" | "complete" | "expired" | "closed";

export interface WorkbenchEvent {
  id: number;
  action: string;
  result: "accepted in fixture" | "rejected in fixture";
  detail: string;
}

export interface WorkbenchState {
  scenario: WorkbenchScenario;
  phase: WorkbenchPhase;
  sequence: number | null;
  fillSequence: number | null;
  remainingWsol: number;
  balances: { wsol: number; usdc: number };
  events: WorkbenchEvent[];
  nextEventId: number;
}

const INITIAL_BALANCES = { wsol: 5.6, usdc: 440 };
const FIXTURE_FILL_WSOL = 0.3;
const FIXTURE_FILL_USDC = 30;

export function createWorkbenchState(scenario: WorkbenchScenario = "eligible"): WorkbenchState {
  return {
    scenario,
    phase: "ready",
    sequence: null,
    fillSequence: null,
    remainingWsol: 0,
    balances: { ...INITIAL_BALANCES },
    events: [],
    nextEventId: 1,
  };
}

export function setWorkbenchScenario(state: WorkbenchState, scenario: WorkbenchScenario): WorkbenchState {
  return createWorkbenchState(scenario);
}

function record(
  state: WorkbenchState,
  action: string,
  result: WorkbenchEvent["result"],
  detail: string,
  patch: Partial<WorkbenchState> = {},
): WorkbenchState {
  const event: WorkbenchEvent = { id: state.nextEventId, action, result, detail };
  return { ...state, ...patch, events: [event, ...state.events], nextEventId: state.nextEventId + 1 };
}

function reject(state: WorkbenchState, action: string, detail: string): WorkbenchState {
  return record(state, action, "rejected in fixture", `${detail} Balances unchanged.`);
}

export type WorkbenchAction =
  | "start"
  | "partial-fill"
  | "fill-remaining"
  | "expire"
  | "close"
  | "replay"
  | "wrong-feed"
  | "adverse-price"
  | "oversize";

export function applyWorkbenchAction(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  if (action === "start") {
    if (state.scenario === "stale-oracle") return reject(state, "Start auction", "Rejected: oracle fixture is stale.");
    if (state.scenario === "paused") return reject(state, "Start auction", "Rejected: risk is paused in this fixture.");
    if (state.phase !== "ready") return reject(state, "Start auction", "Rejected: an intent is already active or this fixture is terminal.");
    return record(state, "Start auction", "accepted in fixture", "Synthetic intent opened; no transaction was built or sent.", {
      phase: "open",
      sequence: 1,
      remainingWsol: FIXTURE_FILL_WSOL * 2,
    });
  }

  if (action === "partial-fill" || action === "fill-remaining") {
    if (state.scenario !== "eligible") return reject(state, "Attempt fill", "Rejected: this scenario has no executable fresh, unpaused fixture.");
    if (state.phase !== "open" && state.phase !== "partial") return reject(state, "Attempt fill", "Rejected: no active fixture intent.");
    if (action === "fill-remaining" && state.phase !== "partial") return reject(state, "Fill remaining amount", "Rejected: make one partial fixture fill first.");
    const isFinalSlice = action === "fill-remaining";
    const sequence = (state.sequence ?? 0) + 1;
    const balances = {
      wsol: Number((state.balances.wsol - FIXTURE_FILL_WSOL).toFixed(4)),
      usdc: Number((state.balances.usdc + FIXTURE_FILL_USDC).toFixed(2)),
    };
    const remainingWsol = Number(Math.max(0, state.remainingWsol - FIXTURE_FILL_WSOL).toFixed(4));
    return record(
      state,
      isFinalSlice ? "Fill remaining amount" : "Partial fill",
      "accepted in fixture",
      `Scripted delta: −${FIXTURE_FILL_WSOL.toFixed(1)} WSOL, +${FIXTURE_FILL_USDC.toFixed(0)} USDC. No fee, bounty, signature, or RPC is simulated.`,
      {
        phase: remainingWsol === 0 ? "complete" : "partial",
        sequence,
        fillSequence: sequence,
        remainingWsol,
        balances,
      },
    );
  }

  if (action === "expire") {
    if (state.phase !== "open" && state.phase !== "partial") return reject(state, "Expire intent", "Rejected: there is no active fixture intent to expire.");
    return record(state, "Expire intent", "accepted in fixture", "Expiry is forced by this scenario control; no clock or slot is read.", { phase: "expired" });
  }

  if (action === "close") {
    if (state.phase !== "complete" && state.phase !== "expired") return reject(state, "Close intent", "Rejected: only a completed or expired fixture can close.");
    return record(state, "Close intent", "accepted in fixture", "Synthetic intent closed; no PDA or rent account exists in this browser fixture.", { phase: "closed", remainingWsol: 0 });
  }

  const invalidCases: Record<Exclude<WorkbenchAction, "start" | "partial-fill" | "fill-remaining" | "expire" | "close">, [string, string]> = {
    replay: ["Replay previous fill", "Rejected: fixture sequence is stale or absent."],
    "wrong-feed": ["Try wrong feed", "Rejected: fixture feed address does not match the pinned feed."],
    "adverse-price": ["Try adverse price", "Rejected: scripted quote exceeds the fixture's permitted curve/loss bound."],
    oversize: ["Try oversize fill", "Rejected: scripted fill exceeds the fixture's remaining size."],
  };
  const [label, reason] = invalidCases[action];
  return reject(state, label, reason);
}

export function portfolioWeights(balances: WorkbenchState["balances"]): { wsol: number; usdc: number } {
  const wsolValue = balances.wsol * 100;
  const total = wsolValue + balances.usdc;
  if (total <= 0) return { wsol: 0, usdc: 0 };
  return { wsol: (wsolValue / total) * 100, usdc: (balances.usdc / total) * 100 };
}
