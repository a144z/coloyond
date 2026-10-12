import { WebsiteBrand } from "../Brand.js";
import type { VaultView } from "../../symmetry/types.js";
import { useSymmetryDesk, type SymmetryDeskView } from "./useSymmetryDesk.js";
import { ReferenceArt } from "../ReferenceArt.js";

const WSOL = "So11111111111111111111111111111111111111112";

function short(key: string, lead = 4, tail = 4): string {
  return key.length > lead + tail + 1 ? `${key.slice(0, lead)}…${key.slice(-tail)}` : key;
}

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function fmtPrice(n: number | null): string {
  if (n === null) return "—";
  return n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(8)}`;
}

function keeperWhen(ms: number | null): string {
  if (!ms) return "never observed";
  const days = (Date.now() - ms) / 86_400_000;
  const ago = days < 1 ? `${Math.round(days * 24)} h ago` : `${Math.round(days)} d ago`;
  return `${new Date(ms).toISOString().slice(0, 10)} (${ago})`;
}

function bounty(n: number, mint: string): string {
  if (mint === WSOL) return `${(n / 1e9).toFixed(4)} SOL`;
  return `${fmtNum(n)} (${short(mint)})`;
}

function Detail({ desk }: { desk: SymmetryDeskView }) {
  const v: VaultView = desk.detail as VaultView;
  const drift = v.driftPp;

  return (
    <>
      <div className="cr-sym-title">
        <h3>{v.name}</h3>
        <span className="cr-sym-tag">{v.symbol}</span>
        <span className={v.automation.enabled ? "cr-sym-ok" : "cr-sym-off"}>
          keeper automation {v.automation.enabled ? "enabled" : "disabled"}
        </span>
      </div>

      <dl className="cr-sym-facts">
        <div><dt>Share mint</dt><dd><code>{short(v.mint, 6, 6)}</code></dd></div>
        <div><dt>Vault</dt><dd><code>{short(v.pubkey, 6, 6)}</code></dd></div>
        <div><dt>TVL (oracle)</dt><dd>{fmtUsd(v.tvlUsd)}</dd></div>
        <div><dt>Share price</dt><dd>{fmtPrice(v.priceUsd)}</dd></div>
        <div><dt>Drift</dt><dd className={drift !== null && drift > 0 ? "cr-sym-warn" : ""}>{drift === null ? "unavailable" : `${drift.toFixed(1)} pp`}</dd></div>
        <div><dt>Last keeper run</dt><dd>{keeperWhen(v.lastKeeperAt)}</dd></div>
        <div><dt>Automation reserve</dt><dd>{bounty(v.bountyBalance, v.bountyMint)}</dd></div>
        <div><dt>Trigger / cooldown</dt><dd>{v.automation.absBps} bps · {v.automation.cooldownSeconds}s</dd></div>
      </dl>

      <table className="cr-sym-table">
        <thead>
          <tr><th>Asset</th><th>Target</th><th>Actual (oracle)</th><th>Value</th></tr>
        </thead>
        <tbody>
          {v.detail.map(a => (
            <tr key={a.mint}>
              <td><code>{a.symbol}</code></td>
              <td>{a.targetPct.toFixed(2)}%</td>
              <td className={a.actualPct !== null && Math.abs(a.actualPct - a.targetPct) >= 1 ? "cr-sym-warn" : ""}>
                {a.actualPct === null ? "—" : `${a.actualPct.toFixed(2)}%`}
              </td>
              <td>{fmtUsd(a.valueUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="cr-sym-readonly">This is a read-only Devnet comparison. No wallet transaction is submitted from this page.</p>
    </>
  );
}

export function SymmetryDesk({ desk }: { desk: SymmetryDeskView }) {
  return (
    <section className="cr-section cr-sym" aria-label="Live Symmetry vault">
      <header className="cr-sym-head">
        <h2>
          <span className="cr-idx">DEVNET /</span> Symmetry comparison
        </h2>
        <div className="cr-sym-net">
          <span className="cr-sym-pill">read only · Solana Devnet</span>
        </div>
      </header>

      <div className="cr-sym-wallet">
        <span className="cr-sym-hint">Live account reads from the Symmetry V3 program. No signing or custody actions.</span>
        <button onClick={desk.refresh} disabled={desk.busy}>Refresh</button>
      </div>

      <div className="cr-sym-body">
        <aside className="cr-sym-list">
          {desk.vaults.map(v => (
            <button
              key={v.pubkey}
              className={desk.selected === v.pubkey ? "is-sel" : ""}
              onClick={() => desk.select(v.pubkey)}
            >
              <span className="nm">{v.name}</span>
              <span className="meta">
                {v.assets} assets · supply {fmtNum(v.supply)} · {v.automationEnabled ? "keeper on" : "keeper off"}
              </span>
            </button>
          ))}
          {desk.vaults.length === 0 ? <p className="cr-sym-empty">No vaults for this network.</p> : null}
        </aside>

        <div className="cr-sym-detail">
          {desk.detail ? <Detail desk={desk} /> : <p className="cr-sym-empty">Select a vault to read its live state.</p>}
        </div>
      </div>

      <p className="cr-sym-status" role="status" aria-live="polite">{desk.status}</p>
      <p className="cr-sym-note">
        Reads come live from Solana Devnet via @symmetry-hq/sdk through the Symmetry V3 program
        BASKT7aK…pumate. This is a comparison surface only; it does not submit Symmetry transactions or validate the Coloyond SBF auction.
      </p>
    </section>
  );
}

export function LiveSymmetrySection() {
  const desk = useSymmetryDesk();
  return <SymmetryDesk desk={desk} />;
}

export function SymmetryDevnetPage() {
  return (
    <div className="cr-app">
      <div className="cr-shell">
        <header className="cr-topbar">
          <a className="cr-brand" href="/" aria-label="Coloyond home"><WebsiteBrand /></a>
          <div className="cr-topbar-right">
            <span className="cr-demo-label">Protocol comparison · Devnet read only</span>
            <a className="cr-reference-link" href="/">Portfolio <span aria-hidden="true">↗</span></a>
            <a className="cr-reference-link" href="/rebalancing-lab">Coloyond Localnet lab <span aria-hidden="true">↗</span></a>
            <a className="cr-reference-link" href="/reference/index.html">UI reference <span aria-hidden="true">↗</span></a>
          </div>
        </header>
        <main>
          <section className="cr-intro" aria-labelledby="symmetry-page-title">
            <div className="cr-intro-copy">
              <p className="cr-eyebrow">coloyond / Protocol comparison</p>
              <h1 id="symmetry-page-title">A live read of Symmetry on Devnet.</h1>
              <p className="cr-intro-description">Compare the existing keeper vault model against Coloyond’s custom Anchor auction. This page reads public Devnet state and cannot sign transactions.</p>
              <div className="cr-intro-meta"><span>READ ONLY</span><span>SYMMETRY V3 · DEVNET</span></div>
            </div>
            <div className="cr-hero-art"><ReferenceArt variant="orbit" title="Symmetry protocol comparison" /><span className="cr-art-caption">Protocol surface / This view cannot pass Coloyond's Localnet checkpoint.</span></div>
          </section>
          <LiveSymmetrySection />
        </main>
        <footer className="cr-footer"><span>coloyond / A managed strategy, open to interpretation.</span><span>Public Devnet reads · No wallet transaction</span><a href="/">Return to portfolio ↗</a></footer>
      </div>
    </div>
  );
}
