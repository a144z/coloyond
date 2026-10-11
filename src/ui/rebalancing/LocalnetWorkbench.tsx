import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  amountToNumber,
  amountToText,
  connectLocalnetWallet,
  executeLocalnetAction,
  loadLocalnetClient,
  readChainSnapshot,
  type ChainSnapshot,
  type LocalnetAction,
  type LocalnetClient,
  type TransactionOutcome,
} from "./localnetAdapter.js";

interface LocalnetWorkbenchProps {
  onFixtureMode(): void;
}

interface Activity {
  id: number;
  action: string;
  outcome: TransactionOutcome;
}

function short(value: string): string {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

function amount(value: bigint, decimals: number, digits = 4): string {
  return amountToText(value, decimals, digits);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function PortfolioAsset({
  label,
  amountRaw,
  decimals,
  target,
  weight,
}: {
  label: string;
  amountRaw: bigint;
  decimals: number;
  target: number;
  weight: number;
}) {
  return (
    <div className="aw-asset-row">
      <div className="aw-asset-heading"><strong>{label}</strong><span>{amount(amountRaw, decimals)} {label}</span></div>
      <div className="aw-track" aria-label={`${label}: target ${target.toFixed(0)} percent, on-chain actual ${weight.toFixed(1)} percent`}>
        <span className="aw-target-mark" style={{ left: `${target}%` }} />
        <span className="aw-actual-fill" style={{ width: `${Math.max(0, Math.min(weight, 100))}%` }} />
      </div>
      <div className="aw-asset-facts"><span>Target <b>{target.toFixed(0)}%</b></span><span>On-chain actual <b>{weight.toFixed(1)}%</b></span></div>
    </div>
  );
}

function calculateWeights(snapshot: ChainSnapshot): [number, number] {
  const wsolValue = amountToNumber(snapshot.balances.custodyWsol, snapshot.decimals[0]) * snapshot.prices.wsol.price;
  const usdcValue = amountToNumber(snapshot.balances.custodyUsdc, snapshot.decimals[1]) * snapshot.prices.usdc.price;
  const total = wsolValue + usdcValue;
  return total > 0 ? [wsolValue / total * 100, usdcValue / total * 100] : [0, 0];
}

function tokenDelta(outcome: TransactionOutcome, decimals: [number, number]): string {
  const delta = outcome.deltas;
  return `Vault ${amount(delta.custodyWsol, decimals[0])} WSOL / ${amount(delta.custodyUsdc, decimals[1])} USDC · Taker ${amount(delta.takerWsol, decimals[0])} WSOL / ${amount(delta.takerUsdc, decimals[1])} USDC`;
}

export function LocalnetWorkbench({ onFixtureMode }: LocalnetWorkbenchProps) {
  const [client, setClient] = useState<LocalnetClient | null>(null);
  const [snapshot, setSnapshot] = useState<ChainSnapshot | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadLocalnetClient().then(async (loaded) => {
      const current = await readChainSnapshot(loaded);
      if (!cancelled) {
        setClient(loaded);
        setSnapshot(current);
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!client) return;
    const refresh = () => void readChainSnapshot(client)
      .then((next) => setSnapshot(next))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    const timer = window.setInterval(refresh, 1800);
    return () => window.clearInterval(timer);
  }, [client]);

  const walletMatches = !!wallet && !!client && wallet === client.keys.takerWallet.toBase58();
  const active = snapshot?.intent !== null && snapshot?.intent !== undefined;
  const complete = !!snapshot?.intent && snapshot.intent.remainingSellAmount === 0n;
  const expired = !!snapshot?.intent && BigInt(snapshot.slot) > snapshot.intent.endSlot;
  const [wsolWeight, usdcWeight] = useMemo(() => snapshot ? calculateWeights(snapshot) : [0, 0], [snapshot]);
  const liveActionsEnabled = !!client && walletMatches && !busy;

  const connect = async () => {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const key = await connectLocalnetWallet(client);
      setWallet(key.toBase58());
      setSnapshot(await readChainSnapshot(client));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: LocalnetAction, label: string) => {
    if (!client || !walletMatches || !snapshot) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await executeLocalnetAction(client, new PublicKey(wallet!), action);
      setActivities((items) => [{ id: Date.now(), action: label, outcome }, ...items]);
      setSnapshot(await readChainSnapshot(client));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      try { setSnapshot(await readChainSnapshot(client)); } catch { /* Keep the original RPC or wallet error visible. */ }
    } finally {
      setBusy(false);
    }
  };

  const copySignature = async (signature: string) => {
    try {
      await navigator.clipboard.writeText(signature);
      setCopied(signature);
      window.setTimeout(() => setCopied(""), 1400);
    } catch {
      setError("Clipboard access is unavailable; select and copy the transaction signature.");
    }
  };

  const manifest = client?.manifest;
  const targetWsol = snapshot ? snapshot.targetsBps[0] / 100 : 50;
  const targetUsdc = snapshot ? snapshot.targetsBps[1] / 100 : 50;
  const startAmount = manifest && snapshot ? amount(BigInt(manifest.startAmount), snapshot.decimals[manifest.startSellAsset]) : "—";
  const fillSell = manifest && snapshot ? amount(BigInt(manifest.fillSellAmount), snapshot.decimals[0]) : "—";
  const fillBuy = manifest && snapshot ? amount(BigInt(manifest.fillGrossBuyAmount), snapshot.decimals[1]) : "—";

  return (
    <div className="aw-localnet">
      <div className="aw-lab-switch" aria-label="Workbench mode">
        <span className="aw-mode-current">Localnet · SBF</span>
        <button type="button" onClick={onFixtureMode}>Open CP2a fixture mode</button>
      </div>

      <div className="aw-eyebrow">S2 / CP2b · Localnet transaction workbench</div>
      <section className="aw-intro">
        <div><p className="cr-eyebrow">coloyond / rebalancing lab</p><h1>Auction, on chain.</h1><p className="aw-lede">Connect the designated local wallet, inspect the running validator, then sign transactions that execute the deployed SBF program.</p></div>
        <div className="aw-intro-index"><span>LIVE LOCALNET</span><strong>{snapshot ? snapshot.slot.toString().padStart(4, "0") : "—"}</strong><small>confirmed slot · RPC read</small></div>
      </section>

      <section className="aw-truth-banner aw-truth-live" aria-label="Localnet execution notice">
        <span className="aw-truth-mark" aria-hidden="true">↗</span>
        <div><strong>REAL WALLET SIGNATURES · LOCALNET SBF EXECUTION</strong><p>Every lifecycle action below is sent to the configured local validator and confirmed on chain. The workbench does not switch to fixture mode when setup fails.</p>{manifest && <p className="aw-fixture-notice"><b>{manifest.fixtureKind}:</b> {manifest.fixtureNotice}</p>}</div>
        <span className="aw-network-chip">LOCALNET ONLY</span>
      </section>

      <section className="aw-connection-panel" aria-label="Cluster, program and wallet">
        <div className="aw-connection-facts">
          <article><span>Cluster / RPC</span><strong>{manifest?.rpcUrl ?? "Checking Localnet manifest…"}</strong><small>{client ? `Genesis ${short(manifest!.expectedGenesisHash)}` : "No remote cluster fallback"}</small></article>
          <article><span>Program</span><strong>{manifest ? short(manifest.programId) : "—"}</strong><small>{client ? "Executable SBF verified on validator" : "Pinned program is checked on load"}</small></article>
          <article><span>Wallet</span><strong>{wallet ? short(wallet) : "Not connected"}</strong><small>{client ? `Required test wallet ${short(manifest!.takerWallet)} · extension cluster is not inspected` : "Connect after the manifest loads"}</small></article>
        </div>
        <button className="aw-connect-button" type="button" disabled={!client || busy} onClick={() => void connect()}>
          {busy ? "Waiting for wallet…" : walletMatches ? "Wallet connected" : "Connect Localnet wallet"}
        </button>
      </section>

      {error && <div className="aw-localnet-error" role="alert"><strong>Localnet action unavailable</strong><p>{error}</p>{!client && <small>Start the Localnet setup that publishes <code>/localnet-manifest.json</code>, then reload. Fixture mode remains a separate manual choice.</small>}</div>}

      {snapshot && manifest && <>
        <section className="aw-overview" aria-label="On-chain status">
          <article><span>Environment</span><strong>Solana Localnet</strong><small>{manifest.rpcUrl}</small></article>
          <article><span>Oracle fixture</span><strong>{snapshot.prices.wsol.verifiedFull && snapshot.prices.usdc.verifiedFull ? "Full format / local data" : "Verification check failed"}</strong><small>SOL ${snapshot.prices.wsol.price.toFixed(2)} · USDC $${snapshot.prices.usdc.price.toFixed(4)}</small></article>
          <article><span>Risk state</span><strong>{snapshot.vaultStatus !== 1 ? `Vault status ${snapshot.vaultStatus}` : snapshot.riskPaused ? "Paused on chain" : "Enabled on chain"}</strong><small>vault + governance accounts</small></article>
          <article><span>Auction intent</span><strong>{!active ? "No active intent" : complete ? "Complete" : expired ? "Expired" : "Open"}</strong><small>{snapshot.intent ? `sequence ${snapshot.intent.sequence.toString()} · ${amount(snapshot.intent.remainingSellAmount, snapshot.decimals[snapshot.intent.sellAsset])} remaining` : `vault sequence ${snapshot.vaultSequence.toString()}`}</small></article>
        </section>

        <section className="aw-grid">
          <div className="aw-panel aw-portfolio-panel">
            <div className="aw-panel-heading"><div><span className="aw-index">01 / Read from chain</span><h2>Target and actual</h2></div><span className="aw-live-tag">LIVE RPC</span></div>
            <p className="aw-panel-copy">Custody balances and token decimals come from SPL accounts; weights use the pinned Localnet Pyth account values.</p>
            <div className="aw-assets">
              <PortfolioAsset label="WSOL" amountRaw={snapshot.balances.custodyWsol} decimals={snapshot.decimals[0]} target={targetWsol} weight={wsolWeight} />
              <PortfolioAsset label="USDC" amountRaw={snapshot.balances.custodyUsdc} decimals={snapshot.decimals[1]} target={targetUsdc} weight={usdcWeight} />
            </div>
            <div className="aw-summary-row"><span>On-chain NAV · fixture oracle marks</span><strong>${(amountToNumber(snapshot.balances.custodyWsol, snapshot.decimals[0]) * snapshot.prices.wsol.price + amountToNumber(snapshot.balances.custodyUsdc, snapshot.decimals[1]) * snapshot.prices.usdc.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong></div>
            <div className="aw-direction-note"><span aria-hidden="true">i</span><p>Fills directly transfer classic SPL tokens between vault custody and the taker. This S2D program does not call Jupiter or a DEX route. Rejection receipts compare the monitored token balances and sequence fields below; the Localnet payer still pays the transaction fee.</p></div>
            <div className="aw-feed-details"><span>SOL/USD publish time <b>{formatTime(snapshot.prices.wsol.publishTime)}</b></span><span>USDC/USD publish time <b>{formatTime(snapshot.prices.usdc.publishTime)}</b></span><span>Test taker balances <b>{amount(snapshot.balances.takerWsol, snapshot.decimals[0])} WSOL / {amount(snapshot.balances.takerUsdc, snapshot.decimals[1])} USDC</b></span></div>
          </div>

          <div className="aw-panel aw-actions-panel">
            <div className="aw-panel-heading"><div><span className="aw-index">02 / Signed program calls</span><h2>Run lifecycle steps</h2></div><span className="aw-step-count">wallet required</span></div>
            <div className="aw-lifecycle-actions">
              <button type="button" disabled={!liveActionsEnabled || active} onClick={() => void run({ type: "start" }, "Start rebalance")}>Start auction · {startAmount} WSOL <span>01</span></button>
              <button type="button" disabled={!liveActionsEnabled || !active} onClick={() => void run({ type: "fill" }, `Fill ${fillSell} WSOL → ${fillBuy} USDC`)}>Fill on chain · {fillSell} WSOL → {fillBuy} USDC <span>02</span></button>
              <button type="button" disabled={!liveActionsEnabled || !active || !snapshot.hasPreviousBountyClaim} onClick={() => void run({ type: "replay" }, "Replay previous fill")}>Replay previous fill sequence <span>03</span></button>
              <button type="button" disabled={!liveActionsEnabled || !active} onClick={() => void run({ type: "wrong-feed" }, "Fill with wrong oracle account")}>Try wrong oracle account <span>04</span></button>
              <button type="button" disabled={!liveActionsEnabled || !active} onClick={() => void run({ type: "adverse-price" }, "Try adverse fill price")}>Try adverse quote · 50 USDC <span>05</span></button>
              <button type="button" disabled={!liveActionsEnabled || !active} onClick={() => void run({ type: "oversize" }, "Try fill above remaining size")}>Try oversize fill <span>06</span></button>
              <button type="button" disabled={!liveActionsEnabled || !active} onClick={() => void run({ type: "duplicate-start" }, "Duplicate start")}>Try duplicate start <span>07</span></button>
              <button type="button" disabled={!liveActionsEnabled || !active || !complete} onClick={() => void run({ type: "finish" }, "Finish complete intent")}>Close completed intent <span>08</span></button>
              <button type="button" disabled={!liveActionsEnabled || !active || !expired} onClick={() => void run({ type: "expire" }, "Expire intent after end slot")}>Expire after on-chain end slot <span>09</span></button>
            </div>
            {!walletMatches && <div className="aw-script-note"><strong>Wallet gate</strong><span>Connect the designated Localnet taker wallet {manifest.takerWallet}. Only Localnet SOL fees are used here.</span></div>}
            {active && !expired && !complete && <div className="aw-script-note"><strong>Expiry gate</strong><span>Current slot {snapshot.slot}; intent end slot {snapshot.intent!.endSlot.toString()}. The RPC slot watcher enables expiry only after the chain passes that slot.</span></div>}
          </div>
        </section>

        <section className="aw-event-panel" aria-labelledby="aw-localnet-event-title">
          <div className="aw-panel-heading"><div><span className="aw-index">03 / Confirmed transaction receipts</span><h2 id="aw-localnet-event-title">What happened on chain</h2></div><span className="aw-live-tag">SIGNATURES + DELTAS</span></div>
          {activities.length === 0 ? <p className="aw-empty-state">No transactions sent in this session. Read-only balances and slot above come from the connected Localnet RPC.</p> : <ol className="aw-events" aria-live="polite">{activities.map(({ id, action, outcome }) => <li key={id} className={outcome.accepted ? "aw-event-accepted" : "aw-event-rejected"}>
            <span className="aw-event-number">{outcome.slot ?? "—"}</span>
            <div><strong>{action} · {outcome.accepted ? "confirmed" : "rejected on chain"}</strong><p>{outcome.slot === null ? "Inclusion slot unavailable" : `Slot ${outcome.slot}`} · {tokenDelta(outcome, snapshot.decimals)} · vault sequence {outcome.vaultSequenceBefore.toString()} → {outcome.vaultSequenceAfter.toString()}{outcome.error ? ` · ${outcome.error}` : ""}</p>{!outcome.accepted && <p className={outcome.monitoredValuesUnchanged ? "aw-rejection-clean" : "aw-rejection-mutated"}>{outcome.monitoredValuesUnchanged ? "Rejected; the four watched SPL balances, vault sequence, and intent sequence / remaining amount match the pre-transaction snapshot. Other account fields are not compared." : "One or more watched values changed after rejection. Inspect the on-chain state and logs."}</p>}<button className="aw-signature-button" type="button" onClick={() => void copySignature(outcome.signature)}>{copied === outcome.signature ? "Copied" : "Copy full signature"}</button><code className="aw-full-signature">{outcome.signature}</code>{outcome.logs.length > 0 && <details><summary>Program logs</summary><pre>{outcome.logs.join("\n")}</pre></details>}</div>
            <span className="aw-event-result">{outcome.accepted ? "CONFIRMED" : "ON-CHAIN REJECTION"}</span>
          </li>)}</ol>}
          <p className="aw-fee-note">Each receipt compares pre/post values for four SPL token balances, vault sequence, intent sequence, and remaining sell amount. Full account bytes and other state fields are not compared; native SOL fee-payer changes are excluded. The page verifies its Localnet RPC genesis and required wallet key, but it cannot inspect the wallet extension&apos;s selected cluster. Signed transactions are sent directly to the displayed Localnet RPC.</p>
        </section>
      </>}

      <footer className="aw-footer"><span>CP2b executes the local SBF program with wallet-signed transactions.</span><span>Test accounts and oracle values are Localnet-only fixtures.</span><button type="button" onClick={onFixtureMode}>Open the separate CP2a browser fixture</button></footer>
    </div>
  );
}
