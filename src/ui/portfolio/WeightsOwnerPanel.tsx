// The owner / governance panel for the ETF weights flow. Renders the four
// governance controls (set / propose / accept / decline) plus the cooldown-
// gated rebalance button, all driven from the pure helpers in
// `weightsOwnerPanel.ts` so the enabling logic is testable without React.
import type * as React from "react";
import { useEffect, useState } from "react";
import {
  encodeAcceptWeightsArgs,
  encodeDeclineWeightsArgs,
  encodeInitWeightsArgs,
  encodeProposeWeightsArgs,
  encodeSetWeightsArgs,
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
  useEffect(() => setDraft(snapshot.weights.targetWeights), [snapshot.weights.pool.toBase58(), snapshot.weights.targetWeights.join(",")]);
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
      {draft.map((weight, index) => (
        <label key={index}>Asset {index + 1} (basis points)
          <input type="number" min="0" max="10000" step="1"
            aria-label={`candidate weight for asset ${index}`}
            value={Number(weight)} onChange={(event) => {
              const value = event.target.value;
              if (!/^\d{1,5}$/.test(value)) return;
              const parsed = BigInt(value);
              if (parsed > 10_000n) return;
              setDraft(current => current.map((w, i) => i === index ? parsed : w));
            }} />
        </label>
      ))}
      {draftError ? <p className="etf-weights-owner-panel__error">{draftError}</p> : null}
      <input
        type="hidden"
        name="init-args"
        value={encodeInitWeightsArgs(snapshot.weights.targetWeights, snapshot.weights.rebalanceIntervalSeconds).toString("hex")}
      />
    </section>
  );
}
