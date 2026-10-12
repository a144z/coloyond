// The live section of the portfolio desk: the vault registry (every accepted
// Devnet pool), its verified drift and oracle state, and one manual poke per
// pool. Server-side it renders nothing: the wallet and IndexedDB contexts
// exist only in the browser.
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { ConnectButton } from "../wallet/ConnectButton.js";
import { useEtfLiveDesk, type EtfLiveDeskView, type EtfLivePoolView } from "./useEtfLiveDesk.js";
import { planRebalanceSwap } from "./etfLiveDesk.js";
import "../etf/devnet-read.css";

function Tag({ tone, children }: { tone: "neutral" | "good" | "warn" | "bad"; children: ReactElement | string }) {
  return <span className={`etf-tag etf-tag-${tone}`}>{children}</span>;
}

function describePhase(view: EtfLiveDeskView): { tone: "neutral" | "good" | "warn" | "bad"; label: string } {
  if (view.phase === "loading") return { tone: "neutral", label: "Checking deployment" };
  if (view.phase === "genesis_mismatch") return { tone: "bad", label: "Genesis mismatch" };
  if (view.phase === "unreachable") return { tone: "neutral", label: "RPC unreachable" };
  if (view.phase === "awaiting_deployment") return { tone: "warn", label: "Awaiting accepted deployment" };
  return view.pools.some((pool) => pool.live !== null)
    ? { tone: "good", label: `Live Devnet pools (${view.pools.length})` }
    : { tone: "warn", label: "Deployment admitted; pool readback failing" };
}

function blockedReason(view: EtfLiveDeskView, pool: EtfLivePoolView): string | null {
  if (view.phase !== "ready" || pool.live === null) return "A verified Devnet pool snapshot is required before a poke.";
  if (view.wallet === null) return "Connect a wallet to sign the eligibility poke.";
  if (pool.live.pokeBlockedReason !== null) return pool.live.pokeBlockedReason.replaceAll("_", " ");
  return null;
}

function PoolCard({ view, pool }: { view: EtfLiveDeskView; pool: EtfLivePoolView }) {
  const live = pool.live;
  const short = `${pool.pool.slice(0, 4)}…`;
  const label = Array.isArray(((pool.context.manifest as unknown) as { assetLabels?: unknown }).assetLabels)
    ? (((pool.context.manifest as unknown) as { assetLabels: readonly string[] }).assetLabels).join(" / ")
    : null;
  if (live === null) {
    return (
      <div className="etf-balance-list" key={pool.pool}>
        <div className="etf-balance-row"><div><strong>{label ?? "ETF pool"} · {short}</strong><small>{pool.snapshotError ?? "Pool readback unavailable"} — the readback stays the single source of pool facts; no number is assumed.</small></div></div>
      </div>
    );
  }
  const blocked = blockedReason(view, pool);
  const swap = pool.snapshot === null ? { plan: null as ReturnType<typeof planRebalanceSwap>["plan"], reason: "snapshot_unavailable" } : planRebalanceSwap(pool.context, pool.snapshot);
  const swapAccountsReady = swap.plan === null || [swap.plan.assetIn, swap.plan.assetOut].every((index) => pool.snapshot?.wallet?.tokenAccounts.some((row) => row.mint === pool.snapshot!.assets[index]!.mint && !row.frozen) ?? false);
  const swapBlocked = view.wallet === null ? "Connect a wallet to fund the swap." : swap.plan === null ? swap.reason.replaceAll("_", " ") : !swapAccountsReady ? "Create an unfrozen token account for every asset first; the transaction desk does this." : null;
  const human = (value: bigint, decimals: number) => (Number(value) / 10 ** decimals).toPrecision(6);
  return (
    <>
      <dl className="etf-fields" key={`${pool.pool}:fields`}>
        <div><dt>Pool</dt><dd>{label ?? "ETF pool"} <small>{short}</small></dd></div>
        <div><dt>On-chain drift</dt><dd>{live.driftPct === null ? <span><Tag tone="warn">not computable</Tag> <small>{live.driftReason?.replaceAll("_", " ") ?? "reason unavailable"}</small></span> : <strong className="etf-amount">{live.driftPct}% total-variation ({live.driftBps} bps)</strong>}</dd></div>
        <div><dt>Pool state</dt><dd><Tag tone={live.lifecycle === "active" && !live.riskPaused ? "good" : "warn"}>{live.riskPaused ? "risk paused" : live.lifecycle}</Tag> <small>On-chain scheduler {live.schedulerEnabled ? "enabled" : "disabled"}, generation {live.schedulerGeneration}</small></dd></div>
        <div><dt>Last eligibility observation</dt><dd>{live.lastObservation === null ? <Tag tone="warn">none stored</Tag> : <><Tag tone={live.lastObservation.eligible ? "good" : "warn"}>{live.lastObservation.eligible ? "eligible" : "not eligible"}</Tag> <small>{live.lastObservation.deviationBps} bps recorded at slot {live.lastObservation.slot}</small></>}</dd></div>
        <div><dt>Rebalance preview</dt><dd>{live.rebalance === null ? <><Tag tone="warn">unavailable</Tag> <small>{live.rebalanceReason?.replaceAll("_", " ") ?? "reason unavailable"}</small></> : <small>{live.rebalance.moves.length === 0 ? "on target, nothing to move" : live.rebalance.moves.map((move) => `${move.direction === "in" ? "pool takes" : "pool gives"} ${move.amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ${move.label} (~$${Math.round(move.usd)})`).join(" · ")} · correction fee tier {live.rebalance.feeTierBps} bps ({live.rebalance.feePct}%); the on-chain move runs as the funded swap, the crank's poke records eligibility.</small>}</dd></div>
        <div><dt>Rebalance swap</dt><dd><button className="etf-refresh" type="button" disabled={swapBlocked !== null || view.busy} onClick={() => void view.swapNow(pool.pool)}>{view.busy ? "Waiting for RPC…" : "Run this swap"}<span aria-hidden="true">↗</span></button> <small>{swapBlocked ?? `${human(swap.plan!.amountIn, pool.snapshot!.assets[swap.plan!.assetIn]!.decimals)} ${pool.snapshot!.assets[swap.plan!.assetIn]!.label} in, at least ${human(swap.plan!.minAmountOut, pool.snapshot!.assets[swap.plan!.assetOut]!.decimals)} ${pool.snapshot!.assets[swap.plan!.assetOut]!.label} out; pairwise, one pair per tap.`}</small></dd></div>
      </dl>
      <div className="etf-balance-list" key={`${pool.pool}:assets`}>
        {live.assets.map((row, index) => {
          const asset = pool.snapshot!.assets[index]!;
          return (
            <div className="etf-balance-row" key={asset.mint}>
              <div>
                <strong>{row.label}{row.backing === "synthetic_unbacked" ? " · synthetic / unbacked" : ""}</strong>
                <small>Custody {row.custodyAmount} base units · target {row.targetPct}%{row.livePct === null ? "" : ` · holding ${row.livePct}%`}</small>
              </div>
              <div>
                <Tag tone={row.feedReady ? "good" : "warn"}>{row.freshness === "within_approved_limits" ? "in limits" : row.freshness.replaceAll("_", " ")}</Tag>
                <small>{row.verification === "full" ? "Full" : row.verification} · age {row.ageSeconds ?? "?"}s · confidence {row.confidenceBpsCeil ?? "?"} bps · accepted ≤60s ≤100bps</small>
              </div>
            </div>
          );
        })}
      </div>
      <div className="etf-balance-list" key={`${pool.pool}:poke`}>
        <div className="etf-balance-row">
          <div>
            <strong>Eligibility poke</strong>
            <small>Permissionless and eligibility-only: it records an observation, never a swap. Tokens move on the trader-funded swap. The MagicBlock crank is the no-backend caller; this button is the manual one.</small>
          </div>
          <div>
            <button className="etf-refresh" type="button" disabled={blocked !== null || view.busy} onClick={() => void view.pokeNow(pool.pool)}>
              {view.busy ? "Waiting for RPC…" : "Poke the pool"}<span aria-hidden="true">↗</span>
            </button>
            <small>{blocked ?? (live.lastObservation !== null ? `Last observation says ${live.lastObservation.eligible ? "eligible" : "not eligible"} at ${live.lastObservation.deviationBps} bps; the poke will record a newer one.` : "No eligibility observation is stored yet; this poke would record the pool's first one.")}</small>
            {view.notice ? <small>{view.notice}</small> : null}
          </div>
        </div>
      </div>
    </>
  );
}

function Inner() {
  const view = useEtfLiveDesk();
  useEffect(() => {
    const timer = window.setInterval(() => void view.refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [view.refresh]);
  const status = describePhase(view);
  return (
    <section className="etf-card tx-scheduler-card" aria-label="Live ETF state">
      <div className="etf-section-head">
        <div><p className="etf-eyebrow">Live · the desk's own Devnet read</p><h3>Pool state, drift, and one manual poke</h3></div>
        <div><Tag tone={status.tone}>{status.label}</Tag></div>
      </div>
      {view.phase !== "ready" ? <p className="etf-reason">{view.phase === "genesis_mismatch" ? `The configured RPC does not serve the pinned Devnet genesis (got ${view.reason ?? "no answer"}).` : `No signing can happen from this desk yet: ${view.reason ?? "deployment state unreadable"}. The sample desk below stays the demo.`}</p> : null}
      {view.phase === "ready" && view.rejected.length > 0 ? <p className="etf-reason">Registry entries still rejected: {view.rejected.map((entry) => `${entry.label}: ${entry.reason}`).join(" · ")}</p> : null}
      {view.verbs !== null ? (
        <dl className="etf-fields">
          <div><dt>Automatic rebalance</dt><dd><small><Tag tone="warn">execution unavailable</Tag> No verified token-moving keeper route is deployed. A poke or scheduler entry alone does not execute a swap.</small></dd></div>
          <div><dt>Edit portfolio targets</dt><dd>{view.verbs.setTargets !== null ? <small>The verified IDL exposes "{view.verbs.setTargets}".</small> : <small><Tag tone="warn">pending in the program</Tag> targets are fixed at initialization, so an edit means a new pool for now.</small>}</dd></div>
          <div><dt>Destroy a pool</dt><dd>{view.verbs.close !== null ? <small>The verified IDL exposes "{view.verbs.close}".</small> : <small><Tag tone="warn">pending in the program</Tag> no close instruction exists yet, so destroying a pool is planned.</small>}</dd></div>
        </dl>
      ) : null}
      {view.phase === "ready" && view.pools.length === 0 ? <p className="etf-reason">The registry holds no accepted pool yet.</p> : null}
      {view.pools.map((pool) => <PoolCard view={view} pool={pool} key={pool.pool} />)}
      <p className="etf-callout">Every figure above is re-read from RPC through the verified snapshot; nothing here is simulated. The full initialize, seed, deposit, redeem, swap, and pause surface lives on the transaction desk.</p>
      <div className="etf-topbar-actions"><a className="cr-reference-link" href="/etf-devnet/transactions">ETF transaction desk ↗</a><ConnectButton /></div>
      <div><button className="etf-refresh" type="button" disabled={view.busy} onClick={() => void view.refresh()}>Refresh live state<span aria-hidden="true">↗</span></button></div>
    </section>
  );
}

export function EtfLiveSection() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return <Inner />;
}
