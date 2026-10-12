// The owner / governance panel for the ETF weights flow. Renders the four
// governance controls (set / propose / accept / decline) plus the cooldown-
// gated rebalance button, all driven from the pure helpers in
// `weightsOwnerPanel.ts` so the enabling logic is testable without React.
import type * as React from "react";
import { useState } from "react";
import {
  encodeAcceptWeightsArgs,
  encodeDeclineWeightsArgs,
  encodeInitWeightsArgs,
  encodeProposeWeightsArgs,
  encodeSetWeightsArgs,
  type EtfWeightsV1Decoded,
} from "../../../packages/etf-client/src/index.js";
import { enabledOwnerActions, validateWeightsCandidate, type OwnerAction } from "./weightsOwnerPanel.js";

export type OwnerPanelProps = Readonly<{
  snapshot: Parameters<typeof enabledOwnerActions>[0];
  onSubmit: (action: OwnerAction, encodedArgs?: Uint8Array) => Promise<void> | void;
}>;

export function WeightsOwnerPanel({ snapshot, onSubmit }: OwnerPanelProps): React.ReactElement {
  const actions = enabledOwnerActions(snapshot);
  const can = (action: OwnerAction) => actions.includes(action);
  const draftLength = snapshot.weights.targetWeights.length;
  const [draft, setDraft] = useState<readonly bigint[]>(snapshot.weights.targetWeights);
  const draftError = validateWeightsCandidate(draft, draftLength);
  return (
    <section className="etf-weights-owner-panel">
      <h3>Weights owner panel</h3>
      <p>Target: {snapshot.weights.targetWeights.map((w) => Number(w)).join(" / ")}</p>
      <p>Proposed: {snapshot.weights.proposedWeights ? snapshot.weights.proposedWeights.map((w) => Number(w)).join(" / ") : "none"}</p>
      <p>Last rebalance: {snapshot.weights.lastRebalanceUnixTimestamp.toString()}</p>
      <div className="etf-weights-owner-panel__actions">
        {can("set") ? <button disabled={draftError !== null} onClick={() => void onSubmit("set", encodeSetWeightsArgs(draft))}>Set</button> : null}
        {can("propose") ? <button disabled={draftError !== null} onClick={() => void onSubmit("propose", encodeProposeWeightsArgs(draft))}>Propose</button> : null}
        {can("accept") ? <button onClick={() => void onSubmit("accept", encodeAcceptWeightsArgs())}>Accept</button> : null}
        {can("decline") ? <button onClick={() => void onSubmit("decline", encodeDeclineWeightsArgs())}>Decline</button> : null}
        {can("rebalance") ? <button onClick={() => void onSubmit("rebalance")}>Rebalance</button> : null}
      </div>
      <input
        type="number"
        aria-label="candidate weight for asset zero"
        value={Number(draft[0] ?? 0n)}
        onChange={(event) => {
          const parsed = BigInt(event.target.value || '0');
          const next = draft.map((w, i) => (i === 0 ? parsed : w));
          setDraft(next);
        }}
      />
      {draftError ? <p className="etf-weights-owner-panel__error">{draftError}</p> : null}
      <input
        type="hidden"
        name="init-args"
        value={encodeInitWeightsArgs(snapshot.weights.targetWeights, snapshot.weights.rebalanceIntervalSeconds).toString("hex")}
      />
    </section>
  );
}
