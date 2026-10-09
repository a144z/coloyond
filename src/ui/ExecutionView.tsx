import { useEffect, useState } from "react";
import { Route, RouteStep } from "../types.js";
import { chainName, fmtTime, fakeHash } from "./data.js";
import { RoutingDiagram } from "./RoutesView.js";
import { Logo } from "./Logo.js";

type StepState = "done" | "active" | "pending";

function stepDescription(s: RouteStep): string {
  if (s.kind === "bridge") {
    return `${s.fromSymbol} (${chainName(s.fromChainId)}) → ${s.toSymbol} (${chainName(s.toChainId)})`;
  }
  return `${s.fromSymbol} → ${s.toSymbol} via ${s.protocol}`;
}

function stepState(index: number, current: number, total: number): StepState {
  if (index < current) return "done";
  if (index === current && current < total) return "active";
  return "pending";
}

const STATE_ICON: Record<StepState, string> = { done: "✅", active: "🔄", pending: "⏳" };

export function ExecutionView({ route, onBack }: { route: Route; onBack: () => void }) {
  const total = route.steps.length;
  const [current, setCurrent] = useState(0);
  const done = current >= total;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setCurrent((c) => c + 1), 1800);
    return () => clearTimeout(t);
  }, [current, done]);

  const firstTx = fakeHash(`${route.id}-0`);
  const statusText = done ? "✅ Complete" : `Step ${current + 1}/${total}`;

  return (
    <div>
      <div className="view-head">
        <button className="link-btn" onClick={onBack} disabled={current > 0 && !done}>
          ← Back to Routes
        </button>
        <span className="view-title">Executing: {route.provider}</span>
        <span className="status-pill">{statusText}</span>
      </div>

      <div className="card">
        <div className="exec-subhead">Route preview</div>
        <RoutingDiagram steps={route.steps} />

        <div className="exec-subhead">Steps</div>
        <div className="steps">
          {route.steps.map((s, i) => {
            const state = stepState(i, current, total);
            const hash = fakeHash(`${route.id}-${i}`);
            return (
              <div className={`step ${state}`} key={i}>
                <div className="step-rail">
                  <div className="step-icon">{STATE_ICON[state]}</div>
                  {i < total - 1 && <div className="step-line" />}
                </div>
                <div className="step-body">
                  <div className="step-name">
                    <Logo src={s.logo} fallback={s.protocol} size={16} />
                    <span>
                      Step {i + 1} ·{" "}
                      {s.kind === "bridge" ? `Bridge via ${s.protocol}` : `Swap on ${chainName(s.fromChainId)}`}
                    </span>
                  </div>
                  <div className="step-sub">{stepDescription(s)}</div>
                  {state !== "pending" && <div className="step-tx">TX: {hash.slice(0, 12)}…</div>}
                  {state === "done" && <div className="step-sub">Confirmed (12/12 blocks)</div>}
                  {state === "active" && s.kind === "bridge" && (
                    <div className="step-eta">Message sent, awaiting confirmation… ⏱ {fmtTime(s.etaSeconds)} remaining</div>
                  )}
                  {state === "active" && s.kind === "swap" && <div className="step-eta">Broadcasting transaction…</div>}
                  {state === "pending" && <div className="step-sub">Awaiting previous step</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div className={`lock ${done ? "lock-done" : ""}`}>
          {done ? (
            <>
              <b>✅ Completed.</b> Output sent to your wallet on {chainName(route.steps[total - 1].toChainId)}.{" "}
              Atomic lock released.
            </>
          ) : (
            <>
              <b>🔒 Atomic Lock:</b> all steps locked until completion. Failure → full rollback to source wallet.
            </>
          )}
        </div>

        <div className="exec-actions">
          <button className="btn btn-danger" onClick={onBack} disabled={done}>
            Cancel Execution
          </button>
          <a
            className="btn btn-link2"
            href={`https://arbiscan.io/tx/${firstTx}`}
            target="_blank"
            rel="noreferrer"
          >
            View on Explorer ↗
          </a>
        </div>
      </div>
    </div>
  );
}
