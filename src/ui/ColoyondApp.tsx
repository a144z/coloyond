import { useState } from "react";
import { CHAINS } from "./data.js";
import { symbolsOn } from "../tokenmap.js";
import { Route } from "../types.js";
import { fetchRoutes } from "../routeService.js";
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

const SHIELD_CHAINS = CHAINS.filter((c) => c.id !== 0);

export function ColoyondApp() {
  const [tab, setTab] = useState<ProductTab>("Portfolio");
  const [fromChain, setFromChain] = useState(42161);
  const [toChain, setToChain] = useState(10);
  const [fromToken, setFromToken] = useState("ETH");
  const [toToken, setToToken] = useState("USDC");
  const [amount, setAmount] = useState("1.0");
  const [slippage, setSlippage] = useState(0.5);
  const [mode, setMode] = useState<ShieldMode>(SHIELD_MODES[0]);
  const [routes, setRoutes] = useState<Route[]>(SAMPLE_ROUTES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gamble, setGamble] = useState<GambleOutcome | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const fromOptions = symbolsOn(fromChain);
  const toOptions = symbolsOn(toChain);
  const bestRoutes = [...routes].sort((a, b) => b.outputAmountNum - a.outputAmountNum).slice(0, 3);
  const drift = POSITIONS.reduce((sum, p) => sum + Math.abs(p.target - p.actual), 0);
  const health = Math.max(0, 100 - drift * 4);
  const completed = QUESTS.filter((q) => done.has(q.id));
  const questXp = completed.reduce((sum, q) => sum + q.reward, 0);
  const rank = health > 80 ? "Builder" : health > 65 ? "Steward" : "Watch";
  const numAmount = parseFloat(amount) || 0;
  const canPrepare = numAmount > 0 && fromOptions.length > 0 && toOptions.length > 0;

  const updateFromChain = (chain: number) => {
    const opts = symbolsOn(chain);
    setFromChain(chain);
    setFromToken(opts.includes(fromToken) ? fromToken : (opts[0] ?? "ETH"));
  };

  const updateToChain = (chain: number) => {
    const opts = symbolsOn(chain);
    setToChain(chain);
    setToToken(opts.includes(toToken) ? toToken : (opts[0] ?? "ETH"));
  };

  const prepareShieldRoute = async () => {
    if (!canPrepare) {
      setError("Enter an amount and select tokens supported on both paths.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRoutes({
        fromChain,
        toChain,
        fromToken,
        toToken,
        amount,
        slippage,
      });
      if (result.routes.length > 0) {
        setRoutes(result.routes);
      } else {
        setError(result.error ?? "No provider route found; sample routes remain below.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleQuest = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setDone(next);
  };

  const rollGamble = () => {
    const roll = Math.random();
    const outcome =
      roll < 0.38
        ? GAMBLE_OUTCOMES[0]
        : roll < 0.62
          ? GAMBLE_OUTCOMES[1]
          : roll < 0.82
            ? GAMBLE_OUTCOMES[2]
            : GAMBLE_OUTCOMES[3];
    setGamble(outcome);
  };

  return (
    <div className="cb-app">
      <header className="cb-header">
        <div className="cb-brand">
          <span className="cb-mark">◆</span>
          <div>
            <div className="cb-title">coloyond</div>
            <div className="cb-subtitle">
              Managed strategy · TradeFi liquidity · shielded rebalancing
            </div>
          </div>
        </div>
        <div className="cb-wallet">
          <div className="cb-wallet-label">{WALLET.network}</div>
          <div className="cb-wallet-usd">{WALLET.usd}</div>
        </div>
      </header>

      <section className="cb-hero">
        <div className="cb-hero-copy">
          <h1>{STRATEGY.name}</h1>
          <p>
            {STRATEGY.kind} · {STRATEGY.network}
          </p>
        </div>
        <div className="cb-status">
          <span className="cb-status-active">{STRATEGY.status}</span>
          <span>Updated {STRATEGY.freshness}</span>
        </div>
        <div className="cb-health">
          <div className="cb-health-track">
            <div className="cb-health-fill" style={{ width: `${health}%` }} />
          </div>
          <div className="cb-health-label">
            {driftLabel(drift)} · drift {drift.toFixed(1)}%
          </div>
        </div>
        <div className="cb-stats">
          <div className="cb-stat">
            <span>Protocol NAV</span>
            <b>{STRATEGY.nav}</b>
          </div>
          <div className="cb-stat">
            <span>Market price</span>
            <b>{STRATEGY.market}</b>
          </div>
          <div className="cb-stat">
            <span>Executable quote</span>
            <b>{STRATEGY.quote}</b>
          </div>
          <div className="cb-stat">
            <span>Share token</span>
            <b>{STRATEGY.share}</b>
          </div>
        </div>
      </section>

      <nav className="cb-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`cb-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="cb-main">
        {tab === "Portfolio" && (
          <section className="cb-panel">
            <div className="cb-section-head">
              <h2>Rebalancing portfolio</h2>
              <p>
                Repair drift while preserving real utility: share value, exit depth,
                protocol-managed custody, and visible yield.
              </p>
            </div>
            <div className="cb-alloc">
              {POSITIONS.map((p) => {
                const delta = p.actual - p.target;
                const deltaClass = delta === 0 ? "good" : Math.abs(delta) <= 2 ? "watch" : "risk";
                return (
                  <article className="cb-alloc-row" key={p.symbol}>
                    <div className="cb-alloc-head">
                      <span className="cb-dot" style={{ background: p.color }} />
                      <div>
                        <div className="cb-token">{p.symbol}</div>
                        <div className="cb-subtle">{p.name}</div>
                      </div>
                      <div className="cb-delta">
                        <b>{p.actual}%</b>
                        <span className={deltaClass}>
                          {delta > 0 ? "+" : ""}
                          {delta}%
                        </span>
                      </div>
                    </div>
                    <div className="cb-bars">
                      <div className="cb-bar">
                        <span style={{ width: `${p.target}%` }} />
                        <em>target</em>
                      </div>
                      <div className="cb-bar actual">
                        <span style={{ width: `${p.actual}%` }} />
                        <em>actual</em>
                      </div>
                    </div>
                    <div className="cb-meta-row">
                      <span>{p.utility}</span>
                      <span>{p.apy}% APY</span>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="cb-action-row">
              <button onClick={() => setTab("Shield")}>Prepare route</button>
              <button onClick={() => setTab("Yield")}>Open farms</button>
              <button onClick={() => setTab("Game")}>Check game</button>
            </div>
          </section>
        )}

        {tab === "Shield" && (
          <section className="cb-panel">
            <div className="cb-section-head">
              <h2>Shield transaction prep</h2>
              <p>Quote first, route only after the hook and risk checks pass.</p>
            </div>
            <div className="cb-shield-grid">
              <div className="cb-form-grid">
                <label className="cb-field">
                  <span>From chain</span>
                  <select value={fromChain} onChange={(e) => updateFromChain(Number(e.target.value))}>
                    {SHIELD_CHAINS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cb-field">
                  <span>From token</span>
                  <select
                    value={fromToken}
                    onChange={(e) => setFromToken(e.target.value)}
                    disabled={fromOptions.length === 0}
                  >
                    {fromOptions.map((token) => (
                      <option key={token} value={token}>
                        {token}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cb-field">
                  <span>Amount</span>
                  <input
                    className="cb-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0.0"
                  />
                </label>
                <label className="cb-field">
                  <span>To chain</span>
                  <select value={toChain} onChange={(e) => updateToChain(Number(e.target.value))}>
                    {SHIELD_CHAINS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cb-field">
                  <span>Receive token</span>
                  <select
                    value={toToken}
                    onChange={(e) => setToToken(e.target.value)}
                    disabled={toOptions.length === 0}
                  >
                    {toOptions.map((token) => (
                      <option key={token} value={token}>
                        {token}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cb-field">
                  <span>Slippage</span>
                  <div className="cb-suffix">
                    <input
                      className="cb-slippage"
                      inputMode="decimal"
                      value={slippage}
                      onChange={(e) =>
                        setSlippage(Math.max(0, Math.min(50, Number(e.target.value) || 0)))
                      }
                    />
                    <span>%</span>
                  </div>
                </label>
              </div>

              <div className="cb-mode-grid">
                {SHIELD_MODES.map((shieldMode) => (
                  <button
                    key={shieldMode}
                    className={`cb-mode ${mode === shieldMode ? "active" : ""}`}
                    onClick={() => setMode(shieldMode)}
                  >
                    {shieldMode}
                  </button>
                ))}
              </div>

              <button className="cb-primary" disabled={loading} onClick={prepareShieldRoute}>
                {loading ? "Preparing route…" : "Prepare route"}
              </button>

              {error && <div className="cb-error">{error}</div>}

              {bestRoutes.length > 0 && (
                <div className="cb-routes">
                  {bestRoutes.map((r) => {
                    const etaText =
                      r.totalTimeSeconds < 60
                        ? `~${r.totalTimeSeconds}s`
                        : `~${Math.round(r.totalTimeSeconds / 60)}min`;
                    return (
                      <article key={r.id} className="cb-route-card">
                        <div className="cb-route-top">
                          <b>{r.provider}</b>
                          <span>{r.atomicLevel}</span>
                        </div>
                        <div className="cb-flow">
                          {r.steps.map((s, i) => (
                            <span key={`${r.id}-${i}`}>
                              {s.protocol}: {s.fromSymbol}→{s.toSymbol}
                            </span>
                          ))}
                        </div>
                        <div className="cb-metrics">
                          <span>
                            {r.outputAmount} {toToken}
                          </span>
                          <span>${r.totalFeeUsd.toFixed(2)} fee</span>
                          <span>{etaText}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              <div className="cb-hook-grid">
                {HOOK_CARDS.map((hook) => (
                  <article key={hook.name} className="cb-hook">
                    <div className="cb-hook-head">
                      <b>{hook.name}</b>
                      <em>{hook.status}</em>
                    </div>
                    <p>{hook.role}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === "Yield" && (
          <section className="cb-panel">
            <div className="cb-section-head">
              <h2>Active yield farm</h2>
              <p>TradeFi liquidity layer converts rebalancing activity into LP fee revenue.</p>
            </div>
            <div className="cb-farm-feature">
              <div className="cb-farm-title">
                <b>{FEATURE_FARM.name}</b>
                <span>{FEATURE_FARM.pool}</span>
              </div>
              <div className="cb-farm-stats">
                <div>
                  <span>APY</span>
                  <b>{FEATURE_FARM.apy}</b>
                </div>
                <div>
                  <span>Lock</span>
                  <b>{FEATURE_FARM.lock}</b>
                </div>
                <div>
                  <span>Source</span>
                  <b>{FEATURE_FARM.note}</b>
                </div>
              </div>
              <button className="cb-primary">Stake share tokens</button>
            </div>
            <div className="cb-grid-three">
              {FARMS.map((farm) => (
                <article key={farm.name} className="cb-mini-card">
                  <b>{farm.name}</b>
                  <span>
                    {farm.pool} · {farm.status}
                  </span>
                  <div>APY {farm.apy}</div>
                  <div>{farm.note}</div>
                  <em>
                    {farm.tvl} · {farm.lock}
                  </em>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "Ecosystem" && (
          <section className="cb-panel">
            <div className="cb-section-head">
              <h2>Full ecosystem</h2>
              <p>
                Real utility first, then the full ecosystem, then the game loop, then optional
                gambling.
              </p>
            </div>
            <div className="cb-pillar-grid">
              {PILLARS.map((pillar) => (
                <article key={pillar.title} className="cb-pillar-card">
                  <div className="cb-pillar-label">{pillar.label}</div>
                  <h3>{pillar.title}</h3>
                  <p>{pillar.detail}</p>
                  <ul>
                    {pillar.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <div className="cb-stack">
              {ECOSYSTEM.map((node) => (
                <article key={node.title} className="cb-stack-card">
                  <div>
                    <b>{node.title}</b>
                    <p>{node.detail}</p>
                  </div>
                  <em>{node.status}</em>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "Game" && (
          <section className="cb-panel">
            <div className="cb-section-head">
              <h2>Gamification and gambling</h2>
              <p>Game loop rewards useful behavior; gamble is an optional multiplier inside a risk budget.</p>
            </div>
            <div className="cb-game-stats">
              <div className="cb-game-stat">
                <span>XP</span>
                <b>{String(WALLET.xp + questXp)}</b>
              </div>
              <div className="cb-game-stat">
                <span>Streak</span>
                <b>{WALLET.streak}d</b>
              </div>
              <div className="cb-game-stat">
                <span>Quests</span>
                <b>
                  {completed.length}/{QUESTS.length}
                </b>
              </div>
              <div className="cb-game-stat">
                <span>Rank</span>
                <b>{rank}</b>
              </div>
            </div>
            <div className="cb-quests">
              {QUESTS.map((quest) => {
                const checked = done.has(quest.id);
                return (
                  <label key={quest.id} className={`cb-quest ${checked ? "done" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleQuest(quest.id)}
                    />
                    <span>{quest.title}</span>
                    <b>+{quest.reward} XP</b>
                  </label>
                );
              })}
            </div>
            <div className="cb-gamble">
              <div>
                <h3>Nes roll</h3>
                <p>Optional after a route or save. No promised yield.</p>
              </div>
              <button className="cb-gamble-btn" onClick={rollGamble}>
                Roll boost
              </button>
            </div>
            {gamble && (
              <div className="cb-gamble-result">
                <b>
                  {gamble.multiplier} {gamble.label}
                </b>
                <span>{gamble.detail}</span>
                <em>+{gamble.xp} bonus XP</em>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
