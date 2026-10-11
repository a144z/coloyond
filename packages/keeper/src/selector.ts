import type { ActionProposalSource, ChainSnapshot, FillCandidate, KeeperAction, StartCandidate } from "./types.js";

export type Selection = { action: KeeperAction | null; reason: string };
const MAX_U64 = 0xffff_ffff_ffff_ffffn;

export async function selectEligibleAction(snapshot: ChainSnapshot, proposals: ActionProposalSource): Promise<Selection> {
  const { vault, governance, policy, intent } = snapshot;
  if (!snapshot.oracleAccountsReady) return { action: null, reason: "Pinned Pyth feed accounts are unavailable or have the wrong owner" };
  if (!snapshot.custodyAccountsReady) return { action: null, reason: "Vault custody token accounts are unavailable or inconsistent" };
  if (!governance) return { action: null, reason: "GovernanceAccount is unavailable" };
  if (governance.vault !== snapshot.vaultAddress || governance.configurationRevision !== vault.configurationRevision) {
    return { action: null, reason: "GovernanceAccount is stale or linked to another vault" };
  }
  if (governance.targetBps[0] !== vault.assets[0].targetBps || governance.targetBps[1] !== vault.assets[1].targetBps) {
    return { action: null, reason: "GovernanceAccount target does not match Vault" };
  }
  if (!policy) return { action: null, reason: "AuctionPolicy is absent; S2D fails closed until policy admission" };
  if (intent && intent.vault !== snapshot.vaultAddress) return { action: null, reason: "RebalanceIntent is linked to another vault" };

  if (intent) {
    const configurationStale = intent.targetRevision !== vault.configurationRevision || intent.policyRevision !== policy.configurationRevision || policy.configurationRevision !== vault.configurationRevision;
    if (configurationStale) {
      return { action: { kind: "finish", expectedVaultSequence: vault.sequence, expectedIntentSequence: intent.sequence }, reason: "Close stale-configuration intent" };
    }
    if (policy.vault !== snapshot.vaultAddress) return { action: null, reason: "AuctionPolicy is linked to another vault" };
    if (!policy.valid) return { action: null, reason: "AuctionPolicy fields fail S2D bounds" };
    const terminal = intent.remainingSellAmount === 0n || snapshot.slot > intent.endSlot;
    if (terminal) {
      return { action: { kind: "finish", expectedVaultSequence: vault.sequence, expectedIntentSequence: intent.sequence }, reason: intent.remainingSellAmount === 0n ? "Finalize completed intent" : "Expire intent after its fixed end slot" };
    }
    if (governance.riskPaused) return { action: null, reason: "Risk is paused; wait for terminal finish or governance recovery" };
    const candidate = await proposals.fill?.(snapshot) ?? null;
    if (!candidate) return { action: null, reason: "Open auction has no concrete taker quote; awaiting solver" };
    if (!validFillCandidate(candidate, snapshot)) return { action: null, reason: "Fill proposal is stale or outside current intent bounds" };
    return { action: candidate, reason: "Candidate fill matches the current intent sequence; S2D simulation remains authoritative" };
  }

  if (policy.vault !== snapshot.vaultAddress) return { action: null, reason: "AuctionPolicy is linked to another vault" };
  if (policy.configurationRevision !== vault.configurationRevision) return { action: null, reason: "AuctionPolicy is stale for the current Vault revision" };
  if (!policy.valid) return { action: null, reason: "AuctionPolicy fields fail S2D bounds" };
  if (vault.status !== "active") return { action: null, reason: "Vault is not active" };
  if (governance.riskPaused) return { action: null, reason: "Risk is paused" };
  if (policy.lastCompletedSlot !== null && snapshot.slot < policy.lastCompletedSlot + policy.cooldownSlots) {
    return { action: null, reason: "Auction cooldown has not elapsed" };
  }
  const candidate = await proposals.start?.(snapshot) ?? null;
  if (!candidate) return { action: null, reason: "No explicit start proposal is available" };
  if (!validStartCandidate(candidate, snapshot)) return { action: null, reason: "Start proposal is stale or outside current custody accounting" };
  return { action: candidate, reason: "Candidate start matches current vault sequence; S2D simulation remains authoritative" };
}

export function validStartCandidate(candidate: StartCandidate, snapshot: ChainSnapshot): boolean {
  return candidate.expectedVaultSequence === snapshot.vault.sequence
    && candidate.sellAsset <= 1
    && candidate.initialSellAmount > 0n
    && candidate.initialSellAmount <= MAX_U64
    && candidate.initialSellAmount <= snapshot.vault.accountedAmounts[candidate.sellAsset]
    && candidate.initialSellAmount <= snapshot.custodyAmounts[candidate.sellAsset];
}

export function validFillCandidate(candidate: FillCandidate, snapshot: ChainSnapshot): boolean {
  const intent = snapshot.intent;
  return !!intent
    && candidate.expectedVaultSequence === snapshot.vault.sequence
    && candidate.expectedIntentSequence === intent.sequence
    && candidate.sellAmount > 0n
    && candidate.sellAmount <= MAX_U64
    && candidate.sellAmount <= intent.remainingSellAmount
    && candidate.grossBuyAmount > 0n
    && candidate.grossBuyAmount <= MAX_U64
    && candidate.bountyAmount >= 0n
    && candidate.bountyAmount <= MAX_U64
    && candidate.bountyAmount <= (snapshot.policy?.maximumBountyPerFill ?? -1n)
    && candidate.takerIn.length > 0
    && candidate.takerOut.length > 0;
}

export function actionKey(action: KeeperAction, vaultAddress: string): string {
  if (action.kind === "start") return `${vaultAddress}:start:${action.expectedVaultSequence}`;
  if (action.kind === "fill") return `${vaultAddress}:fill:${action.expectedVaultSequence}:${action.expectedIntentSequence}`;
  return `${vaultAddress}:finish:${action.expectedVaultSequence}:${action.expectedIntentSequence}`;
}

export function actionApplied(action: KeeperAction, before: ChainSnapshot, after: ChainSnapshot): boolean {
  if (after.vault.sequence <= before.vault.sequence) return false;
  if (action.kind === "start") return !!after.intent && after.intent.sequence > action.expectedVaultSequence;
  if (action.kind === "fill") return !!after.intent && after.intent.sequence > action.expectedIntentSequence;
  return after.intent === null;
}

export function actionStillCurrent(action: KeeperAction, snapshot: ChainSnapshot): boolean {
  if (snapshot.vault.sequence !== action.expectedVaultSequence) return false;
  if (action.kind === "start") return snapshot.intent === null;
  return snapshot.intent?.sequence === action.expectedIntentSequence;
}
