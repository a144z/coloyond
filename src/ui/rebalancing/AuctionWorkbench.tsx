import { WebsiteBrand } from "../Brand.js";
import { lazy, Suspense, useState } from "react";
import "./AuctionWorkbench.css";
import "./LocalnetWorkbench.css";

const LocalnetWorkbench = lazy(() => import("./LocalnetWorkbench.js").then((module) => ({ default: module.LocalnetWorkbench })));
import {
  applyWorkbenchAction,
  createWorkbenchState,
  portfolioWeights,
  setWorkbenchScenario,
  type WorkbenchAction,
  type WorkbenchScenario,
  type WorkbenchState,
} from "./workbenchController.js";

const SCENARIOS: Array<{ id: WorkbenchScenario; title: string; description: string }> = [
  { id: "eligible", title: "Fresh / eligible", description: "A scripted 56 / 44 portfolio can open and take two partial-fill steps." },
  { id: "stale-oracle", title: "Stale oracle", description: "The start attempt should be rejected without changing custody balances." },
  { id: "paused", title: "Risk paused", description: "The start attempt should be rejected while risk is paused." },
];

const ACTIONS: Array<{ id: WorkbenchAction; label: string }> = [
  { id: "replay", label: "Replay previous fill" },
  { id: "wrong-feed", label: "Try wrong feed" },
  { id: "adverse-price", label: "Try adverse price" },
  { id: "oversize", label: "Try oversize fill" },
];

function amount(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function phaseLabel(phase: WorkbenchState["phase"]): string {
  return ({ ready: "Ready to simulate", open: "Auction open", partial: "Partially filled", complete: "Fill complete", expired: "Expired", closed: "Closed" })[phase];
}

function AssetRow({ label, target, actual, amountText }: { label: string; target: number; actual: number; amountText: string }) {
  const bounded = Math.max(0, Math.min(actual, 100));
  return (
    <div className="aw-asset-row">
      <div className="aw-asset-heading"><strong>{label}</strong><span>{amountText}</span></div>
      <div className="aw-track" aria-label={`${label}: target ${target.toFixed(0)} percent, fixture actual ${bounded.toFixed(1)} percent`}>
        <span className="aw-target-mark" style={{ left: `${target}%` }} />
        <span className="aw-actual-fill" style={{ width: `${bounded}%` }} />
      </div>
      <div className="aw-asset-facts"><span>Target <b>{target.toFixed(0)}%</b></span><span>Fixture actual <b>{bounded.toFixed(1)}%</b></span></div>
    </div>
  );
}

export function AuctionWorkbench() {
  const [mode, setMode] = useState<"localnet" | "fixture">("localnet");
  if (mode === "fixture") return <FixtureWorkbench onLocalnetMode={() => setMode("localnet")} />;
  return (
    <div className="cr-app aw-app">
      <div className="cr-shell">
        <header className="cr-topbar aw-topbar">
          <a className="cr-brand" href="/" aria-label="Return to Coloyond home"><WebsiteBrand /></a>
          <div className="cr-topbar-right"><span className="cr-demo-label">Localnet SBF workbench</span><a className="cr-reference-link" href="/">Back to app <span aria-hidden="true">↗</span></a></div>
        </header>
        <main className="aw-main"><Suspense fallback={<p className="aw-empty-state">Loading the Localnet workbench…</p>}><LocalnetWorkbench onFixtureMode={() => setMode("fixture")} /></Suspense></main>
      </div>
    </div>
  );
}

function FixtureWorkbench({ onLocalnetMode }: { onLocalnetMode(): void }) {
  const [state, setState] = useState(() => createWorkbenchState());
  const weights = portfolioWeights(state.balances);
  const active = state.phase === "open" || state.phase === "partial";
  const run = (action: WorkbenchAction) => setState((current) => applyWorkbenchAction(current, action));

  return (
    <div className="cr-app aw-app">
      <div className="cr-shell">
        <header className="cr-topbar aw-topbar">
          <a className="cr-brand" href="/" aria-label="Return to Coloyond home"><WebsiteBrand /></a>
          <div className="cr-topbar-right"><span className="cr-demo-label">CP2a browser fixture</span><button className="cr-reference-link aw-mode-top-button" type="button" onClick={onLocalnetMode}>Switch to Localnet SBF <span aria-hidden="true">↗</span></button><a className="cr-reference-link" href="/">Back to app <span aria-hidden="true">↗</span></a></div>
        </header>

        <main className="aw-main">
          <div className="aw-eyebrow">S2 / CP2a · Browser fixture mode</div>
          <section className="aw-intro">
            <div><p className="cr-eyebrow">coloyond / rebalancing lab</p><h1>Auction, in sequence.</h1><p className="aw-lede">Walk through an eligible auction, a partial fill, a rejected replay, and terminal close. This page rehearses the interaction and state presentation only.</p></div>
            <div className="aw-intro-index"><span>INTERACTIVE FIXTURE</span><strong>01—04</strong><small>No wallet · No RPC · No transaction</small></div>
          </section>

          <section className="aw-truth-banner" aria-label="Simulation notice">
            <span className="aw-truth-mark" aria-hidden="true">!</span>
            <div><strong>SYNTHETIC FIXTURE — NOT ON-CHAIN</strong><p>All balances, oracle states, fills, and results below are scripted in this browser. No Solana cluster is contacted; fixture playback is not evidence that the Anchor program executed.</p></div>
            <span className="aw-network-chip">NO NETWORK</span>
          </section>

          <section className="aw-control-row" aria-label="Fixture controls">
            <label className="aw-scenario-select"><span>01 / Scenario</span><select value={state.scenario} onChange={(event) => setState((current) => setWorkbenchScenario(current, event.target.value as WorkbenchScenario))}>{SCENARIOS.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}</select></label>
            <p>{SCENARIOS.find((scenario) => scenario.id === state.scenario)?.description}</p>
            <button className="aw-reset-button" type="button" onClick={() => setState(createWorkbenchState(state.scenario))}>Reset scenario <span aria-hidden="true">↺</span></button>
          </section>

          <section className="aw-overview" aria-label="Fixture status">
            <article><span>Environment</span><strong>Local fixture</strong><small>synthetic / static</small></article>
            <article><span>Oracle</span><strong>{state.scenario === "stale-oracle" ? "Stale" : "Fixture fresh"}</strong><small>{state.scenario === "stale-oracle" ? "age check fails" : "age is illustrative"}</small></article>
            <article><span>Risk state</span><strong>{state.scenario === "paused" ? "Paused" : "Enabled in fixture"}</strong><small>not read from a vault</small></article>
            <article><span>Auction</span><strong>{phaseLabel(state.phase)}</strong><small>{state.sequence === null ? "no fixture intent" : `sequence ${state.sequence}`}</small></article>
          </section>

          <section className="aw-grid">
            <div className="aw-panel aw-portfolio-panel">
              <div className="aw-panel-heading"><div><span className="aw-index">02 / Fixture portfolio</span><h2>Target and actual</h2></div><span className="aw-sample-tag">SCRIPTED</span></div>
              <p className="aw-panel-copy">Static scenario values show how a fill changes the displayed mix. USD marks and weights are illustrative; no oracle math runs here.</p>
              <div className="aw-assets">
                <AssetRow label="WSOL" target={50} actual={weights.wsol} amountText={`${amount(state.balances.wsol, 1)} WSOL`} />
                <AssetRow label="USDC" target={50} actual={weights.usdc} amountText={`${amount(state.balances.usdc, 0)} USDC`} />
              </div>
              <div className="aw-summary-row"><span>Fixture NAV at $100 / WSOL</span><strong>${amount(state.balances.wsol * 100 + state.balances.usdc, 0)}</strong></div>
              <div className="aw-direction-note"><span aria-hidden="true">↗</span><p>The fixture sells WSOL and receives USDC. Fees, bounty liabilities, confidence intervals, and conservative NAV-loss math are intentionally not modelled in this UI rehearsal.</p></div>
            </div>

            <div className="aw-panel aw-actions-panel">
              <div className="aw-panel-heading"><div><span className="aw-index">03 / Walk the lifecycle</span><h2>Try each step</h2></div><span className="aw-step-count">{state.events.length.toString().padStart(2, "0")} actions</span></div>
              <div className="aw-lifecycle-actions">
                <button type="button" onClick={() => run("start")}>Attempt start <span>01</span></button>
                <button type="button" disabled={!active || state.scenario !== "eligible"} onClick={() => run("partial-fill")}>Apply partial fill <span>02</span></button>
                <button type="button" disabled={state.phase !== "partial" || state.scenario !== "eligible"} onClick={() => run("fill-remaining")}>Fill remaining amount <span>03</span></button>
                <button type="button" disabled={!active} onClick={() => run("expire")}>Force expiry scenario <span>04</span></button>
                <button type="button" disabled={state.phase !== "complete" && state.phase !== "expired"} onClick={() => run("close")}>Close terminal intent <span>05</span></button>
              </div>
              <div className="aw-script-note"><strong>Expected path</strong><span>Ready → open → partial → complete → closed</span></div>
            </div>
          </section>

          <section className="aw-adversarial-panel">
            <div><span className="aw-index">04 / Failure cases</span><h2>Rejected attempts</h2><p>Each control appends a scripted rejection and must preserve the displayed token amounts.</p></div>
            <div className="aw-adversarial-actions">{ACTIONS.map((action) => <button key={action.id} type="button" onClick={() => run(action.id)}>{action.label}<span aria-hidden="true">↗</span></button>)}</div>
          </section>

          <section className="aw-event-panel" aria-labelledby="aw-event-title">
            <div className="aw-panel-heading"><div><span className="aw-index">05 / Local interaction log</span><h2 id="aw-event-title">What happened</h2></div><span className="aw-sample-tag">NOT TRANSACTION LOGS</span></div>
            {state.events.length === 0 ? <p className="aw-empty-state">Choose a scenario and try an action. Synthetic results will appear here; this log has no signatures or slots.</p> : <ol className="aw-events" aria-live="polite">{state.events.map((event) => <li key={event.id} className={event.result === "rejected in fixture" ? "aw-event-rejected" : "aw-event-accepted"}><span className="aw-event-number">{event.id.toString().padStart(2, "0")}</span><div><strong>{event.action}</strong><p>{event.detail}</p></div><span className="aw-event-result">{event.result}</span></li>)}</ol>}
          </section>

          <footer className="aw-footer"><span>CP2a tests interaction and presentation only.</span><span>CP2b requires a Localnet UI connected to the SBF program.</span><a href="/">Return to the sample app ↗</a></footer>
        </main>
      </div>
    </div>
  );
}
