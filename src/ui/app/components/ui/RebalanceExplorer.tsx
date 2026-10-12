import { useState } from "react";
import {
  exampleAssets,
  rebalanceIllustration,
} from "../../lib/rebalance/illustration.js";
import { LedgerPanel } from "./LedgerPanel.js";
import { Button } from "./Button.js";
export function RebalanceExplorer({
  targets,
}: {
  targets: Record<string, number>;
}) {
  const [sol, setSol] = useState(20),
    [eth, setEth] = useState(-20),
    [settled, setSettled] = useState(false);
  const model = rebalanceIllustration(
    exampleAssets(targets, { wsol: sol, teth: eth }),
  );
  const hasEth = (targets.teth ?? 0) > 0;
  return (
    <LedgerPanel
      stripe="Explore a price change"
      meta="illustration · $1,000 start"
    >
      <p className="text-[12px] leading-relaxed text-iron">
        Targets are value percentages, not token counts. Move a price and see
        the mix drift, then explore the trades toward your targets.
      </p>
      {[
        { id: "wsol", name: "SOL", v: sol, set: setSol },
        { id: "teth", name: "ETH", v: eth, set: setEth },
      ]
        .filter((a) => (targets[a.id] ?? 0) > 0)
        .map((a) => (
          <label key={a.id} className="mt-4 block">
            <span className="flex justify-between text-[12px] font-bold">
              <span>{a.name} price change</span>
              <span>
                {a.v > 0 ? "+" : ""}
                {a.v} %
              </span>
            </span>
            <input
              type="range"
              min={-50}
              max={50}
              step={1}
              value={a.v}
              onChange={(e) => {
                a.set(Number(e.target.value));
                setSettled(false);
              }}
              aria-label={`Illustrative ${a.name} price change`}
              className="ledger-range mt-2 w-full"
            />
          </label>
        ))}
      <div className="mt-4 flex h-5 overflow-hidden rounded">
        {model.rows.map((r) => (
          <div
            key={r.id}
            style={{
              width: `${settled ? r.targetPct : r.actualPct}%`,
              background: r.color,
            }}
          />
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {model.rows.map((r) => (
          <div
            key={r.id}
            className="flex items-baseline justify-between gap-3 text-[12px]"
          >
            <b>{r.symbol}</b>
            <span className="font-mono">
              {(settled ? r.targetPct : r.actualPct).toFixed(2)} %{" "}
              <span className="text-iron">/ {r.targetPct} % target</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg border border-hairline p-3 text-[12px] leading-relaxed">
        {model.maxDrift < 0.001
          ? "This illustration already matches the targets."
          : model.sells.concat(model.buys).map((r) => (
              <div key={r.id}>
                {r.deltaValue < 0 ? "Sell" : "Buy"}{" "}
                {Math.abs(r.deltaValue / r.price).toFixed(6)} {r.symbol}{" "}
                <span className="text-iron">
                  · ${Math.abs(r.deltaValue).toFixed(2)}
                </span>
              </div>
            ))}
      </div>
      <div className="mt-3">
        <Button full variant="secondary" onClick={() => setSettled((s) => !s)}>
          {settled ? "Show price drift" : "Illustrate rebalance"}
        </Button>
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-iron">
        Fee-free model · no transaction. Actual execution needs fresh verified
        prices, liquidity, slippage bounds and a funded cranker. SOL is wrapped
        in the vault;{" "}
        {hasEth
          ? "ETH is represented by synthetic devnet tETH."
          : "other assets are labeled in the portfolio."}
      </p>
    </LedgerPanel>
  );
}
