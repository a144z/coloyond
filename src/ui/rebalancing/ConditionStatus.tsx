import { useCallback, useEffect, useState } from "react";
import type { ConditionReadResult, ConditionRuleView, ConditionStatusReadModel } from "./readModel.js";
import "./ConditionStatus.css";

const STATUS_LABELS: Record<ConditionRuleView["status"], string> = {
  proposed: "Proposed · governance delay",
  waiting: "Waiting for observation or executor",
  eligible: "Observed ready · recheck required",
  activated: "Activated · revision confirmed",
  expired: "Expired on chain",
  stale: "Stale · revision or observation",
  paused: "Risk paused",
  unknown: "State unknown",
};

function unixTime(value: string): string {
  try {
    const seconds = BigInt(value);
    const millis = seconds * 1000n;
    if (millis > BigInt(Number.MAX_SAFE_INTEGER) || millis < BigInt(Number.MIN_SAFE_INTEGER)) return `${value} Unix seconds`;
    const date = new Date(Number(millis));
    return Number.isNaN(date.getTime()) ? `${value} Unix seconds` : date.toISOString();
  } catch {
    return "Invalid on-chain time";
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function RuleCard({ title, rule, model }: { title: string; rule: ConditionRuleView; model: ConditionStatusReadModel }) {
  const statusClass = `condition-status-state condition-status-${rule.status}`;
  return (
    <article className="condition-status-rule">
      <div className="condition-status-rule-head">
        <div><span className="cr-index">{title}</span><h3>{rule.predicate}</h3></div>
        <span className={statusClass}>{STATUS_LABELS[rule.status]}</span>
      </div>
      <dl className="condition-status-facts">
        <div><dt>Rule nonce</dt><dd>{rule.consumedNonce ? `${rule.consumedNonce} consumed` : rule.nonce}</dd></div>
        <div><dt>Vault revision</dt><dd>{rule.targetRevision} target · current {model.currentConfigurationRevision}</dd></div>
        {rule.activateAfterSlot !== null && <div><dt>Delay ends</dt><dd>Slot {rule.activateAfterSlot} · current {model.source.slot}</dd></div>}
        <div><dt>Expiry</dt><dd>{unixTime(rule.expiresAt)} · slot {rule.expiresSlot}</dd></div>
        <div><dt>Target weights</dt><dd>{(rule.targetBps[0] / 100).toFixed(2)}% / {(rule.targetBps[1] / 100).toFixed(2)}%</dd></div>
      </dl>
      {rule.observation ? (
        <div className="condition-status-observation">
          <div><span>Oracle source</span><strong>{rule.observation.source}<br /><code>{rule.observation.feedAddress}</code></strong></div>
          <div><span>Publish time</span><strong>{unixTime(rule.observation.publishTime)}</strong></div>
          <div><span>Observed at</span><strong>{unixTime(rule.observation.observedAt)}</strong></div>
          <div><span>Observation slot</span><strong>{rule.observation.slot}</strong></div>
          <div><span>Age at snapshot</span><strong>{rule.observation.ageSeconds === null ? "Unknown" : `${rule.observation.ageSeconds}s`}</strong></div>
          <div><span>Stored status</span><strong>{rule.observation.readiness}</strong></div>
          <code>Price · {rule.observation.priceQ18} Q18</code>
        </div>
      ) : <p className="condition-status-empty">No accepted oracle observation is stored for this rule.</p>}
      {rule.status === "eligible" && <p className="condition-status-note" role="note">The program marked the stored observation ready. Activation still checks the latest verified Pyth account and all vault guards. This is not a submitted transaction or a trade.</p>}
      {rule.status === "activated" && <p className="condition-status-note" role="note">The confirmed vault snapshot is at revision {model.currentConfigurationRevision}; the consumed condition authorized target revision {rule.targetRevision}.</p>}
      {rule.status === "proposed" && <p className="condition-status-note" role="note">The governance delay has not elapsed. No observer or executor action is implied.</p>}
    </article>
  );
}

function ModelView({ model }: { model: ConditionStatusReadModel }) {
  return (
    <>
      <div className="condition-status-source" aria-label="RPC snapshot source">
        <div><dt>Cluster</dt><dd>Solana {model.source.cluster}</dd></div>
        <div><dt>RPC</dt><dd>{model.source.rpcUrl}</dd></div>
        <div><dt>Confirmed slot</dt><dd>{model.source.slot}</dd></div>
        <div><dt>Read time</dt><dd>{model.source.observedAt ?? "Unknown"}</dd></div>
        <div><dt>Condition sequence</dt><dd>{model.sequence ?? "Not initialized"}</dd></div>
        <div><dt>Last allocated nonce</dt><dd>{model.nextNonce ?? "Not initialized"}</dd></div>
        <div><dt>Configuration revision</dt><dd>{model.currentConfigurationRevision}</dd></div>
        <div><dt>Risk</dt><dd>{model.riskPaused ? "Paused on chain" : "Not paused in governance"}</dd></div>
      </div>
      {model.accountState === "not-initialized" ? (
        <div className="condition-status-empty-block"><strong>No condition account is initialized.</strong><span>This confirmed Localnet snapshot contains no state at the condition PDA. It may mean no rule has been proposed; the page does not infer support from the deployed binary or the portfolio demo.</span></div>
      ) : (
        <>
          <div className="condition-status-rules">
            {model.pending && <RuleCard title="01 / Pending proposal" rule={model.pending} model={model} />}
            {model.active && <RuleCard title={model.pending ? "02 / Active rule" : "01 / Active or last consumed rule"} rule={model.active} model={model} />}
            {!model.pending && !model.active && <div className="condition-status-empty-block"><strong>No active or pending rule in the account.</strong><span>Sequence {model.sequence}; the account can still contain historical nonce progress.</span></div>}
          </div>
          <section className="condition-status-history" aria-label="Recent failed transactions">
            <div><span className="cr-index">Recent RPC history</span><h3>Failed calls</h3></div>
            {model.history.state === "found" ? (
              <p>A confirmed failed transaction referenced this condition account at slot {model.history.slot}. <a href={`https://explorer.solana.com/tx/${model.history.signature}?cluster=custom&customUrl=${encodeURIComponent(model.source.rpcUrl)}`} target="_blank" rel="noreferrer">Inspect signature ↗</a><code>{model.history.error}</code></p>
            ) : model.history.state === "none" ? (
              <p>No failed transaction was found in the {model.history.checked} most recent RPC history entries for this account. This is a bounded history check, not proof that no earlier attempt failed.</p>
            ) : <p>Failure history is unknown: {model.history.reason}</p>}
          </section>
        </>
      )}
      <p className="condition-status-account">Vault <code>{shortAddress(model.vault)}</code> · Condition PDA <code>{shortAddress(model.conditionAddress)}</code> · Genesis <code>{shortAddress(model.source.genesisHash)}</code></p>
    </>
  );
}

export function ConditionStatus() {
  const [result, setResult] = useState<ConditionReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { readConditionStatus } = await import("./readModel.js");
      setResult(await readConditionStatus());
    } catch (error) {
      setResult({ kind: "error", reason: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="condition-status" aria-labelledby="condition-status-title" aria-busy={loading}>
      <header className="condition-status-header">
        <div><p className="cr-index">E / Solana · read-only account view</p><h2 id="condition-status-title">Condition lifecycle</h2><p>Governance rule, observation and confirmed revision from the vault PDA. The portfolio panels remain sample data; eligibility never means a trade executed.</p></div>
        <div className="condition-status-actions"><span className="condition-status-live-tag">{result?.kind === "ready" ? "CONFIRMED LOCALNET RPC" : result?.kind === "error" ? "SNAPSHOT UNVERIFIED" : result?.kind === "unavailable" ? "RPC NOT READY" : "LOCALNET READ"}</span><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Reading…" : "Refresh state"}</button></div>
      </header>
      {result?.kind === "unavailable" && <p className="condition-status-message" role="status">{result.reason}</p>}
      {result?.kind === "error" && <p className="condition-status-error" role="alert">The condition state could not be verified: {result.reason}</p>}
      {result?.kind === "ready" && <ModelView model={result.model} />}
      {!result && !loading && <p className="condition-status-message" role="status">No RPC snapshot has been read yet.</p>}
      {loading && <p className="condition-status-message" role="status">Reading condition, vault and governance accounts at confirmed commitment…</p>}
    </section>
  );
}
