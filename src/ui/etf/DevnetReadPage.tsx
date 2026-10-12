import { WebsiteBrand } from "../Brand.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ETF_DEVNET_GENESIS_HASH,
  readDevnetCandidateState,
  type DevnetReadResult,
} from "../../../packages/etf-client/src/index.js";
import { ConnectButton } from "../wallet/ConnectButton.js";
import "./devnet-read.css";

type ReadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "read"; value: DevnetReadResult; receivedAt: string }
  | { status: "error"; message: string };

function StateTag({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return <span className={`etf-tag etf-tag-${tone}`}>{children}</span>;
}

function Value({ children }: { children: ReactNode }) {
  return <code className="etf-value">{children === null || children === undefined || children === "" ? "Not available from RPC" : children}</code>;
}

function statusTone(status: string): "neutral" | "good" | "warn" | "bad" {
  if (["available", "full", "within_draft_limits"].includes(status)) return "good";
  if (["invalid", "future_publish_time", "genesis_mismatch", "error"].includes(status)) return "bad";
  if (["not_admitted", "not_configured", "unconfigured", "stale_under_draft_limit", "confidence_over_draft_limit", "partial"].includes(status)) return "warn";
  return "neutral";
}

function displayStatus(status: string): string {
  return status.replaceAll("_", " ");
}

function SnapshotNotice({ state }: { state: ReadState }) {
  if (state.status === "idle") {
    return <div className="etf-notice" role="status">No live RPC read has been requested yet.</div>;
  }
  if (state.status === "loading") {
    return <div className="etf-notice" role="status"><span className="etf-spinner" aria-hidden="true" /> Reading Devnet account state from the configured RPC…</div>;
  }
  if (state.status === "error") {
    return <div className="etf-notice etf-notice-error" role="alert">RPC read failed: {state.message}</div>;
  }

  const { value } = state;
  if (value.status === "genesis_mismatch") {
    return (
      <div className="etf-notice etf-notice-error" role="alert">
        <strong>Genesis mismatch — financial account data was not loaded.</strong>
        <span>Expected Devnet <Value>{value.expectedGenesisHash}</Value></span>
        <span>RPC returned <Value>{value.actualGenesisHash}</Value></span>
      </div>
    );
  }
  if (value.status === "unavailable") {
    return (
      <div className="etf-notice etf-notice-error" role="alert">
        <strong>Devnet read unavailable.</strong>
        <span>{displayStatus(value.reason)}</span>
        <span>Expected genesis <Value>{value.expectedGenesisHash}</Value>; actual <Value>{value.actualGenesisHash}</Value></span>
      </div>
    );
  }
  return <div className="etf-notice" role="status">RPC snapshot received at {state.receivedAt}. Snapshot slot and commitment are shown below.</div>;
}

function MintCard({ mint }: { mint: Extract<DevnetReadResult, { status: "candidate_data" }>['mints'][number] }) {
  return (
    <article className="etf-card">
      <div className="etf-card-head">
        <div><p className="etf-eyebrow">Candidate mint</p><h3>{mint.symbol}</h3></div>
        <StateTag tone={statusTone(mint.admission)}>{displayStatus(mint.admission)}</StateTag>
      </div>
      <p className="etf-description">{mint.label}</p>
      <dl className="etf-fields">
        <div><dt>Mint address</dt><dd><Value>{mint.address}</Value></dd></div>
        <div><dt>RPC account status</dt><dd><StateTag tone={statusTone(mint.status)}>{displayStatus(mint.status)}</StateTag></dd></div>
        <div><dt>Token program owner</dt><dd><Value>{mint.owner}</Value></dd></div>
        <div><dt>Account data length</dt><dd><Value>{mint.dataLength === null ? null : `${mint.dataLength} bytes`}</Value></dd></div>
        <div><dt>Decimals</dt><dd><Value>{mint.decimals}</Value></dd></div>
        <div><dt>Supply (base units)</dt><dd><Value>{mint.supplyBaseUnits}</Value></dd></div>
        <div><dt>Mint authority</dt><dd><Value>{mint.mintAuthority}</Value></dd></div>
        <div><dt>Freeze authority</dt><dd><Value>{mint.freezeAuthority}</Value></dd></div>
      </dl>
      {mint.reason ? <p className="etf-reason">Read detail: {displayStatus(mint.reason)}</p> : null}
      {mint.symbol === "Test USD" ? <p className="etf-synthetic">Synthetic · unbacked · not redeemable as USDC</p> : null}
    </article>
  );
}

function FeedCard({ feed }: { feed: Extract<DevnetReadResult, { status: "candidate_data" }>['feeds'][number] }) {
  const freshnessLabel = feed.freshness === "unconfigured"
    ? "Unconfigured — no approved freshness/confidence policy"
    : displayStatus(feed.freshness);
  return (
    <article className="etf-card">
      <div className="etf-card-head">
        <div><p className="etf-eyebrow">Oracle candidate</p><h3>{feed.label}</h3></div>
        <StateTag tone={statusTone(feed.status)}>{displayStatus(feed.status)}</StateTag>
      </div>
      <p className="etf-description">Oracle feed evidence only. The associated asset is not admitted to a deployed ETF.</p>
      <dl className="etf-fields">
        <div><dt>Feed account</dt><dd><Value>{feed.address}</Value></dd></div>
        <div><dt>Receiver program owner</dt><dd><Value>{feed.owner}</Value></dd></div>
        <div><dt>Account data length</dt><dd><Value>{feed.dataLength === null ? null : `${feed.dataLength} bytes`}</Value></dd></div>
        <div><dt>Expected feed ID</dt><dd><Value>{feed.expectedFeedId}</Value></dd></div>
        <div><dt>Embedded feed ID</dt><dd><Value>{feed.feedId}</Value></dd></div>
        <div><dt>Verification</dt><dd><StateTag tone={statusTone(feed.verification)}>{feed.verification === "full" ? "Full" : displayStatus(feed.verification)}</StateTag></dd></div>
        <div><dt>Freshness policy</dt><dd><StateTag tone={statusTone(feed.freshness)}>{freshnessLabel}</StateTag></dd></div>
        <div><dt>Observed chain time</dt><dd><Value>{feed.observedUnixTime === null ? null : `${feed.observedUnixTime} s`}</Value></dd></div>
        <div><dt>Publish time</dt><dd><Value>{feed.publishTime === null ? null : `${feed.publishTime} s`}</Value></dd></div>
        <div><dt>Age</dt><dd><Value>{feed.ageSeconds === null ? null : `${feed.ageSeconds} s`}</Value></dd></div>
        <div><dt>Price · raw</dt><dd><Value>{feed.rawPrice === null ? null : `${feed.rawPrice} × 10^${feed.exponent ?? "?"}`}</Value></dd></div>
        <div><dt>Confidence · raw</dt><dd><Value>{feed.confidence === null ? null : `${feed.confidence} × 10^${feed.exponent ?? "?"}`}</Value></dd></div>
        <div><dt>Confidence / price</dt><dd><Value>{feed.confidenceBpsCeil} bps</Value></dd></div>
        {feed.policy ? <div><dt>Draft limits · not approved</dt><dd><Value>age ≤ {feed.policy.maximumAgeSeconds}s · confidence ≤ {feed.policy.maximumConfidenceBps}bps</Value></dd></div> : null}
        <div><dt>Associated mint</dt><dd><Value>{feed.associatedMint}</Value></dd></div>
      </dl>
      {feed.associatedMint === null ? <p className="etf-synthetic">BTC feed candidate only · no Devnet BTC mint is admitted or represented here</p> : null}
      {feed.label.includes("USD/USD") ? <p className="etf-synthetic">Test USD is synthetic, unbacked, and not redeemable as USDC</p> : null}
      {feed.reason ? <p className="etf-reason">Read detail: {displayStatus(feed.reason)}</p> : null}
    </article>
  );
}

function LiveData({ state }: { state: Extract<ReadState, { status: "read" }> }) {
  const { value } = state;
  if (value.status !== "candidate_data") return null;
  return (
    <>
      <section className="etf-section" aria-labelledby="etf-candidate-mints">
        <div className="etf-section-head"><div><p className="etf-eyebrow">RPC account inspection</p><h2 id="etf-candidate-mints">Candidate mints</h2></div><StateTag tone="warn">Not admitted</StateTag></div>
        <div className="etf-card-grid">{value.mints.map((mint) => <MintCard key={mint.address} mint={mint} />)}</div>
      </section>
      <section className="etf-section" aria-labelledby="etf-candidate-feeds">
        <div className="etf-section-head"><div><p className="etf-eyebrow">Pyth Receiver account inspection</p><h2 id="etf-candidate-feeds">Oracle candidates</h2></div><StateTag tone="warn">Full verification required</StateTag></div>
        <div className="etf-card-grid">{value.feeds.map((feed) => <FeedCard key={feed.address} feed={feed} />)}</div>
      </section>
      <section className="etf-section" aria-labelledby="etf-wallet-balances">
        <div className="etf-section-head"><div><p className="etf-eyebrow">Wallet adapter + RPC</p><h2 id="etf-wallet-balances">Connected wallet balances</h2></div></div>
        {value.wallet ? (
          <article className="etf-card">
            <p className="etf-wallet-address"><Value>{value.wallet.address}</Value></p>
            <div className="etf-balance-list">
              {value.wallet.balances.map((balance) => {
                const mint = value.mints.find((candidate) => candidate.address === balance.mint);
                return <div className="etf-balance-row" key={balance.mint}>
                  <div><strong>{mint?.symbol ?? "Candidate token"}</strong><small>{balance.mint}{mint?.symbol === "Test USD" ? " · synthetic / unbacked; not redeemable as USDC" : ""}</small></div>
                  <div><StateTag tone={statusTone(balance.status)}>{displayStatus(balance.status)}</StateTag><strong className="etf-amount">{balance.rawAmount ?? "Not available from RPC"}{mint?.decimals === null || mint?.decimals === undefined ? "" : ` base units · ${mint.decimals} decimals`}</strong><small>Token accounts: {balance.tokenAccountCount ?? "not available"} · context slot: {balance.contextSlot ?? "not available"}</small></div>
                </div>;
              })}
            </div>
          </article>
        ) : <article className="etf-card etf-empty">Connect a wallet to read its candidate-token balances. No wallet balances have been queried.</article>}
      </section>
    </>
  );
}

export function DevnetReadPage() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const requestId = useRef(0);
  const [state, setState] = useState<ReadState>({ status: "idle" });

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setState({ status: "loading" });
    try {
      const value = await readDevnetCandidateState(connection, { commitment: "confirmed", walletAddress });
      if (id === requestId.current) setState({ status: "read", value, receivedAt: new Date().toLocaleString() });
    } catch (error) {
      if (id === requestId.current) setState({ status: "error", message: error instanceof Error ? error.message : "Unknown RPC read failure" });
    }
  }, [connection, walletAddress]);

  useEffect(() => {
    void refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);

  const snapshot = state.status === "read" ? state.value : null;
  const candidate = snapshot?.status === "candidate_data" ? snapshot : null;
  const failure = snapshot && snapshot.status !== "candidate_data" ? snapshot : null;
  const genesisHash = candidate?.network.genesisHash ?? failure?.actualGenesisHash;

  return (
    <main className="etf-page cr-shell">
      <header className="etf-topbar">
        <a className="cr-brand" href="/"><WebsiteBrand /></a>
        <div className="etf-topbar-actions"><a className="cr-reference-link" href="/etf-devnet/transactions">ETF transaction desk ↗</a><span className="etf-live-label"><i aria-hidden="true" /> Real Devnet · read only</span><ConnectButton /></div>
      </header>
      <section className="etf-hero">
        <div>
          <p className="etf-eyebrow">Sprint 5 · ETF client probe</p>
          <h1>Devnet account<br />read surface</h1>
          <p className="etf-lede">A live, read-only view of the configured Solana RPC, candidate token mints, Pyth Receiver feeds, and the connected wallet.</p>
        </div>
        <div className="etf-hero-side">
          <StateTag tone="warn">No ETF deployment configured</StateTag>
          <p>Candidate accounts are not an admitted pool, and oracle limits remain unapproved drafts. The transaction desk stays fail-closed until an accepted deployment is available.</p>
          <a className="etf-refresh etf-refresh-link" href="/etf-devnet/transactions">Open wallet transaction desk <span aria-hidden="true">↗</span></a>
          <button className="etf-refresh" type="button" onClick={() => void refresh()} disabled={state.status === "loading"}>
            {state.status === "loading" ? "Reading RPC…" : "Refresh live RPC state"}<span aria-hidden="true">↗</span>
          </button>
        </div>
      </section>

      <SnapshotNotice state={state} />

      <section className="etf-section" aria-labelledby="etf-network-heading">
        <div className="etf-section-head"><div><p className="etf-eyebrow">Connection identity</p><h2 id="etf-network-heading">Network & deployment</h2></div><StateTag tone={candidate ? "good" : failure?.status === "genesis_mismatch" ? "bad" : "neutral"}>{candidate ? "Genesis verified" : failure?.status === "genesis_mismatch" ? "Genesis mismatch" : state.status === "loading" ? "Checking genesis" : "Awaiting RPC"}</StateTag></div>
        <div className="etf-network-grid">
          <div className="etf-card etf-network-card">
            <dl className="etf-fields">
              <div><dt>Cluster</dt><dd><Value>{candidate?.network.cluster ?? "Expected: Devnet"}</Value></dd></div>
              <div><dt>Genesis hash · actual</dt><dd><Value>{genesisHash}</Value></dd></div>
              <div><dt>Genesis hash · expected Devnet</dt><dd><Value>{ETF_DEVNET_GENESIS_HASH}</Value></dd></div>
              <div><dt>RPC endpoint · configured</dt><dd><Value>{connection.rpcEndpoint}</Value></dd></div>
              <div><dt>RPC host</dt><dd><Value>{candidate?.network.rpcHost ?? failure?.network.rpcHost}</Value></dd></div>
              <div><dt>Commitment</dt><dd><Value>{candidate?.network.commitment ?? failure?.network.commitment ?? "confirmed · configured"}</Value></dd></div>
              <div><dt>Snapshot slot</dt><dd><Value>{candidate?.network.contextSlot}</Value></dd></div>
              <div><dt>Wallet adapter</dt><dd><Value>{walletAddress ?? "Not connected"}</Value></dd></div>
            </dl>
          </div>
          <div className="etf-card etf-deployment-card">
            <p className="etf-eyebrow">On-chain ETF configuration</p>
            <div><span>Program</span><StateTag tone="warn">Not configured</StateTag></div>
            <div><span>Pool</span><StateTag tone="warn">Not configured</StateTag></div>
            <p>No program ID or pool address is present in the deployment contract. This screen cannot report pool NAV, weights, shares, fees, or transaction state.</p>
          </div>
        </div>
      </section>

      {state.status === "read" ? <LiveData state={state} /> : null}
      <footer className="etf-footer"><span>LIVE RPC OBSERVATION</span><span>Confirmed commitment · no signing · no synthetic fixture data</span></footer>
    </main>
  );
}
