import { WebsiteBrand } from "./Brand.js";
import { useEffect, useState } from "react";
import { ReferenceArt } from "./ReferenceArt.js";
import { PortfolioTokens } from "./portfolio/PortfolioTokens.js";
import { RebalanceDesk } from "./portfolio/RebalanceDesk.js";
import { useRebalanceDesk } from "./portfolio/useRebalanceDesk.js";
import { ConditionStatus } from "./rebalancing/ConditionStatus.js";
import { ConnectButton } from "./wallet/ConnectButton.js";
import {
  FEATURE_FARM,
  FARMS,
  POSITIONS,
  STRATEGY,
  TABS,
  ProductTab,
  driftLabel,
} from "./product.js";

const STUDIES = { Portfolio: "planes", Yield: "slabs" } as const;
const PAGE_COPY: Record<ProductTab, { number: string; eyebrow: string; title: string; description: string }> = {
  Portfolio: {
    number: "01",
    eyebrow: "Managed strategy / Overview",
    title: "Balance, with room to move.",
    description: "One share token, many moving parts. See the intended mix, the illustrated holdings, and the distance between them.",
  },
  Yield: {
    number: "02",
    eyebrow: "Liquidity / Yield",
    title: "Let the useful parts earn.",
    description: "A view of fee earning pools and their terms, alongside the liquidity that makes an exit possible.",
  },
};

function SectionTitle({ index, title, note }: { index: string; title: string; note?: string }) {
  return (
    <div className="cr-section-title">
      <span className="cr-index">{index}</span>
      <div><h2>{title}</h2>{note && <p>{note}</p>}</div>
    </div>
  );
}

export function ColoyondApp() {
  const desk = useRebalanceDesk();
  const [tab, setTab] = useState<ProductTab>("Portfolio");

  const livePositions = POSITIONS.map((position) => {
    const live = desk.byId[position.symbol];
    return live === undefined ? position : { ...position, target: live.targetPct, actual: Math.round(live.weightPct) };
  });
  const drift = desk.drift;
  const health = Math.max(0, 100 - drift * 4);
  const page = PAGE_COPY[tab];
  useEffect(() => { document.title = `coloyond — ${tab}`; }, [tab]);

  return (
    <div className="cr-app">
      <div className="cr-shell">
        <header className="cr-topbar">
          <a className="cr-brand" href="/" aria-label="Coloyond home"><WebsiteBrand /></a>
          <div className="cr-topbar-right"><span className="cr-demo-label">Browser prototype · Sample portfolio</span><a className="cr-reference-link" href="/etf-devnet/transactions" aria-label="Open real Solana Devnet ETF wallet transaction desk">ETF wallet desk <span aria-hidden="true">↗</span></a><a className="cr-reference-link" href="/etf-devnet" aria-label="Open real Solana Devnet ETF read page">Real ETF Devnet read <span aria-hidden="true">↗</span></a><a className="cr-reference-link cr-lab-link" href="/rebalancing-lab">Rebalance lab <span aria-hidden="true">↗</span></a><a className="cr-reference-link" href="/symmetry-devnet">Symmetry Devnet <span aria-hidden="true">↗</span></a><a className="cr-reference-link" href="/reference/index.html">UI reference <span aria-hidden="true">↗</span></a><ConnectButton /></div>
        </header>

        <section className="cr-intro" aria-labelledby="page-title">
          <div className="cr-intro-copy"><p className="cr-eyebrow">coloyond / {page.eyebrow}</p><h1 id="page-title">{page.title}</h1><p className="cr-intro-description">{page.description}</p><div className="cr-intro-meta"><span>{page.number} / 02</span><span>{STRATEGY.name}</span></div></div>
          <div className="cr-hero-art"><ReferenceArt variant={STUDIES[tab]} title={`${STUDIES[tab]} geometric study`} /><span className="cr-art-caption">Visual study / Color expresses composition, not risk.</span></div>
        </section>

        <nav className="cr-nav" aria-label="Product sections">
          {TABS.map((item, index) => <button key={item} type="button" className={tab === item ? "cr-nav-active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => { setTab(item); window.scrollTo({ top: 0, behavior: "smooth" }); }}><span>{String(index + 1).padStart(2, "0")}</span>{item}</button>)}
        </nav>

        <main className="cr-main">
          {tab === "Portfolio" && <>
            <div className="cr-section-grid"><SectionTitle index="A /" title="The strategy at a glance" note="One managed share; distinct facts for value, market, and an indicative exit." /><div className="cr-side-note">{STRATEGY.kind} · {STRATEGY.network}<br />Status in this browser view is illustrative.</div></div>
            <section className="cr-strategy-card" aria-label="Strategy overview">
              <div className="cr-strategy-lead"><span className="cr-kicker">01 / Strategy identity</span><h3>{STRATEGY.name}</h3><p>A composition that can be measured without mistaking its expression for its holdings.</p><div className="cr-share-line"><span>One share token</span><strong>{STRATEGY.share}</strong></div></div>
              <div className="cr-strategy-facts"><div><span>Protocol NAV <small>sample</small></span><strong>{STRATEGY.nav}</strong></div><div><span>Market price <small>sample</small></span><strong>{STRATEGY.market}</strong></div><div><span>Indicative quote <small>sample</small></span><strong>{STRATEGY.quote}</strong></div><p>Separate values. No live vault or executable order is verified here.</p></div>
            </section>
            <section className="cr-portfolio-grid">
              <div className="cr-allocation-block">
                <SectionTitle index="B /" title="Target and actual" note="The desk holds the live target and the live actual mix. APYs are sample." />
                <div className="cr-composition" role="group" aria-label="Portfolio composition comparison">
                  <div className="cr-composition-row">
                    <div className="cr-composition-heading"><span>01 / Saved target</span><strong>100%</strong></div>
                    <div className="cr-composition-track" aria-hidden="true">{livePositions.map((position) => <span key={position.symbol} title={`${position.symbol}: ${position.target}% target`} style={{ flex: position.target, background: position.color }} />)}</div>
                  </div>
                  <div className="cr-composition-row">
                    <div className="cr-composition-heading"><span>02 / Actual mix <em>live in the desk</em></span><strong>100%</strong></div>
                    <div className="cr-composition-track" aria-hidden="true">{livePositions.map((position) => <span key={position.symbol} title={`${position.symbol}: ${position.actual}% actual`} style={{ flex: position.actual, background: position.color }} />)}</div>
                  </div>
                  <p>Each band totals 100%. Colors match the asset rows; change uses percentage points.</p>
                </div>
                <table className="cr-alloc-table">
                  <thead><tr><th scope="col">Asset</th><th scope="col">Target</th><th scope="col">Actual</th><th scope="col">Change</th></tr></thead>
                  <tbody>{livePositions.map((position) => {
                    const delta = position.actual - position.target;
                    return <tr key={position.symbol}>
                      <th scope="row"><span className="cr-asset"><span className="cr-asset-dot" style={{ background: position.color }} /><span><strong>{position.symbol}</strong><small>{position.name}</small><small>{position.utility} · <span className="cr-apy">{position.apy}% APY</span></small></span></span></th>
                      <td>{position.target}%</td><td><strong>{position.actual}%</strong></td><td className="cr-alloc-delta">{delta > 0 ? "+" : ""}{delta} pp</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <aside className="cr-health-panel"><span className="cr-kicker">Portfolio signal / Live demo state</span><div className="cr-health-number">{health}<span>/ 100</span></div><h3>{driftLabel(drift)}</h3><p>Aggregate distance from the saved targets: {drift.toFixed(1)} percentage points, recomputed live from the desk. The label is an illustration, not a risk score.</p><div className="cr-health-rule"><span style={{ width: `${health}%` }} /></div><div className="cr-next-label">Where to next</div><button onClick={() => setTab("Yield")}>Explore yield <span aria-hidden="true">↗</span></button></aside>
            </section>
            <RebalanceDesk desk={desk} />
            <ConditionStatus />
            <PortfolioTokens sectionIndex="D /" />
          </>}

          {tab === "Yield" && <>
            <div className="cr-section-grid"><SectionTitle index="A /" title="Every pool in view" note="All fee earning pools with their terms; the first is featured." /><div className="cr-side-note">Rates and TVL below are example data. No live staking transaction is connected.</div></div>
            <div className="cr-farm-list">{[FEATURE_FARM, ...FARMS].map((farm, index) => <article className="cr-farm-row" key={farm.name}><span className="cr-index">{String(index + 1).padStart(2, "0")}</span>{index === 0 && <span className="cr-farm-feature">Featured</span>}<div className="cr-farm-identity"><h3>{farm.name}</h3><p>{farm.pool} · {farm.note}</p></div><div><span>Sample APY</span><strong>{farm.apy}</strong></div><div><span>TVL / Lock</span><strong>{farm.tvl} / {farm.lock}</strong></div><em>{farm.status}</em></article>)}</div>
            <div className="cr-crosslink"><span>Pools belong to the strategy you manage above.</span><button onClick={() => setTab("Portfolio")}>Back to portfolio <span aria-hidden="true">↗</span></button></div>
          </>}
        </main>
        <footer className="cr-footer"><span>coloyond / A managed strategy, open to interpretation.</span><span>Browser prototype · Sample portfolio · Symmetry comparison is read only</span><a href="/reference/index.html">View original UI reference ↗</a></footer>
      </div>
    </div>
  );
}
