import type { AuctionPolicyState, GovernanceState, IntentState, VaultState } from "../types.js";
import type { ConditionBounds, ConditionState, ConditionalRule } from "./state.js";

export type ConditionAction =
  | { kind: "execute"; stateSequence: bigint; ruleNonce: bigint }
  | { kind: "observe"; stateSequence: bigint; ruleNonce: bigint }
  | { kind: "activate"; stateSequence: bigint; ruleNonce: bigint };

export type ConditionSnapshot = {
  slot: bigint;
  unixTimestamp: bigint | null;
  vaultAddress: string;
  vault: VaultState;
  governance: GovernanceState | null;
  policy: AuctionPolicyState | null;
  intent: IntentState | null;
  condition: ConditionState | null;
  oracleAccountsReady: boolean;
};

export type ConditionSelection = { actions: ConditionAction[]; reason: string };

export function selectConditionActions(snapshot: ConditionSnapshot): ConditionSelection {
  const { condition, vault, governance, policy } = snapshot;
  if (!condition) return { actions: [], reason: "No on-chain condition rule has been proposed" };
  if (condition.vault !== snapshot.vaultAddress) return { actions: [], reason: "ConditionState is bound to a different vault" };
  if (!governance || governance.vault !== snapshot.vaultAddress || governance.configurationRevision !== vault.configurationRevision || governance.riskPaused || vault.status !== "active") {
    return { actions: [], reason: "Governance revision is stale or vault risk state does not permit condition execution" };
  }
  if (!policy || !policy.valid || policy.vault !== snapshot.vaultAddress || policy.configurationRevision !== vault.configurationRevision) {
    return { actions: [], reason: "Auction policy is absent, invalid, or stale for the current vault revision" };
  }

  const pending = condition.pending;
  if (pending) {
    const rule = pending.rule;
    if (!ruleMatchesRevision(rule, vault.configurationRevision)) return { actions: [], reason: "Pending condition rule is stale for the current vault revision" };
    if (isExpired(rule, snapshot)) return { actions: [], reason: "Pending condition rule has expired on chain" };
    if (policy.maximumAgeSeconds < pending.bounds.maximumObservationAgeSeconds) {
      return { actions: [], reason: "Pending condition bounds exceed the active oracle age policy" };
    }
    if (snapshot.slot < pending.activateAfterSlot) return { actions: [], reason: "Governance timelock has not reached its on-chain activation slot" };
    return { actions: [{ kind: "execute", stateSequence: condition.sequence, ruleNonce: rule.nonce }], reason: "Pending condition rule has reached its governance timelock" };
  }

  const rule = condition.activeRule;
  const bounds = condition.activeBounds;
  if (!rule || !bounds || !rule.enabled) return { actions: [], reason: "No enabled condition rule is active" };
  if (!ruleMatchesRevision(rule, vault.configurationRevision)) return { actions: [], reason: "Active condition rule is stale for the current vault revision" };
  if (isExpired(rule, snapshot)) return { actions: [], reason: "Active condition rule has expired on chain" };
  if (policy.maximumAgeSeconds < bounds.maximumObservationAgeSeconds) return { actions: [], reason: "Active condition bounds exceed the oracle age policy" };
  if (snapshot.intent) return { actions: [], reason: "An active rebalance auction prevents condition activation" };

  const actions: ConditionAction[] = [];
  if (rule.pendingActivation) actions.push({ kind: "activate", stateSequence: condition.sequence, ruleNonce: rule.nonce });
  if (snapshot.oracleAccountsReady && observationGapElapsed(rule.lastObservation, bounds, snapshot)) {
    actions.push({ kind: "observe", stateSequence: condition.sequence, ruleNonce: rule.nonce });
  }
  if (actions.length > 0) return { actions, reason: rule.pendingActivation ? "Active condition is ready for permissionless activation" : "An on-chain condition observation is due" };
  return { actions: [], reason: snapshot.oracleAccountsReady ? "Waiting for the on-chain observation separation window" : "Pinned Pyth feed accounts are unavailable" };
}

export function conditionActionStillCurrent(action: ConditionAction, snapshot: ConditionSnapshot): boolean {
  return selectConditionActions(snapshot).actions.some((candidate) => sameAction(action, candidate));
}

export function conditionActionApplied(action: ConditionAction, before: ConditionSnapshot, after: ConditionSnapshot): boolean {
  const prior = before.condition;
  const next = after.condition;
  if (!prior || !next || next.sequence <= prior.sequence) return false;
  if (action.kind === "execute") {
    return prior.pending?.rule.nonce === action.ruleNonce
      && next.pending === null
      && next.activeRule?.nonce === action.ruleNonce
      && next.activeRule.enabled;
  }
  if (action.kind === "observe") {
    return prior.activeRule?.nonce === action.ruleNonce
      && next.activeRule?.nonce === action.ruleNonce
      && next.activeRule.lastObservation !== null && next.activeRule.lastObservation !== undefined
      && next.activeRule.lastObservation.slot > (prior.activeRule.lastObservation?.slot ?? -1n);
  }
  const previousRule = prior.activeRule;
  const currentRule = next.activeRule;
  return previousRule?.nonce === action.ruleNonce
    && currentRule !== null
    && currentRule.nonce === action.ruleNonce + 1n
    && !currentRule.enabled
    && after.vault.configurationRevision === previousRule.authorizedTargetRevision;
}

function observationGapElapsed(
  observation: ConditionalRule["lastObservation"],
  bounds: ConditionBounds,
  snapshot: ConditionSnapshot,
): boolean {
  if (!observation) return true;
  if (snapshot.slot < observation.slot + bounds.minimumObservationSeparationSlots) return false;
  return snapshot.unixTimestamp !== null
    && snapshot.unixTimestamp >= observation.observedAt + bounds.minimumObservationSeparationSeconds;
}

function ruleMatchesRevision(rule: ConditionalRule, revision: bigint): boolean {
  return rule.expectedTargetRevision === revision
    && rule.expectedConfigurationRevision === revision
    && rule.authorizedTargetRevision === revision + 1n;
}

function isExpired(rule: ConditionalRule, snapshot: ConditionSnapshot): boolean {
  return snapshot.slot >= rule.expiresSlot
    || (snapshot.unixTimestamp !== null && snapshot.unixTimestamp >= rule.expiresAt);
}

function sameAction(a: ConditionAction, b: ConditionAction): boolean {
  return a.kind === b.kind && a.stateSequence === b.stateSequence && a.ruleNonce === b.ruleNonce;
}
