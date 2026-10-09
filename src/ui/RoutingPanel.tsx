import { Fragment } from "react";
import { Route, RouteStep } from "../types.js";
import { fmtTime, chainName } from "./data.js";
import { tokenLogo } from "../logos.js";
import { Logo } from "./Logo.js";

export interface Venue {
  name: string;
  pct: number;
}

export interface FlowHop {
  token: string;
  venues: Venue[];
  chain: number;
  chain2: number;
  eta: number;
}

export interface FlowRow {
  pct: number;
  label: string;
  hops: FlowHop[];
}

interface FlowData {
  from: { token: string; color: string; chain: number };
  to: { token: string; color: string; chain: number };
  rows: FlowRow[];
}

const ROW_H = 104;
const GAP = 10;
const CONN_W = 72;

const TOKEN_COLORS: Record<string, string> = {
  ETH: "#627eea",
  WETH: "#627eea",
  WBTC: "#f7931a",
  aWBTC: "#b6509e",
  USDC: "#2775ca",
  USDT: "#26a17b",
  crvUSD: "#2d2f36",
  DAI: "#f5ac37",
};

const TOKEN_GLYPHS: Record<string, string> = {
  WBTC: "₿",
  aWBTC: "A",
};

const MAX_ROWS = 4;

function colorOf(token: string): string {
  return TOKEN_COLORS[token] ?? "#8e8ea3";
}

function hopFromStep(s: RouteStep): FlowHop {
  const venues = s.venues?.length ? s.venues : [{ name: s.protocol, pct: 100 }];
  return {
    token: s.toSymbol,
    venues,
    chain: s.fromChainId,
    chain2: s.toChainId,
    eta: s.etaSeconds,
  };
}

export function buildFlow(routes: Route[]): FlowData | null {
  if (routes.length === 0) return null;
  const sorted = [...routes].sort((a, b) => b.outputAmountNum - a.outputAmountNum);
  const best = sorted[0];
  const from = best.steps[0];
  const to = best.steps[best.steps.length - 1];
  const rows = sorted.slice(0, MAX_ROWS).map((r) => ({
    pct: Math.round((r.outputAmountNum / best.outputAmountNum) * 1000) / 10,
    label: `${r.provider} · ${r.outputAmount} ${to.toSymbol} · ${fmtTime(r.totalTimeSeconds)}`,
    hops: r.steps.map(hopFromStep),
  }));
  return {
    from: { token: from.fromSymbol, color: colorOf(from.fromSymbol), chain: from.fromChainId },
    to: { token: to.toSymbol, color: colorOf(to.toSymbol), chain: to.toChainId },
    rows,
  };
}

function HopCard({ hop }: { hop: FlowHop }) {
  const glyph = TOKEN_GLYPHS[hop.token] ?? hop.token.charAt(0);
  return (
    <div className="hop-node">
      <div className="hop-head">
        <Logo src={tokenLogo(hop.token, hop.chain2 || hop.chain)} fallback={glyph} size={20} />
        <span className="hop-ticker">{hop.token}</span>
        <span className="hop-chain">
          {chainName(hop.chain)}
          {hop.chain2 !== hop.chain && <> → {chainName(hop.chain2)}</>}
        </span>
      </div>
      <div className="node-protos">
        {hop.venues.map((v, i) => (
          <div className="proto-row" key={i}>
            <span>{v.name}</span>
            <span className="proto-pct">{v.pct}%</span>
          </div>
        ))}
      </div>
      <div className="hop-eta">{fmtTime(hop.eta)}</div>
    </div>
  );
}

export function RoutingPanel({ routes }: { routes: Route[] }) {
  const data = buildFlow(routes);
  if (!data) return null;
  const totalH = data.rows.length * ROW_H + (data.rows.length - 1) * GAP;
  const midY = totalH / 2;
  const rowCenters = data.rows.map((_, i) => i * (ROW_H + GAP) + ROW_H / 2);

  const Connector = ({ flip }: { flip: boolean }) => {
    const paths = rowCenters.map((y) =>
      flip
        ? `M0 ${y} C ${CONN_W * 0.45} ${y}, ${CONN_W * 0.55} ${midY}, ${CONN_W} ${midY}`
        : `M0 ${midY} C ${CONN_W * 0.45} ${midY}, ${CONN_W * 0.55} ${y}, ${CONN_W} ${y}`,
    );
    return (
      <div className="connector">
        <svg
          className="connector-svg"
          viewBox={`0 0 ${CONN_W} ${totalH}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {paths.map((d, i) => (
            <path key={i} d={d} vectorEffect="non-scaling-stroke" />
          ))}
          {paths.map((d, i) => {
            const y = flip ? midY : rowCenters[i];
            const x = flip ? CONN_W : 0;
            return <circle key={`d${i}`} cx={x} cy={y} r="2.5" className="conn-dot" />;
          })}
        </svg>
        {!flip &&
          rowCenters.map((y, i) => (
            <span className="split-pill" key={i} style={{ top: `${(y / totalH) * 100}%` }}>
              {data.rows[i].pct}%
            </span>
          ))}
      </div>
    );
  };

  return (
    <div className="routing-card">
      <div className="routing-head">
        <span className="routing-title">Routing</span>
        <span className="routing-meta">
          {data.from.token} → {data.to.token} · {data.rows.length} real routes · live quotes
        </span>
      </div>

      <div className="routing-scroll">
        <div className="routing-flow">
          <div className="endpoint">
            <div className="token-orb glow" style={{ background: data.from.color }}>
              <Logo src={tokenLogo(data.from.token, data.from.chain)} fallback={data.from.token} size={30} />
            </div>
          </div>

          <Connector flip={false} />

          <div className="routes-col">
            {data.rows.map((row, i) => (
              <div className="route-row" key={i}>
                <div className="route-row-label">{row.label}</div>
                <div className="hop-strip">
                  {row.hops.map((hop, j) => (
                    <Fragment key={j}>
                      {j > 0 && <span className="hop-arrow">&gt;</span>}
                      <HopCard hop={hop} />
                    </Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <Connector flip />

          <div className="endpoint">
            <div className="token-orb" style={{ background: data.to.color }}>
              <Logo src={tokenLogo(data.to.token, data.to.chain)} fallback={data.to.token} size={30} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}