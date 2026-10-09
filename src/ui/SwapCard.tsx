import { useState } from "react";
import { CHAINS, BALANCES } from "./data.js";
import { symbolsOn } from "../tokenmap.js";
import { tokenLogo, chainLogo } from "../logos.js";
import { Logo } from "./Logo.js";

type Side = "from" | "to";

const SLIPPAGE_PRESETS = [0.1, 0.5, 1, 3];

interface Props {
  fromChain: number;
  setFromChain: (v: number) => void;
  fromToken: string;
  setFromToken: (v: string) => void;
  toChain: number;
  setToChain: (v: number) => void;
  toToken: string;
  setToToken: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  atomic: boolean;
  setAtomic: (v: boolean) => void;
  receive: string | null;
  fee: number | null;
  slippage: number;
  setSlippage: (v: number) => void;
  onSwap: () => void;
  onFind: () => void;
}

export function SwapCard(p: Props) {
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState<Side | null>(null);
  const [settings, setSettings] = useState(false);
  const [invertRate, setInvertRate] = useState(false);

  const balance = BALANCES[p.fromToken] ?? "0";
  const fromOptions = symbolsOn(p.fromChain);
  const toOptions = symbolsOn(p.toChain);

  const num = parseFloat(p.amount) || 0;
  const numReceive = p.receive ? Number(p.receive.replace(/,/g, "")) : 0;
  const rate = num > 0 && numReceive > 0 ? numReceive / num : null;

  const handleChain = (side: Side, chain: number) => {
    const opts = symbolsOn(chain);
    if (side === "from") {
      p.setFromChain(chain);
      if (!opts.includes(p.fromToken)) p.setFromToken(opts[0] ?? "ETH");
    } else {
      p.setToChain(chain);
      if (!opts.includes(p.toToken)) p.setToToken(opts[0] ?? "ETH");
    }
  };

  const handleFind = async () => {
    setLoading(true);
    try {
      await p.onFind();
    } finally {
      setLoading(false);
    }
  };

  const disabled =
    loading || !(num > 0) || fromOptions.length === 0 || toOptions.length === 0;

  const ChainSelect = ({ side }: { side: Side }) => {
    const chain = side === "from" ? p.fromChain : p.toChain;
    const set = side === "from" ? p.setFromChain : p.setToChain;
    return (
      <div className="chain-select-wrap">
        <Logo src={chainLogo(chain)} fallback="net" size={18} />
        <select
          className="chain-select"
          value={chain}
          onChange={(e) => handleChain(side, Number(e.target.value))}
        >
          {CHAINS.filter((c) => c.id !== 0).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const TokenBtn = ({ side }: { side: Side }) => {
    const chain = side === "from" ? p.fromChain : p.toChain;
    const sym = side === "from" ? p.fromToken : p.toToken;
    return (
      <button className="token-btn" onClick={() => setPicker(side)}>
        <Logo src={tokenLogo(sym, chain)} fallback={sym} size={24} />
        <span className="token-sym">{sym}</span>
        <span className="caret">▾</span>
      </button>
    );
  };

  return (
    <div className="card">
      <div className="field-label">
        <span>From</span>
        <span className="bal">Balance: {balance}</span>
      </div>
      <div className="field">
        <div className="pick-row">
          <ChainSelect side="from" />
          <TokenBtn side="from" />
        </div>
        <div className="amount-row">
          <input
            className="amount"
            inputMode="decimal"
            value={p.amount}
            onChange={(e) => p.setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
          />
          <button className="btn btn-mini" onClick={() => p.setAmount(balance.replace(/,/g, ""))}>
            MAX
          </button>
        </div>
      </div>

      <div className="swap-mid">
        <button className="swap-btn" onClick={p.onSwap} title="Switch direction">
          ⇅
        </button>
        <button
          className="rate-line"
          onClick={() => setInvertRate((v) => !v)}
          title="Reverse rate"
        >
          {rate
            ? invertRate
              ? `1 ${p.toToken} ≈ ${(1 / rate).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${p.fromToken}`
              : `1 ${p.fromToken} ≈ ${rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${p.toToken}`
            : "Enter an amount to see the rate"}
        </button>
      </div>

      <div className="field-label">
        <span>To</span>
        <span className="bal">Network fee {p.fee !== null ? `≈ $${p.fee.toFixed(2)}` : "—"}</span>
      </div>
      <div className="field">
        <div className="pick-row">
          <ChainSelect side="to" />
          <TokenBtn side="to" />
        </div>
        <div className="amount-row">
          <div className="amount receive-amount">{p.receive ? `~${p.receive}` : "—"}</div>
          <span className="receive-token">{p.toToken}</span>
        </div>
      </div>

      <div className="settings-row">
        <div className="setting">
          <button className="gear" onClick={() => setSettings((v) => !v)} title="Settings">
            ⚙
          </button>
          <span>
            Slippage: <b>{p.slippage}%</b>
          </span>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            className="switch"
            checked={p.atomic}
            onChange={(e) => p.setAtomic(e.target.checked)}
          />
          <span>⚡ Atomic Execution</span>
        </label>
      </div>

      {settings && (
        <div className="popover">
          <div className="popover-title">Swap settings</div>
          <div className="pop-label">Max slippage</div>
          <div className="slippage-row">
            {SLIPPAGE_PRESETS.map((s) => (
              <button
                key={s}
                className={`btn btn-mini ${p.slippage === s ? "active" : ""}`}
                onClick={() => p.setSlippage(s)}
              >
                {s === 0.1 ? "Auto" : `${s}%`}
              </button>
            ))}
          </div>
          <label className="pop-label">
            Custom
            <input
              className="amount slippage-input"
              inputMode="decimal"
              value={p.slippage}
              onChange={(e) =>
                p.setSlippage(Math.max(0, Math.min(50, Number(e.target.value) || 0)))
              }
            />
            %
          </label>
          <div className="pop-note">
            {p.atomic
              ? "Atomic lock ON: failure rolls back to source wallet."
              : "Non-atomic: failed steps are refunded one by one."}
          </div>
        </div>
      )}

      <button className="btn btn-primary" disabled={disabled} onClick={handleFind}>
        {loading ? (
          <>
            <span className="spin" /> Finding routes…
          </>
        ) : (
          "Find Best Route →"
        )}
      </button>

      <div className="from-note">Quotes from LI.FI + deBridge in real time</div>

      {picker && (
        <div className="overlay" onClick={() => setPicker(null)}>
          <div className="token-pop" onClick={(e) => e.stopPropagation()}>
            <div className="popover-title">
              Select token · {CHAINS.find((c) => c.id === (picker === "from" ? p.fromChain : p.toChain))?.name}
            </div>
            {(picker === "from" ? fromOptions : toOptions).map((t) => {
              const chain = picker === "from" ? p.fromChain : p.toChain;
              const set = picker === "from" ? p.setFromToken : p.setToToken;
              const active = (picker === "from" ? p.fromToken : p.toToken) === t;
              return (
                <button
                  key={t}
                  className={`token-row ${active ? "active" : ""}`}
                  onClick={() => {
                    set(t);
                    setPicker(null);
                  }}
                >
                  <Logo src={tokenLogo(t, chain)} fallback={t} size={26} />
                  <span className="token-row-sym">{t}</span>
                  <span className="token-row-bal">{BALANCES[t] ?? "—"}</span>
                  {active && <span className="token-check">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}