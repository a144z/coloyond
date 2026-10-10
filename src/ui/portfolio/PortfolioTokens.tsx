// The Portfolio tab's watchlist: supported Solana tokens, instant search,
// and a pasted mint the public node can confirm. Self-contained on purpose;
// mount it wherever the token table belongs.
import { useEffect, useRef, useState } from "react";
import { SUPPORTED_SOLANA_TOKENS, searchSupportedTokens, confirmMintOnChain, type SupportedToken, type TokenTag } from "./tokenRegistry.js";
import { usePortfolioTokens } from "./usePortfolioTokens.js";

const TAG_DOTS: Record<TokenTag, string> = { core: "#1249ed", stable: "#ffd523", staking: "#8d25d9", utility: "#ff513b", custom: "#8c897f" };
const TAG_WORDS: Record<TokenTag, string> = { core: "core", stable: "stable", staking: "staking", utility: "utility", custom: "pasted mint" };

export function PortfolioTokens({ onRouteToShield, sectionIndex = "C /" }: { onRouteToShield?: () => void; sectionIndex?: string } = {}) {
  const { tokens, add, remove, reset, totalDemoUsd } = usePortfolioTokens();
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Each mint check gets a number; any newer edit, add, or unmount makes older checks stale.
  const checkRef = useRef(0);
  useEffect(() => () => { checkRef.current += 1; }, []);

  const mint = query.trim();
  const looksMintish = mint.length >= 32 && mint.length <= 44;
  const suggestions = searchSupportedTokens(query, tokens.map((token) => token.mint)).slice(0, 6);

  const addFromSearch = (token: SupportedToken) => {
    checkRef.current += 1;
    setChecking(false);
    add(token);
    setQuery("");
    setStatus(`${token.symbol} joined the watchlist.`);
  };

  const addFromMint = async () => {
    const thisCheck = ++checkRef.current;
    setChecking(true);
    setStatus("Reading the node…");
    const check = await confirmMintOnChain(mint);
    if (thisCheck !== checkRef.current) return;
    setChecking(false);
    if (!check.ok) { setStatus(check.detail); return; }
    if (tokens.some((token) => token.mint === mint)) { setStatus("That mint is already on the watchlist."); setQuery(""); return; }
    const known = SUPPORTED_SOLANA_TOKENS.find((token) => token.mint === mint);
    if (known !== undefined) {
      add(known);
      setStatus(`${known.symbol} joined the watchlist.`);
    } else {
      add({ symbol: mint.slice(0, 4), name: "Pasted mint", mint, tag: "custom", demoUsd: 0 });
      setStatus("Added as a pasted mint; name it in the registry next.");
    }
    setQuery("");
  };

  return (
    <>
      <div className="cr-section-grid cr-section-spaced">
        <div className="cr-section-title">
          <span className="cr-index">{sectionIndex}</span>
          <div><h2>The tokens you watch</h2><p>A curated set of tokens the product supports, with instant search. Values are sample data for the demo profile.</p></div>
        </div>
        <div className="cr-side-note">A pasted mint is checked against the public node. The watchlist stays on this device.</div>
      </div>
      <section className="cr-portfolio-tokens" aria-label="Watched tokens">
        <div className="cr-pt-list">
          {tokens.length === 0 && <p className="cr-pt-empty">The watchlist is empty. Add a token below, or reset to the seed basket.</p>}
          {tokens.map((token) => (
            <article className="cr-pt-row" key={token.mint}>
              <div className="cr-pt-identity"><span className="cr-pt-dot" style={{ background: TAG_DOTS[token.tag] }} /><span><strong>{token.symbol}</strong><small>{token.name} · {token.mint.slice(0, 8)}…</small></span></div>
              <div className="cr-pt-facts"><span>{TAG_WORDS[token.tag]}</span><strong>{token.demoUsd === 0 ? "—" : `$${token.demoUsd.toLocaleString()}`}</strong></div>
              <button className="cr-pt-remove" aria-label={`Remove ${token.symbol}, mint ${token.mint.slice(0, 8)}`} onClick={() => remove(token.mint)}>Remove</button>
            </article>
          ))}
        </div>
        <div className="cr-pt-total"><span>Watchlist at sample prices <button className="cr-pt-reset" onClick={reset}>reset basket</button></span><strong>${totalDemoUsd.toLocaleString()}</strong></div>
        <div className="cr-pt-search">
          <input aria-label="Search tokens or paste a mint" value={query} placeholder="Type a symbol or a name, or paste a mint" onChange={(event) => { checkRef.current += 1; setChecking(false); setQuery(event.target.value); setStatus(null); }} />
          <button className="cr-pt-mint" disabled={checking || !looksMintish} onClick={addFromMint}>{checking ? "Reading the node…" : "Add mint"}</button>
        </div>
        {suggestions.length > 0 && (
          <div className="cr-pt-suggest">
            {suggestions.map((token) => <button key={token.mint} onClick={() => addFromSearch(token)}><i className="cr-pt-dot" style={{ background: TAG_DOTS[token.tag] }} />{token.symbol}<small>{token.name}</small></button>)}
          </div>
        )}
        {/* Always mounted, so screen readers announce each new message. */}
        <p className="cr-pt-status" role="status" aria-atomic="true">{status ?? ""}</p>
        <div className="cr-crosslink"><span>Watch first, then move: any token can start a route.</span>{onRouteToShield !== undefined && <button onClick={onRouteToShield}>Route one in Shield <span aria-hidden="true">↗</span></button>}</div>
      </section>
    </>
  );
}
