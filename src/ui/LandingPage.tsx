import { WebsiteBrand } from "./Brand.js";
import { useEffect, useState } from "react";
import { ReferenceArt } from "./ReferenceArt.js";
import {
  ECOSYSTEM,
  GAMBLE_OUTCOMES,
  GambleOutcome,
  PILLARS,
  QUESTS,
  WALLET,
} from "./product.js";

const COMPOSITION_COLORS = ["#1249ed", "#ffd523", "#8d25d9", "#ff513b"];

function SectionTitle({ index, title, note }: { index: string; title: string; note?: string }) {
  return (
    <div className="cr-section-title">
      <span className="cr-index">{index}</span>
      <div><h2>{title}</h2>{note && <p>{note}</p>}</div>
    </div>
  );
}

export function LandingPage() {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [gamble, setGamble] = useState<GambleOutcome | null>(null);
  const [boostXp, setBoostXp] = useState(0);
  const completed = QUESTS.filter((quest) => done.has(quest.id));
  const questXp = completed.reduce((sum, quest) => sum + quest.reward, 0);
  const rank = completed.length >= 4 ? "Builder" : completed.length >= 2 ? "Steward" : "Watch";
  useEffect(() => { document.title = "Coloyond — System and participation"; }, []);
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
          <a className="cr-brand" href="/" aria-label="Coloyond home"><WebsiteBrand /></a>
          <div className="cr-topbar-right"><span className="cr-demo-label">Browser prototype · Sample data</span><a className="cr-reference-link" href="/app" aria-label="Open the portfolio desk">Portfolio desk <span aria-hidden="true">↗</span></a><a className="cr-reference-link" href="/etf-devnet" aria-label="Open real Solana Devnet ETF read page">Real ETF Devnet read <span aria-hidden="true">↗</span></a><a className="cr-reference-link cr-lab-link" href="/rebalancing-lab">Rebalance lab <span aria-hidden="true">↗</span></a><a className="cr-reference-link" href="/symmetry-devnet">Symmetry Devnet <span aria-hidden="true">↗</span></a><a className="cr-reference-link" href="/reference/index.html">UI reference <span aria-hidden="true">↗</span></a></div>
        </header>

        <section className="cr-intro" aria-labelledby="page-title">
          <div className="cr-intro-copy"><p className="cr-eyebrow">coloyond / System / Participation</p><h1 id="page-title">Every part has a part to play.</h1><p className="cr-intro-description">A managed share starts the story. Routing, liquidity, rewards, and expression follow in that order. The portfolio desk itself lives one link away, at /app.</p><div className="cr-intro-meta"><span>Landing</span><span>coloyond</span></div></div>
          <div className="cr-hero-art"><img src="/coloyond.jpg" alt="Coloyond geometric allocation artwork" style={{width:"100%",height:"100%",objectFit:"contain"}} /><span className="cr-art-caption">Visual study / Color expresses composition, not risk.</span></div>
        </section>

        <main className="cr-main">
          <div className="cr-section-grid"><SectionTitle index="A /" title="The order matters" note="A system made legible, from managed share to optional play." /><div className="cr-side-note">These relationships describe the product concept. Deployment and live verification are separate gates.</div></div>
          <div className="cr-ecosystem-grid">{PILLARS.map((pillar, index) => <article className="cr-pillar" key={pillar.title}><span className="cr-pillar-number">0{index + 1}</span><span className="cr-pillar-symbol" style={{ background: COMPOSITION_COLORS[index] }} aria-hidden="true" /><span className="cr-kicker">{pillar.label}</span><h3>{pillar.title}</h3><p>{pillar.detail}</p><ul>{pillar.points.map((point) => <li key={point}>{point}</li>)}</ul></article>)}</div>
          <div className="cr-section-grid cr-section-spaced"><SectionTitle index="B /" title="The working sequence" note="Each layer depends on the one before it." /></div><div className="cr-stack-list">{ECOSYSTEM.map((node, index) => <article className="cr-stack-row" key={node.title}><span className="cr-index">{String(index + 1).padStart(2, "0")}</span><h3>{node.title}</h3><p>{node.detail}</p><em>{node.status}</em></article>)}</div>

          <div className="cr-section-grid cr-section-spaced"><SectionTitle index="C /" title="Participation, made visible" note="Local demo state only. Quest marks and XP are not wallet or chain records." /><div className="cr-side-note">Progress belongs outside the strategy NAV. The optional roll never changes a portfolio value.</div></div>
          <div className="cr-game-grid"><section className="cr-progress-panel"><span className="cr-kicker">Your demo progress</span><div className="cr-xp-number">{(WALLET.xp + questXp + boostXp).toLocaleString()}<small>XP</small></div><div className="cr-game-metrics"><div><span>Streak</span><strong>{WALLET.streak} days</strong></div><div><span>Quests</span><strong>{completed.length} / {QUESTS.length}</strong></div><div><span>Rank</span><strong>{rank}</strong></div></div><p>Based on a sample profile and the tasks you mark below during this visit.</p></section><section className="cr-quest-panel"><div className="cr-quest-heading"><span className="cr-kicker">01 / Useful actions</span><span>{completed.length} complete</span></div><h3>Small steps add up.</h3><div className="cr-quests">{QUESTS.map((quest) => <label className={`cr-quest ${done.has(quest.id) ? "cr-quest-done" : ""}`} key={quest.id}><input type="checkbox" checked={done.has(quest.id)} onChange={() => toggleQuest(quest.id)} /><span>{quest.title}</span><strong>+{quest.reward} XP</strong></label>)}</div><p>Mark tasks for this local preview; completion is not verified.</p></section></div>
          <div className="cr-section-grid cr-section-spaced"><SectionTitle index="D /" title="An optional little chance" note="A simulated boost to demo XP, with no promised financial yield." /></div><section className="cr-boost-panel"><div><span className="cr-kicker">Nes / Optional play</span><h3>Roll, if you like.</h3><p>A small moment of chance after the work. It does not alter holdings, a quote, or strategy returns.</p></div><div className="cr-boost-action"><button className="cr-primary" disabled={Boolean(gamble)} onClick={rollGamble}>{gamble ? "Demo roll complete" : "Roll demo boost"} <span aria-hidden="true">↗</span></button>{gamble && <div className="cr-boost-result" role="status"><strong>{gamble.multiplier} / {gamble.label}</strong><span>{gamble.detail}</span><em>+{gamble.xp} demo XP</em></div>}</div></section>

          <div className="cr-crosslink"><span>The strategy itself lives at the desk.</span><a className="cr-reference-link" href="/app">Open the portfolio desk <span aria-hidden="true">↗</span></a></div>
        </main>
        <footer className="cr-footer"><span>coloyond / A managed strategy, open to interpretation.</span><span>Browser prototype · Sample portfolio · Symmetry comparison is read only</span><a href="/reference/index.html">View original UI reference ↗</a></footer>
      </div>
    </div>
  );
}
