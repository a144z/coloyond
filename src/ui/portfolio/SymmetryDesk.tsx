import { FUND_PRESETS_LAMPORTS } from "../../symmetry/actions.js";
import type { VaultView } from "../../symmetry/types.js";
import { useSymmetryDesk, type SymmetryDeskView } from "./useSymmetryDesk.js";

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
  const canSign = Boolean(desk.address);
  const drift = v.driftPp;
  const eligible = drift !== null && v.automation.enabled && drift >= Math.max(v.automation.absBps, v.automation.relBps) / 100;

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

      <div className="cr-sym-actions">
        <div className="cr-sym-action">
          <p>
            <strong>Fund the automation reserve.</strong> A real devnet transaction (addBountyTx).
            Symmetry's keepers spend this reserve to rebalance, so the holder never signs or pays gas per rebalance.
          </p>
          {FUND_PRESETS_LAMPORTS.map(p => (
            <button key={p.lamports} disabled={!canSign || desk.busy} onClick={() => void desk.fundReserve(p.lamports)}>
              Fund {p.label}
            </button>
          ))}
        </div>
        <div className="cr-sym-action">
          <p>
            <strong>Keeper nudge.</strong> Permissionless rebalance (rebalanceVaultTx). The program accepts it only
            when drift passes the on-chain trigger. {/* eligibility shown above */}
          </p>
          <button disabled={!canSign || desk.busy} onClick={() => void desk.nudgeKeeper()}>
            {eligible ? "Nudge keeper now (eligible)" : "Nudge keeper (submit)"}
          </button>
        </div>
      </div>

      {desk.lastSignature ? (
        <p className="cr-sym-sig">
          Last signature:{" "}
          <a href={`https://explorer.solana.com/tx/${desk.lastSignature}?cluster=devnet`} target="_blank" rel="noreferrer">
            <code>{short(desk.lastSignature, 8, 8)}</code>
          </a>
        </p>
      ) : null}
    </>
  );
}

export function SymmetryDesk({ desk }: { desk: SymmetryDeskView }) {
  return (
    <section className="cr-section cr-sym" aria-label="Live Symmetry vault">
      <header className="cr-sym-head">
        <h2>
          <span className="cr-idx">LIVE /</span> Symmetry vault on-chain
        </h2>
        <div className="cr-sym-net">
          <button className={desk.network === "devnet" ? "is-on" : ""} onClick={() => desk.setNetwork("devnet")}>devnet</button>
          <button className={desk.network === "mainnet" ? "is-on" : ""} onClick={() => desk.setNetwork("mainnet")}>mainnet</button>
          <span className="cr-sym-pill">{desk.network === "devnet" ? "test funds only" : "real funds"}</span>
        </div>
      </header>

      <div className="cr-sym-wallet">
        {desk.address ? (
          <code title={desk.address}>{short(desk.address, 6, 6)}</code>
        ) : (
          <span className="cr-sym-hint">Connect a wallet with the button in the top bar to fund or nudge.</span>
        )}
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
        Reads come live from Solana {desk.network} via @symmetry-hq/sdk through the Symmetry V3 program
        BASKT7aK…pumate. Deposits, reserve funding and keeper nudges are real transactions signed by your wallet.
        Rebalances themselves are executed by Symmetry's permissionless keeper network, not by coloyond.
      </p>
    </section>
  );
}

export function LiveSymmetrySection() {
  const desk = useSymmetryDesk();
  return <SymmetryDesk desk={desk} />;
}
