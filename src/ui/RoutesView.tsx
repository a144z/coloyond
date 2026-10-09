import { Route, RouteStep } from "../types.js";
import { chainName, chainColor, fmtTime } from "./data.js";
import { tokenLogo } from "../logos.js";
import { Logo } from "./Logo.js";
import { RoutingPanel } from "./RoutingPanel.js";

export function RoutingDiagram({ steps }: { steps: RouteStep[] }) {
  return (
    <div className="diagram">
      {steps.map((s, i) => (
        <div className="diagram-cell" key={i}>
          {i > 0 && <div className="diagram-arrow">→</div>}
          <div className={`diagram-node ${s.kind}`}>
            <div className="node-proto">
              <Logo src={s.logo} fallback={s.protocol} size={16} />
              <span>{s.protocol}</span>
            </div>
            <div className="node-route">
              <Logo src={tokenLogo(s.fromSymbol, s.fromChainId)} fallback={s.fromSymbol} size={14} />
              {s.fromSymbol} →{" "}
              <Logo src={tokenLogo(s.toSymbol, s.toChainId)} fallback={s.toSymbol} size={14} />
              {s.toSymbol}
            </div>
            <div className="node-chips">
              <span className="chip" style={{ color: chainColor(s.fromChainId) }}>
                {chainName(s.fromChainId)}
              </span>
              {s.kind === "bridge" && s.fromChainId !== s.toChainId && (
                <span className="chip" style={{ color: chainColor(s.toChainId) }}>
                  {chainName(s.toChainId)}
                </span>
              )}
              <span className="chip">{fmtTime(s.etaSeconds)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const BADGE_LABEL: Record<Route["badge"], string> = {
  "best-price": "● BEST PRICE",
  fastest: "● FASTEST",
  "most-atomic": "● MOST ATOMIC",
  none: "",
};

const BADGE_CLASS: Record<Route["badge"], string> = {
  "best-price": "badge-best",
  fastest: "badge-fast",
  "most-atomic": "badge-atomic",
  none: "badge-none",
};

const ATOMIC_LABEL = { full: "✅ Full", partial: "⚠️ Partial", intent: "🔶 Intent-based" } as const;

export function RoutesView({
  routes,
  error,
  onBack,
  onRetry,
  onSelect,
}: {
  routes: Route[];
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  onSelect: (r: Route) => void;
}) {
  return (
    <div>
      <div className="view-head">
        <button className="link-btn" onClick={onBack}>
          ← Back to Swap
        </button>
        <span className="view-title">
          {routes.length > 0
            ? `Best Routes Found (${routes.length})`
            : error
              ? "No routes found"
              : "Finding routes…"}
        </span>
      </div>

      {routes.length > 0 && <RoutingPanel routes={routes} />}

      {routes.length === 0 && !error && (
        <div className="card center">
          <span className="spin" /> Querying LI.FI + deBridge in parallel…
        </div>
      )}

      {routes.length === 0 && error && (
        <div className="card center">
          <p className="error-text">{error}</p>
          <button className="btn btn-primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {routes.map((r) => (
        <div className="card route-card" key={r.id}>
          <div className="route-top">
            {r.badge !== "none" && (
              <span className={`badge ${BADGE_CLASS[r.badge]}`}>{BADGE_LABEL[r.badge]}</span>
            )}
            <span className={`dot dot-${r.atomicLevel}`} />
            <span className="provider">{r.provider}</span>
          </div>

          <RoutingDiagram steps={r.steps} />

          <div className="metrics">
            <div className="metric">
              <div className="k">Output</div>
              <div className="v">
                {r.outputAmount} {r.steps[r.steps.length - 1]?.toSymbol}
              </div>
            </div>
            <div className="metric">
              <div className="k">Time</div>
              <div className="v">{fmtTime(r.totalTimeSeconds)}</div>
            </div>
            <div className="metric">
              <div className="k">Fee</div>
              <div className="v">${r.totalFeeUsd.toFixed(2)}</div>
            </div>
            <div className="metric">
              <div className="k">Atomic</div>
              <div className={`v atomic-${r.atomicLevel}`}>{ATOMIC_LABEL[r.atomicLevel]}</div>
            </div>
          </div>

          <button className="btn btn-select" onClick={() => onSelect(r)}>
            Select Route
          </button>
        </div>
      ))}
    </div>
  );
}