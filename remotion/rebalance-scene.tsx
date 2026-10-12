import { beat } from "./camera";
import React from "react";
import { Easing, interpolate } from "remotion";
import {
  exampleAssets,
  rebalanceIllustration,
} from "../src/ui/app/lib/rebalance/illustration.js";
const INK = "#141414",
  MUTED = "#747069",
  PAPER = "#efece6",
  CARD = "#faf8f5",
  LINE = "#d8d4ca";
const smooth = (f: number, a: number, b: number, x = 0, y = 1) =>
  interpolate(f, [a * 30, b * 30], [x, y], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.42, 0, 0.58, 1),
  });
export function illustrationAt(frame: number) {
  const shock = smooth(frame, beat(66) / 30, beat(70) / 30);
  const restored = smooth(frame, beat(73) / 30, beat(78) / 30);
  const model = rebalanceIllustration(
    exampleAssets(
      { wsol: 40, teth: 20, dusd: 40 },
      { wsol: 20 * shock, teth: -20 * shock },
    ),
  );
  return { ...model, shock, restored };
}
function ModelBar({ frame, height = 34 }: { frame: number; height?: number }) {
  const { rows, restored } = illustrationAt(frame);
  return (
    <div
      style={{ display: "flex", height, borderRadius: 6, overflow: "hidden" }}
    >
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            width: `${row.actualPct * (1 - restored) + row.targetPct * restored}%`,
            background: row.color,
          }}
        />
      ))}
    </div>
  );
}
export function AutoPhone({ frame }: { frame: number }) {
  const { rows, restored, shock } = illustrationAt(frame);
  return (
    <div style={{ position: "absolute", inset: 0, padding: 20 }}>
      <div style={{ font: "10px monospace", letterSpacing: 1.2, color: MUTED }}>
        REBALANCE EXPLORER
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 750,
          letterSpacing: -1,
          marginTop: 12,
        }}
      >
        A mix in balance.
      </div>
      <div
        style={{
          position: "absolute",
          left: 20,
          top: 102,
          font: "9px monospace",
          letterSpacing: 1,
          padding: "6px 8px",
          border: `1px solid ${LINE}`,
          borderRadius: 6,
        }}
      >
        ILLUSTRATION · NO TRANSACTION
      </div>
      <div
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          top: 148,
          padding: 20,
          border: `1px solid ${LINE}`,
          borderRadius: 18,
          background: CARD,
        }}
      >
        <div style={{ font: "10px monospace", color: MUTED, marginBottom: 22 }}>
          TARGET / CURRENT VALUE MIX
        </div>
        <ModelBar frame={frame} height={25} />
        <div style={{ marginTop: 20 }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: 15,
                margin: "17px 0",
              }}
            >
              <b>{r.symbol}</b>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 5,
                  fontFamily: "monospace",
                }}
              >
                {(
                  r.actualPct * (1 - restored) +
                  r.targetPct * restored
                ).toFixed(1)}
                <span>%</span>
                <span style={{ color: MUTED, fontSize: 10, marginLeft: 7 }}>
                  / {r.targetPct} %
                </span>
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            borderTop: `1px solid ${LINE}`,
            paddingTop: 15,
            color: MUTED,
            fontSize: 11,
          }}
        >
          {restored > 0.98
            ? "Target values restored in this example"
            : shock > 0.95
              ? "Prices changed · weights have drifted"
              : "Illustrative starting value: $1,000"}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          top: 440,
          padding: 16,
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          textAlign: "center",
          fontSize: 13,
          fontWeight: 700,
          background: PAPER,
        }}
      >
        Share portfolio card ↗
      </div>
      <div
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          top: 510,
          fontSize: 11,
          color: MUTED,
          lineHeight: 1.7,
        }}
      >
        Fee-free model. Actual fills depend on verified prices, fees, liquidity
        and configured guards. ETH is synthetic devnet tETH.
      </div>
    </div>
  );
}
export function RebalanceScene({ frame }: { frame: number }) {
  if (frame < 32.7 * 30 || frame > 47.6 * 30) return null;
  const enter = smooth(frame, 32.7, 34),
    leave = smooth(frame, 47, 47.6);
  const { rows, total, restored, shock } = illustrationAt(frame);
  const movement = smooth(frame, beat(73) / 30, beat(75) / 30);
  return (
    <div
      style={{
        position: "absolute",
        left: 850,
        top: 165,
        width: 900,
        opacity: enter * (1 - leave),
        color: INK,
      }}
    >
      <div
        style={{
          font: "14px monospace",
          letterSpacing: 1.8,
          color: MUTED,
          marginBottom: 25,
        }}
      >
        05 / AUTOMATED COUNTERBALANCE
      </div>
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 750,
            letterSpacing: -4,
            lineHeight: 1.08,
            transform: `translateY(${(1 - enter) * 120}%)`,
          }}
        >
          Prices move.
          <br />
          The mix responds.
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 28 }}>
        {rows
          .filter((r) => r.id !== "dusd")
          .map((r) => (
            <div
              key={r.id}
              style={{
                padding: "14px 20px",
                border: `1px solid ${LINE}`,
                background: CARD,
                borderRadius: 12,
                fontSize: 21,
                display: "flex",
                gap: 15,
                alignItems: "baseline",
              }}
            >
              <b>{r.symbol}</b>
              <span style={{ color: r.color, fontFamily: "monospace" }}>
                {r.id === "wsol" ? "+" : "−"}
                {(20 * shock).toFixed(0)} %
              </span>
            </div>
          ))}
      </div>
      <div
        style={{
          marginTop: 25,
          padding: 26,
          background: CARD,
          border: `1px solid ${LINE}`,
          borderRadius: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: "12px monospace",
            letterSpacing: 1,
            color: MUTED,
            marginBottom: 20,
          }}
        >
          <span>
            {restored > 0.98
              ? "TARGET RESTORED"
              : shock > 0.95
                ? "VALUE WEIGHTS AFTER PRICE SHOCK"
                : "TARGET VALUE WEIGHTS"}
          </span>
          <span>${total.toFixed(0)} MODEL VALUE</span>
        </div>
        <ModelBar frame={frame} height={44} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 19,
          }}
        >
          {rows.map((r) => (
            <div key={r.id}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                {r.symbol}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 9,
                  fontSize: 32,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {(
                  r.actualPct * (1 - restored) +
                  r.targetPct * restored
                ).toFixed(2)}
                <span style={{ fontSize: 17, fontWeight: 500 }}>%</span>
              </div>
              <div
                style={{ font: "10px monospace", color: MUTED, marginTop: 8 }}
              >
                {r.targetPct} % TARGET
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: 22,
          display: "flex",
          gap: 14,
          opacity: movement,
          transform: `translateX(${(1 - movement) * -45}px)`,
        }}
      >
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              flex: 1,
              padding: "16px 19px",
              border: `1px solid ${LINE}`,
              borderRadius: 12,
              background: CARD,
            }}
          >
            <div
              style={{ font: "11px monospace", color: MUTED, marginBottom: 10 }}
            >
              {r.id === "wsol" ? "SELL OVERWEIGHT" : "BUY UNDERWEIGHT"}
            </div>
            <div style={{ fontSize: 23, fontWeight: 700 }}>
              {r.symbol}{" "}
              <span style={{ color: r.color, float: "right" }}>
                ${Math.abs(r.deltaValue).toFixed(0)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          font: "12px monospace",
          color: MUTED,
          lineHeight: 1.7,
          marginTop: 22,
        }}
      >
        SIMPLIFIED, FEE-FREE ILLUSTRATION · NOT A RECORDED TRADE
        <br />
        Actual devnet settlement receipts are linked in the submission proof.
      </div>
    </div>
  );
}
