// The Portfolio tab's rebalance desk: the drift check, an interactive
// allocation editor, the trade preview, and a simulated run that stands in
// for a keeper. Numbers come from the pure engine in rebalance.ts; this file
// only draws them, drags them and calls the desk's actions. A market-move
// button plays the part of prices, and the fee reflow into the reserve
// follows the YieldBasis idea.
import type * as React from "react";
import { useRef, useState } from "react";
import { DESK_STEPS, type RebalanceDeskView } from "./useRebalanceDesk.js";
import { RESERVE_SHARE, fmtUsd, round1, sharesForSet, sharesForTransfer } from "./rebalance.js";
import { EtfLiveSection } from "./EtfLiveSection.js";

function DeskSection({ area, index, title, children }: { area: string; index: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`cr-desk-section ${area}`}>
      <span className="cr-kicker">{index} / {title}</span>
      {children}
    </div>
  );
}

// The percent text field keeps a local draft while typing, so mid-edit
// values like an empty box never break the strict total; blur or Enter
// commits through the engine's share algebra and the whole row resyncs.
function TargetField({ desk, symbol, pct, locked }: { desk: RebalanceDeskView; symbol: string; pct: number; locked: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const parsed = Number(raw);
    if (!locked && raw.trim() !== "" && Number.isFinite(parsed)) {
      for (const share of sharesForSet(desk.assets, symbol, parsed, desk.lockedSymbols)) desk.setTarget(share.symbol, share.targetPct);
    }
  };
  return (
    <span className="cr-input-suffix">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        disabled={locked}
        aria-label={`Target percent for ${symbol}`}
        value={draft ?? String(pct)}
        onFocus={() => setDraft(String(pct))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(null);
        }}
      />
      <span>%</span>
    </span>
  );
}

// The interactive allocation editor: one composite bar per basket with a
// draggable handle on every boundary, ghosted live-allocation segments and
// lines behind it, and per-asset slider and text field that all commit
// through the same share algebra, so the shares always total 100%.
function AllocationEditor({ desk }: { desk: RebalanceDeskView }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ leftSymbol: string; rightSymbol: string; startX: number; startLeft: number; pair: number } | null>(null);
  const total = Math.max(1, desk.targetsTotal);
  const clampPct = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
  let targetCursor = 0;
  const targetBars = desk.assets.map((asset) => {
    const width = (clampPct(asset.targetPct) / total) * 100;
    targetCursor += width;
    return { asset, width, end: targetCursor };
  });
  let liveCursor = 0;
  const liveBars = desk.weights.map((weight, index) => {
    liveCursor += Math.min(100, Math.max(0, weight));
    return { symbol: desk.assets[index]?.symbol ?? `share-${index}`, end: liveCursor };
  });
  const commitShares = (shares: { symbol: string; targetPct: number }[]) => shares.forEach((share) => desk.setTarget(share.symbol, share.targetPct));
  const isLocked = (symbol: string) => desk.lockedSymbols.includes(symbol);
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>, leftIndex: number) => {
    const pairTotal = desk.assets[leftIndex].targetPct + desk.assets[leftIndex + 1].targetPct;
    if (!barRef.current || pairTotal <= 0 || isLocked(desk.assets[leftIndex].symbol) || isLocked(desk.assets[leftIndex + 1].symbol)) return;
    dragRef.current = {
      leftSymbol: desk.assets[leftIndex].symbol,
      rightSymbol: desk.assets[leftIndex + 1].symbol,
      startX: event.clientX,
      startLeft: desk.assets[leftIndex].targetPct,
      pair: pairTotal,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const bar = barRef.current;
    if (!drag || !bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const current = desk.assets.find((asset) => asset.symbol === drag.leftSymbol)?.targetPct ?? 0;
    const dragged = drag.startLeft + (((event.clientX - drag.startX) / rect.width) * 100);
    const nextLeft = Math.max(0, Math.min(drag.pair, Math.round(dragged)));
    if (nextLeft !== current) commitShares(sharesForTransfer(desk.assets, drag.leftSymbol, drag.rightSymbol, nextLeft, desk.lockedSymbols));
  };
  const endPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };
  const onBoundaryKey = (event: React.KeyboardEvent<HTMLButtonElement>, leftIndex: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    commitShares(sharesForTransfer(desk.assets, desk.assets[leftIndex].symbol, desk.assets[leftIndex + 1].symbol, desk.assets[leftIndex].targetPct + step, desk.lockedSymbols));
  };
  return (
    <div className="cr-desk-allocation">
      <div className="cr-desk-allocation-bar" ref={barRef}>
        <div className="cr-desk-allocation-ghost" aria-hidden="true">
          {liveBars.map((bar) => (bar.end > 0 && bar.end < 100 ? <span key={`line-${bar.symbol}`} data-allocation-ghost-line={bar.symbol} style={{ left: `${bar.end}%` }} /> : null))}
        </div>
        {targetBars.map(({ asset, width }) => (
          <span key={asset.symbol} data-allocation-segment={asset.symbol} title={`${asset.symbol} target ${asset.targetPct}%`} style={{ width: `${width}%`, background: asset.color }} />
        ))}
        {desk.assets.slice(0, -1).map((leftAsset, index) => {
          const rightAsset = desk.assets[index + 1];
          const pairTotal = leftAsset.targetPct + rightAsset.targetPct;
          return (
            <button
              key={`${leftAsset.symbol}>${rightAsset.symbol}`}
              className="cr-desk-allocation-handle"
              data-allocation-handle={`${leftAsset.symbol}|${rightAsset.symbol}`}
              type="button"
              role="slider"
              disabled={isLocked(leftAsset.symbol) || isLocked(rightAsset.symbol)}
              aria-label={`Drag to move share between ${leftAsset.symbol} and ${rightAsset.symbol}`}
              aria-valuemin={0}
              aria-valuemax={pairTotal}
              aria-valuenow={leftAsset.targetPct}
              aria-valuetext={`${leftAsset.symbol} ${leftAsset.targetPct}%, ${rightAsset.symbol} ${rightAsset.targetPct}%`}
              style={{ left: `${targetBars[index].end}%` }}
              onPointerDown={(event) => onPointerDown(event, index)}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onKeyDown={(event) => onBoundaryKey(event, index)}
            />
          );
        })}
      </div>
      <div className="cr-desk-targets">
        {desk.assets.map((asset, index) => {
          const livePp = round1(Math.min(100, Math.max(0, desk.weights[index] ?? 0)) - asset.targetPct);
          const shareTrack = `linear-gradient(to right, ${asset.color} 0%, ${asset.color} ${clampPct(asset.targetPct)}%, var(--field) ${clampPct(asset.targetPct)}%, var(--field) 100%)`;
          return (
            <label className="cr-desk-target" key={asset.symbol}>
              <span className="cr-pt-dot" style={{ background: asset.color }} />
              <span className="cr-desk-target-name"><strong>{asset.symbol}</strong><small>{asset.name} · {fmtUsd(asset.valueUsd)}</small></span>
              <input
                className="cr-desk-slider-input"
                type="range"
                min={0}
                max={100}
                step={1}
                disabled={isLocked(asset.symbol)}
                value={clampPct(asset.targetPct)}
                style={{ "--cr-split-track": shareTrack } as React.CSSProperties}
                aria-label={`Target slider for ${asset.symbol}`}
                onChange={(event) => commitShares(sharesForSet(desk.assets, asset.symbol, Number(event.target.value), desk.lockedSymbols))}
              />
              <span className="cr-desk-target-delta">{livePp === 0 ? "on live" : `${livePp > 0 ? "+" : ""}${livePp} pp`}</span>
              <TargetField desk={desk} symbol={asset.symbol} pct={asset.targetPct} locked={isLocked(asset.symbol)} />
              <button type="button" className="cr-desk-lock" aria-pressed={isLocked(asset.symbol)} onClick={() => desk.toggleLocked(asset.symbol)}>{isLocked(asset.symbol) ? "locked" : "lock"}</button>
            </label>
          );
        })}
      </div>
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
      <EtfLiveSection />
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
          <AllocationEditor desk={desk} />
          <div className="cr-pt-total"><span>Targets total {targetsValid ? "exactly 100%" : `of ${desk.targetsTotal}%`}</span><strong>{desk.targetsTotal}%</strong></div>
          <div className="cr-desk-target-tools">
            <button className="cr-pt-reset" disabled={running} onClick={desk.matchLive}>match live weights</button>
            <button className="cr-pt-remove" disabled={running || !desk.canUndo} onClick={desk.undo}>undo edit</button>
          </div>
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
