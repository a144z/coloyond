// The Portfolio tab's rebalance desk: the drift check, editable targets, the
// trade preview, and a simulated run that stands in for a keeper. Numbers
// come from the pure engine in rebalance.ts; this file only draws them and
// calls the desk's actions. A market-move button plays the part of prices,
// and the fee reflow into the reserve follows the YieldBasis idea.
import type * as React from "react";
import { DESK_STEPS, type RebalanceDeskView } from "./useRebalanceDesk.js";
import { RESERVE_SHARE, fmtUsd } from "./rebalance.js";

function DeskSection({ area, index, title, children }: { area: string; index: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`cr-desk-section ${area}`}>
      <span className="cr-kicker">{index} / {title}</span>
      {children}
    </div>
  );
}

export function RebalanceDesk({ desk }: { desk: RebalanceDeskView }) {
  const running = desk.phase === "running";
  const atTarget = desk.plan.legs.length === 0;
  const targetsValid = desk.targetsTotal === 100;
  const driftBarWidth = Math.max(2, Math.min(100, desk.drift * 6));

  return (
    <>
      <div className="cr-section-grid cr-section-spaced">
        <div className="cr-section-title">
          <span className="cr-index">C /</span>
          <div><h2>The rebalance desk</h2><p>Drift is live arithmetic over the sample basket. Targets can be edited, the trades are simulated, and the fee share stays in a sample reserve.</p></div>
        </div>
        <div className="cr-side-note">The desk plays the keeper's part in the browser. No swap is signed, and a real vault may use its own rules and fee split.</div>
      </div>
      <section className="cr-desk" aria-label="Rebalance desk">
        <DeskSection area="cr-desk-drift" index="01" title="Drift check · live">
          <div className="cr-desk-number">{desk.drift}<span> pp from target</span></div>
          <p>{desk.drift > desk.triggerPp ? <><strong>Over the {desk.triggerPp} pp trigger.</strong> A keeper would act here; the desk can act on the tap below.</> : <>Within the {desk.triggerPp} pp trigger. The desk would let this basket ride.</>}</p>
          <div className="cr-health-rule"><span style={{ width: `${driftBarWidth}%` }} /></div>
          <label className="cr-desk-trigger">Trigger
            <span className="cr-input-suffix"><input inputMode="decimal" aria-label="Drift trigger in percentage points" value={desk.triggerPp} onChange={(event) => desk.setTriggerPp(Number(event.target.value))} /><span>pp</span></span>
          </label>
          <p className="cr-desk-note">Basket at sample values: {fmtUsd(desk.totalUsd)}. The market-move button below moves the basket as prices would.</p>
        </DeskSection>
        <DeskSection area="cr-desk-targets-block" index="02" title="Target weights">
          <div className="cr-desk-targets">
            {desk.assets.map((asset) => (
              <label className="cr-desk-target" key={asset.symbol}>
                <span className="cr-pt-dot" style={{ background: asset.color }} />
                <span className="cr-desk-target-name"><strong>{asset.symbol}</strong><small>{asset.name} · {fmtUsd(asset.valueUsd)}</small></span>
                <span className="cr-input-suffix"><input type="number" inputMode="numeric" min={0} max={100} step={1} aria-label={`Target percent for ${asset.symbol}`} value={asset.targetPct} onChange={(event) => desk.setTarget(asset.symbol, Number(event.target.value))} /><span>%</span></span>
              </label>
            ))}
          </div>
          <div className="cr-pt-total"><span>Targets total {targetsValid ? "exactly 100%" : `of ${desk.targetsTotal}%`}</span><strong>{desk.targetsTotal}%</strong></div>
          {!targetsValid && <p className="cr-error">Targets must total exactly 100% before the desk will swap. <button className="cr-pt-reset" onClick={desk.normalizeTargets}>normalize to 100</button></p>}
        </DeskSection>
        <DeskSection area="cr-desk-plan" index="03" title="Trades to restore target">
          {atTarget ? <p className="cr-desk-quiet">{targetsValid ? "The basket already sits on target. No trades are planned." : "Fix the targets to a 100% total to see the planned trades."}</p> : (
            <table className="cr-desk-legs">
              <thead><tr><th scope="col">Leg</th><th scope="col">Sell</th><th scope="col">Fee · net</th></tr></thead>
              <tbody>{desk.plan.legs.map((leg, index) => <tr key={`${leg.fromSymbol}>${leg.toSymbol}-${index}`}><th scope="row">{leg.fromSymbol} <span aria-hidden="true">→</span> {leg.toSymbol}</th><td>{fmtUsd(leg.sellUsd)}</td><td>{fmtUsd(leg.feeUsd)} · {fmtUsd(leg.netUsd)}</td></tr>)}</tbody>
            </table>
          )}
          {!atTarget && <p className="cr-desk-note">Fee total {fmtUsd(desk.plan.totalFeeUsd)}; {Math.round(RESERVE_SHARE * 100)}% ({fmtUsd(desk.plan.reserveUsd)}) reflows into the reserve and {100 - Math.round(RESERVE_SHARE * 100)}% ({fmtUsd(desk.plan.payoutUsd)}) is the payout share.</p>}
        </DeskSection>
        <DeskSection area="cr-desk-run" index="04" title="Run the desk">
          <div className="cr-desk-actions">
            <button className="cr-primary" disabled={running || !targetsValid || atTarget} onClick={desk.rebalanceNow}>Rebalance now <span aria-hidden="true">↗</span></button>
            <button className="cr-pt-remove" disabled={running} onClick={desk.simulateMarket}>Simulate a market move</button>
            <button className="cr-pt-reset" disabled={running} onClick={desk.resetBasket}>reset basket</button>
          </div>
          {running && <ol className="cr-desk-steps">{DESK_STEPS.map((step, index) => <li key={step} className={index <= desk.stepIndex ? "cr-desk-step-on" : undefined}>{step}</li>)}</ol>}
          {/* Always mounted, so screen readers announce each new message. */}
          <p className="cr-pt-status" role="status" aria-atomic="true">{desk.status ?? ""}</p>
        </DeskSection>
        <aside className="cr-desk-reserve">
          <span className="cr-kicker">Reserve and history / Sample</span>
          <div className="cr-desk-reserve-number">{desk.reserveUsd === 0 ? "—" : fmtUsd(desk.reserveUsd)}</div>
          <p>Rebalanced {desk.runs} time{desk.runs === 1 ? "" : "s"} in this desk. The reserve is where the YieldBasis idea puts the fee share: money kept for future rebalancing.</p>
          {desk.log.length > 0 && <ul className="cr-desk-log">{desk.log.map((entry) => <li key={entry.id}>{entry.text}</li>)}</ul>}
        </aside>
      </section>
    </>
  );
}
