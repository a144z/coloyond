import { useEffect, useRef, useState } from "react";
import { CHAINS } from "./data.js";
import { symbolsOn } from "../tokenmap.js";
import { Route } from "../types.js";
import { fetchRoutes } from "../routeService.js";
import { ReferenceArt } from "./ReferenceArt.js";
import { PortfolioTokens } from "./portfolio/PortfolioTokens.js";
import {
  ECOSYSTEM,
  FEATURE_FARM,
  FARMS,
  GAMBLE_OUTCOMES,
  GambleOutcome,
  HOOK_CARDS,
  PILLARS,
  POSITIONS,
  QUESTS,
  SAMPLE_ROUTES,
  SHIELD_MODES,
  STRATEGY,
  TABS,
  WALLET,
  ProductTab,
  ShieldMode,
  driftLabel,
} from "./product.js";

const SHIELD_CHAINS = CHAINS.filter((chain) => chain.id !== 0);
const STUDIES = { Portfolio: "planes", Shield: "orbit", Yield: "slabs", Ecosystem: "planes", Game: "orbit" } as const;
const PAGE_COPY: Record<ProductTab, { number: string; eyebrow: string; title: string; description: string }> = {
  Portfolio: {
    number: "01",
    eyebrow: "Managed strategy / Overview",
    title: "Balance, with room to move.",
    description: "One share token, many moving parts. See the intended mix, the illustrated holdings, and the distance between them.",
  },
  Shield: {
    number: "02",
    eyebrow: "Route studio / Transaction prep",
    title: "A clear route through complexity.",
    description: "Set the path, compare providers, and keep the risk checks visible before any financial action.",
  },
  Yield: {
    number: "03",
    eyebrow: "Liquidity / Yield",
    title: "Let the useful parts earn.",
    description: "A view of fee earning pools and their terms, alongside the liquidity that makes an exit possible.",
  },
  Ecosystem: {
    number: "04",
    eyebrow: "System / How it fits",
    title: "Every part has a part to play.",
    description: "A managed share starts the story. Routing, liquidity, rewards, and expression follow in that order.",
  },
  Game: {
    number: "05",
    eyebrow: "Participation / Progress",
    title: "Progress has its own rhythm.",
    description: "A local preview of useful actions, small milestones, and an optional roll kept separate from strategy returns.",
  },
};
const COMPOSITION_COLORS = ["#1249ed", "#ffd523", "#8d25d9", "#ff513b"];

function SectionTitle({ index, title, note }: { index: string; title: string; note?: string }) {
  return (
    <div className="cr-section-title">
      <span className="cr-index">{index}</span>
      <div><h2>{title}</h2>{note && <p>{note}</p>}</div>
    </div>
  );
}

function ChainField({ label, value, onChange }: { label: string; value: number; onChange: (chain: number) => void }) {
  return (
    <label className="cr-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {SHIELD_CHAINS.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}
      </select>
    </label>
  );
}

function RouteCard({ route, selected, sample }: { route: Route; selected: boolean; sample: boolean }) {
  const eta = route.totalTimeSeconds <= 0 ? "Not reported" : route.totalTimeSeconds < 60 ? `~${route.totalTimeSeconds}s` : `~${Math.round(route.totalTimeSeconds / 60)}m`;
  const lastStep = route.steps[route.steps.length - 1];
  return (
    <article className={`cr-route ${selected ? "cr-route-selected" : ""}`}>
      <div className="cr-route-head">
        <span className="cr-route-number">{selected ? "01 / Preferred view" : "Alternative"}</span>
        <span className="cr-tag">{sample ? "Sample" : "Provider result"}</span>
      </div>
      <div className="cr-route-main"><h3>{route.provider}</h3><strong>{route.outputAmount} <small>{lastStep?.toSymbol}</small></strong></div>
      <div className="cr-route-steps">{route.steps.map((step, index) => <span key={`${route.id}-${index}`}>{step.protocol} · {step.fromSymbol} → {step.toSymbol}</span>)}</div>
      <div className="cr-route-facts"><span>Fee <b>{route.totalFeeUsd > 0 ? `$${route.totalFeeUsd.toFixed(2)}` : "Not reported"}</b></span><span>Time <b>{eta}</b></span><span>Atomicity <b>{route.atomicLevel}</b></span></div>
    </article>
  );
}

export function ColoyondApp() {
  const routeRequestVersion = useRef(0);
  const [tab, setTab] = useState<ProductTab>("Portfolio");
  const [fromChain, setFromChain] = useState(42161);
  const [toChain, setToChain] = useState(10);
  const [fromToken, setFromToken] = useState("ETH");
  const [toToken, setToToken] = useState("USDC");
  const [amount, setAmount] = useState("1.0");
  const [slippage, setSlippage] = useState(0.5);
  const [mode, setMode] = useState<ShieldMode>(SHIELD_MODES[0]);
  const [routes, setRoutes] = useState<Route[]>(SAMPLE_ROUTES);
  const [routeSource, setRouteSource] = useState<"sample" | "provider">("sample");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gamble, setGamble] = useState<GambleOutcome | null>(null);
  const [boostXp, setBoostXp] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());

  const fromOptions = symbolsOn(fromChain);
  const toOptions = symbolsOn(toChain);
  const drift = POSITIONS.reduce((sum, position) => sum + Math.abs(position.target - position.actual), 0);
  const health = Math.max(0, 100 - drift * 4);
  const completed = QUESTS.filter((quest) => done.has(quest.id));
  const questXp = completed.reduce((sum, quest) => sum + quest.reward, 0);
  const rank = health > 80 ? "Builder" : health > 65 ? "Steward" : "Watch";
  const numAmount = Number(amount);
  const canPrepare = Number.isFinite(numAmount) && numAmount > 0 && fromOptions.length > 0 && toOptions.length > 0;
  const page = PAGE_COPY[tab];
  useEffect(() => { document.title = `coloyond — ${tab}`; }, [tab]);
  const orderedRoutes = [...routes].sort((a, b) => {
    const priority = (route: Route) => mode === "v4 hook lock"
      ? (route.atomicLevel === "full" ? 1 : 0)
      : mode === "aggregator split"
        ? (/LI\.FI|split/i.test(route.provider) ? 1 : 0)
        : (/deBridge|intent/i.test(route.provider) ? 1 : 0);
    return priority(b) - priority(a) || b.outputAmountNum - a.outputAmountNum;
  }).slice(0, 3);

  const resetRoutePreview = () => {
    routeRequestVersion.current += 1;
    setLoading(false);
    setRoutes(SAMPLE_ROUTES);
    setRouteSource("sample");
    setError(null);
  };
  const updateFromChain = (chain: number) => {
    const options = symbolsOn(chain);
    setFromChain(chain);
    setFromToken(options.includes(fromToken) ? fromToken : (options[0] ?? "ETH"));
    resetRoutePreview();
  };
  const updateToChain = (chain: number) => {
    const options = symbolsOn(chain);
    setToChain(chain);
    setToToken(options.includes(toToken) ? toToken : (options[0] ?? "ETH"));
    resetRoutePreview();
  };
  const prepareShieldRoute = async () => {
    if (!canPrepare) { setError("Enter a positive amount and select supported tokens."); return; }
    const requestVersion = ++routeRequestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRoutes({ fromChain, toChain, fromToken, toToken, amount, slippage });
      if (requestVersion !== routeRequestVersion.current) return;
      if (result.routes.length > 0) { setRoutes(result.routes); setRouteSource("provider"); }
      else { resetRoutePreview(); setError(result.error ?? "No provider route found for this pair."); }
    } catch (caught) {
      if (requestVersion !== routeRequestVersion.current) return;
      resetRoutePreview();
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { if (requestVersion === routeRequestVersion.current) setLoading(false); }
  };
  const toggleQuest = (id: string) => setDone((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const rollGamble = () => {
    if (gamble) return;
    const roll = Math.random();
    const outcome = roll < 0.38 ? GAMBLE_OUTCOMES[0] : roll < 0.62 ? GAMBLE_OUTCOMES[1] : roll < 0.82 ? GAMBLE_OUTCOMES[2] : GAMBLE_OUTCOMES[3];
    setGamble(outcome);
    setBoostXp(outcome.xp);
  };

  return (
    <div className="cr-app">
      <div className="cr-shell">
        <header className="cr-topbar">
          <a className="cr-brand" href="/" aria-label="coloyond home">coloyond<span className="cr-brand-mark" aria-hidden="true">✳</span></a>
          <div className="cr-topbar-right"><span className="cr-demo-label">Browser prototype · Sample portfolio</span><a className="cr-reference-link cr-lab-link" href="/rebalancing-lab">Rebalance lab <span aria-hidden="true">↗</span></a><a className="cr-reference-link" href="/reference/index.html">UI reference <span aria-hidden="true">↗</span></a></div>
        </header>

        <section className="cr-intro" aria-labelledby="page-title">
          <div className="cr-intro-copy"><p className="cr-eyebrow">coloyond / {page.eyebrow}</p><h1 id="page-title">{page.title}</h1><p className="cr-intro-description">{page.description}</p><div className="cr-intro-meta"><span>{page.number} / 05</span><span>{STRATEGY.name}</span></div></div>
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
                <SectionTitle index="B /" title="Target and actual" note="Saved target versus sample holdings. APYs are sample." />
                <div className="cr-composition" role="group" aria-label="Portfolio composition comparison">
                  <div className="cr-composition-row">
                    <div className="cr-composition-heading"><span>01 / Saved target</span><strong>100%</strong></div>
                    <div className="cr-composition-track" aria-hidden="true">{POSITIONS.map((position) => <span key={position.symbol} title={`${position.symbol}: ${position.target}% target`} style={{ flex: position.target, background: position.color }} />)}</div>
                  </div>
                  <div className="cr-composition-row">
                    <div className="cr-composition-heading"><span>02 / Actual mix <em>sample</em></span><strong>100%</strong></div>
                    <div className="cr-composition-track" aria-hidden="true">{POSITIONS.map((position) => <span key={position.symbol} title={`${position.symbol}: ${position.actual}% actual`} style={{ flex: position.actual, background: position.color }} />)}</div>
                  </div>
                  <p>Each band totals 100%. Colors match the asset rows; change uses percentage points.</p>
                </div>
                <table className="cr-alloc-table">
                  <thead><tr><th scope="col">Asset</th><th scope="col">Target</th><th scope="col">Actual</th><th scope="col">Change</th></tr></thead>
                  <tbody>{POSITIONS.map((position) => {
                    const delta = position.actual - position.target;
                    return <tr key={position.symbol}>
                      <th scope="row"><span className="cr-asset"><span className="cr-asset-dot" style={{ background: position.color }} /><span><strong>{position.symbol}</strong><small>{position.name}</small><small>{position.utility} · <span className="cr-apy">{position.apy}% APY</span></small></span></span></th>
                      <td>{position.target}%</td><td><strong>{position.actual}%</strong></td><td className="cr-alloc-delta">{delta > 0 ? "+" : ""}{delta} pp</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <aside className="cr-health-panel"><span className="cr-kicker">Portfolio signal / Sample</span><div className="cr-health-number">{health}<span>/ 100</span></div><h3>{driftLabel(drift)}</h3><p>Aggregate distance from saved targets: {drift.toFixed(1)} percentage points. The label is an illustration, not a risk score.</p><div className="cr-health-rule"><span style={{ width: `${health}%` }} /></div><div className="cr-next-label">Where to next</div><button onClick={() => setTab("Shield")}>Compare routes <span aria-hidden="true">↗</span></button><button onClick={() => setTab("Yield")}>Explore yield <span aria-hidden="true">↗</span></button><button onClick={() => setTab("Game")}>View progress <span aria-hidden="true">↗</span></button></aside>
            </section>
            <PortfolioTokens onRouteToShield={() => { setTab("Shield"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          </>}

          {tab === "Shield" && <>
            <div className="cr-section-grid"><SectionTitle index="A /" title="Set the path" note="A route preview starts with the assets and a slippage ceiling." /><div className="cr-side-note">Quote lookup only. The fixed demo sender in this prototype cannot authorize execution.</div></div>
            <section className="cr-shield-layout">
              <div className="cr-route-form"><div className="cr-form-top"><span className="cr-kicker">Route parameters</span><span className="cr-form-seal">↗</span></div><div className="cr-form-half"><div className="cr-form-half-head"><span>01 / You send</span><span>Source</span></div><div className="cr-fields"><ChainField label="Network" value={fromChain} onChange={updateFromChain} /><label className="cr-field"><span>Asset</span><select value={fromToken} disabled={!fromOptions.length} onChange={(event) => { setFromToken(event.target.value); resetRoutePreview(); }}>{fromOptions.map((token) => <option key={token}>{token}</option>)}</select></label><label className="cr-field cr-field-amount"><span>Amount</span><input inputMode="decimal" aria-label="Amount to send" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[^0-9.]/g, "")); resetRoutePreview(); }} placeholder="0.0" /></label></div></div><div className="cr-transfer-mark" aria-hidden="true">↓</div><div className="cr-form-half"><div className="cr-form-half-head"><span>02 / You receive</span><span>Destination</span></div><div className="cr-fields"><ChainField label="Network" value={toChain} onChange={updateToChain} /><label className="cr-field"><span>Asset</span><select value={toToken} disabled={!toOptions.length} onChange={(event) => { setToToken(event.target.value); resetRoutePreview(); }}>{toOptions.map((token) => <option key={token}>{token}</option>)}</select></label><label className="cr-field cr-field-amount"><span>Max slippage</span><div className="cr-input-suffix"><input inputMode="decimal" aria-label="Maximum slippage percentage" value={slippage} onChange={(event) => { setSlippage(Math.max(0, Math.min(50, Number(event.target.value) || 0))); resetRoutePreview(); }} /><span>%</span></div></label></div></div><div className="cr-form-footer"><button className="cr-primary" disabled={loading || !canPrepare} onClick={prepareShieldRoute}>{loading ? "Looking for routes…" : "Find routes"} <span aria-hidden="true">↗</span></button><p>Comparison only. Review provider terms and wallet details in a connected product.</p></div>{error && <p className="cr-error" role="alert">{error}</p>}</div>
              <aside className="cr-mode-panel"><span className="cr-kicker">03 / Compare by intent</span><h3>How should the path feel?</h3><p>Choose which route type appears first. This display preference does not constrain providers or execute a trade.</p><div className="cr-mode-options">{SHIELD_MODES.map((option, index) => <button key={option} type="button" className={mode === option ? "cr-mode-active" : ""} aria-pressed={mode === option} onClick={() => setMode(option)}><span>{String(index + 1).padStart(2, "0")}</span>{option}<b aria-hidden="true">{mode === option ? "●" : "○"}</b></button>)}</div><div className="cr-mode-note"><span>Preparation order</span><strong>Quote → check → review</strong></div></aside>
            </section>
            <div className="cr-section-grid cr-section-spaced"><SectionTitle index="B /" title="Routes in view" note="Output, fee, time, and atomicity remain visible together." /><div className="cr-side-note">{routeSource === "sample" ? "Illustrative ETH → USDC examples. Change inputs and find routes for provider results." : "Provider response for the selected pair. Indicative until reviewed in a wallet."}</div></div>
            <div className="cr-route-grid">{orderedRoutes.map((route, index) => <RouteCard key={route.id} route={route} selected={index === 0} sample={routeSource === "sample"} />)}</div>
            <div className="cr-section-grid cr-section-spaced"><SectionTitle index="C /" title="Checks behind the route" note="A visible dependency, never a hidden promise." /></div><div className="cr-hook-grid">{HOOK_CARDS.map((hook, index) => <article className="cr-hook" key={hook.name}><span className="cr-index">0{index + 1} / {hook.status}</span><h3>{hook.name}</h3><p>{hook.role}</p></article>)}</div>
          </>}

          {tab === "Yield" && <>
            <div className="cr-section-grid"><SectionTitle index="A /" title="The featured pool" note="Fee earning potential is presented with its terms and its sample status." /><div className="cr-side-note">Rates and TVL below are example data. No live staking transaction is connected.</div></div>
            <section className="cr-yield-feature"><div className="cr-yield-intro"><span className="cr-kicker">Featured / {FEATURE_FARM.status}</span><h3>{FEATURE_FARM.name}</h3><p>{FEATURE_FARM.pool}. A place where share liquidity and routing activity meet.</p><span className="cr-yield-big">{FEATURE_FARM.apy}<small>Sample APY</small></span></div><div className="cr-yield-details"><div><span>Liquidity shown</span><strong>{FEATURE_FARM.tvl}</strong></div><div><span>Lock term</span><strong>{FEATURE_FARM.lock}</strong></div><div><span>Return source</span><strong>{FEATURE_FARM.note}</strong></div><p>Pool figures are illustrative. Actual returns vary; no deposit flow is available in this browser prototype.</p></div></section>
            <div className="cr-section-grid cr-section-spaced"><SectionTitle index="B /" title="Other expressions of liquidity" note="Three more pools, each with a distinct role and access term." /></div><div className="cr-farm-list">{FARMS.map((farm, index) => <article className="cr-farm-row" key={farm.name}><span className="cr-index">0{index + 1}</span><div className="cr-farm-identity"><h3>{farm.name}</h3><p>{farm.pool} · {farm.note}</p></div><div><span>Sample APY</span><strong>{farm.apy}</strong></div><div><span>TVL / Lock</span><strong>{farm.tvl} / {farm.lock}</strong></div><em>{farm.status}</em></article>)}</div><div className="cr-crosslink"><span>Liquidity supports the route as much as the reward.</span><button onClick={() => setTab("Shield")}>See route prep <span aria-hidden="true">↗</span></button></div>
          </>}

          {tab === "Ecosystem" && <>
            <div className="cr-section-grid"><SectionTitle index="A /" title="The order matters" note="A system made legible, from managed share to optional play." /><div className="cr-side-note">These relationships describe the product concept. Deployment and live verification are separate gates.</div></div>
            <div className="cr-ecosystem-grid">{PILLARS.map((pillar, index) => <article className="cr-pillar" key={pillar.title}><span className="cr-pillar-number">0{index + 1}</span><span className="cr-pillar-symbol" style={{ background: COMPOSITION_COLORS[index] }} aria-hidden="true" /><span className="cr-kicker">{pillar.label}</span><h3>{pillar.title}</h3><p>{pillar.detail}</p><ul>{pillar.points.map((point) => <li key={point}>{point}</li>)}</ul></article>)}</div>
            <div className="cr-section-grid cr-section-spaced"><SectionTitle index="B /" title="The working sequence" note="Each layer depends on the one before it." /></div><div className="cr-stack-list">{ECOSYSTEM.map((node, index) => <article className="cr-stack-row" key={node.title}><span className="cr-index">{String(index + 1).padStart(2, "0")}</span><h3>{node.title}</h3><p>{node.detail}</p><em>{node.status}</em></article>)}</div>
          </>}

          {tab === "Game" && <>
            <div className="cr-section-grid"><SectionTitle index="A /" title="Participation, made visible" note="Local demo state only. Quest marks and XP are not wallet or chain records." /><div className="cr-side-note">Progress belongs outside the strategy NAV. The optional roll never changes a portfolio value.</div></div>
            <div className="cr-game-grid"><section className="cr-progress-panel"><span className="cr-kicker">Your demo progress</span><div className="cr-xp-number">{(WALLET.xp + questXp + boostXp).toLocaleString()}<small>XP</small></div><div className="cr-game-metrics"><div><span>Streak</span><strong>{WALLET.streak} days</strong></div><div><span>Quests</span><strong>{completed.length} / {QUESTS.length}</strong></div><div><span>Rank</span><strong>{rank}</strong></div></div><p>Based on a sample profile and the tasks you mark below during this visit.</p></section><section className="cr-quest-panel"><div className="cr-quest-heading"><span className="cr-kicker">01 / Useful actions</span><span>{completed.length} complete</span></div><h3>Small steps add up.</h3><div className="cr-quests">{QUESTS.map((quest) => <label className={`cr-quest ${done.has(quest.id) ? "cr-quest-done" : ""}`} key={quest.id}><input type="checkbox" checked={done.has(quest.id)} onChange={() => toggleQuest(quest.id)} /><span>{quest.title}</span><strong>+{quest.reward} XP</strong></label>)}</div><p>Mark tasks for this local preview; completion is not verified.</p></section></div>
            <div className="cr-section-grid cr-section-spaced"><SectionTitle index="B /" title="An optional little chance" note="A simulated boost to demo XP, with no promised financial yield." /></div><section className="cr-boost-panel"><div><span className="cr-kicker">Nes / Optional play</span><h3>Roll, if you like.</h3><p>A small moment of chance after the work. It does not alter holdings, a quote, or strategy returns.</p></div><div className="cr-boost-action"><button className="cr-primary" disabled={Boolean(gamble)} onClick={rollGamble}>{gamble ? "Demo roll complete" : "Roll demo boost"} <span aria-hidden="true">↗</span></button>{gamble && <div className="cr-boost-result" role="status"><strong>{gamble.multiplier} / {gamble.label}</strong><span>{gamble.detail}</span><em>+{gamble.xp} demo XP</em></div>}</div></section>
          </>}
        </main>
        <footer className="cr-footer"><span>coloyond / A managed strategy, open to interpretation.</span><span>Browser prototype · Sample figures · No wallet execution</span><a href="/reference/index.html">View original UI reference ↗</a></footer>
      </div>
    </div>
  );
}
