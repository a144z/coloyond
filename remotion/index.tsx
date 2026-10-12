import { CAPTIONS } from "./narration/captions";
import { AutoPhone, RebalanceScene } from "./rebalance-scene";
import { beat, camera } from "./camera";
import {
  portfolioCardSvg,
  svgDataUrl,
  cardFamily,
  type PortfolioCardInput,
} from "../src/ui/app/lib/art/portfolio-card";
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Easing,
  Img,
  interpolate,
  registerRoot,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { MUSIC } from "./music";

const P = "#efece6",
  CARD = "#faf8f5",
  I = "#141414",
  M = "#747069",
  LINE = "#d8d4ca";
const C = ["#ff513b", "#1249ed", "#ffd523", "#8d25d9"];
export const TOTAL = 1860;

const ease = Easing.bezier(0.65, 0, 0.25, 1);
const t = (f: number, a: number, b: number, x = 0, y = 1) =>
  interpolate(f, [a, b], [x, y], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
const q = (f: number, a: number, b: number, x = 0, y = 1) =>
  t(f, beat(a), beat(b), x, y);
const pulse = (f: number, b: number) =>
  Math.sin(Math.PI * t(f, beat(b) - 3, beat(b) + 9));
const mono: React.CSSProperties = {
  fontFamily: "monospace",
  letterSpacing: 1.2,
  fontSize: 11,
};
const card: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${LINE}`,
  borderRadius: 18,
  padding: 20,
};
const label: React.CSSProperties = { ...mono, color: M, fontSize: 10 };

// One shared device, header and navigation. Every value and gesture is driven by the render frame.
function Strip({
  weights,
  height = 14,
}: {
  weights: number[];
  height?: number;
}) {
  return (
    <div
      style={{ display: "flex", height, borderRadius: 5, overflow: "hidden" }}
    >
      {weights.map((w, i) => (
        <div key={i} style={{ width: `${w}%`, background: C[i] }} />
      ))}
    </div>
  );
}
function Button({
  children,
  pressed = false,
  light = false,
}: {
  children: React.ReactNode;
  pressed?: boolean;
  light?: boolean;
}) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 12,
        background: light ? P : I,
        color: light ? I : P,
        border: `1px solid ${light ? LINE : I}`,
        fontSize: 13,
        fontWeight: 700,
        textAlign: "center",
        transform: `scale(${pressed ? 0.96 : 1})`,
      }}
    >
      {children}
    </div>
  );
}
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...mono,
        fontSize: 9,
        border: `1px solid ${LINE}`,
        padding: "6px 8px",
        borderRadius: 5,
        display: "inline-block",
        color: M,
      }}
    >
      {children}
    </div>
  );
}
function Title({
  kicker,
  title,
  copy,
}: {
  kicker: string;
  title: string;
  copy: string;
}) {
  return (
    <>
      <div style={{ ...label, marginBottom: 11 }}>{kicker}</div>
      <div
        style={{
          fontSize: 31,
          fontWeight: 750,
          lineHeight: 1.08,
          letterSpacing: -1.4,
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      <div
        style={{ fontSize: 14, lineHeight: 1.6, color: M, marginBottom: 22 }}
      >
        {copy}
      </div>
    </>
  );
}
function Home({ f }: { f: number }) {
  return (
    <div style={{ padding: 20 }}>
      <Title
        kicker="01 / PORTFOLIOS"
        title="Your portfolio desk."
        copy="Build a mix. Set your rhythm. Keep the whole picture in view."
      />
      <div
        style={{ ...card, marginBottom: 18, padding: 0, overflow: "hidden" }}
      >
        <Img
          src={staticFile("coloyond.jpg")}
          style={{
            width: "100%",
            height: 195,
            objectFit: "contain",
            background: "#e7e3dc",
          }}
        />
        <div style={{ padding: 20, fontSize: 19, fontWeight: 700 }}>
          Make room for your next mix.
        </div>
        <div
          style={{
            padding: "0 20px 20px",
            color: M,
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          Choose assets and weights, then review your portfolio before signing.
        </div>
      </div>
      <Button pressed={Math.abs(f - beat(14)) < 4}>+ Create portfolio</Button>
      <div style={{ marginTop: 20 }}>
        <Tag>DEVNET · UI DEMONSTRATION</Tag>
      </div>
    </div>
  );
}
function Mix({ f }: { f: number }) {
  const w = q(f, 20, 23, 60, 75) - q(f, 24, 27, 0, 30) + q(f, 28, 30, 0, 15);
  const locked = f >= beat(32);
  const added = f >= beat(41);
  const weights = added ? [60, 30, 10] : [w, 100 - w];
  return (
    <div
      style={{
        padding: 20,
        transform: `translateY(${-q(f, 33, 35) * 130 - q(f, 42, 44) * 90}px)`,
      }}
    >
      <Title
        kicker="02 / CREATE A PORTFOLIO"
        title="Set the balance."
        copy="Pick the assets and their weights. Make this mix your own."
      />
      <div style={{ ...label, marginBottom: 9 }}>PORTFOLIO NAME</div>
      <div style={{ ...card, padding: 15, fontSize: 16, marginBottom: 16 }}>
        Everyday mix
      </div>
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            justifyContent: "space-between",
            borderBottom: `1px solid ${LINE}`,
          }}
        >
          <b style={mono}>TARGET MIX</b>
          <span style={{ ...mono, color: M }}>
            {weights.map((x) => Math.round(x)).join(" / ")}
          </span>
        </div>
        <div style={{ padding: 20 }}>
          <Strip weights={weights} height={24} />
          {weights.map((weight, j) => (
            <div
              key={j}
              style={{
                padding: "22px 0 12px",
                borderBottom:
                  j < weights.length - 1 ? `1px solid ${LINE}` : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 7,
                    background: C[j],
                  }}
                />
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 16 }}>{["WSOL", "dUSD", "tBTC"][j]}</b>
                  <div style={{ fontSize: 11, color: M, marginTop: 5 }}>
                    {["Wrapped SOL", "Synthetic Devnet USD", "Test BTC"][j]}
                  </div>
                </div>
                <div style={{ ...mono, fontSize: 15 }}>
                  {Math.round(weight)}%
                </div>
                <div
                  style={{
                    ...mono,
                    fontSize: 9,
                    border: `1px solid ${LINE}`,
                    padding: "11px 8px",
                    borderRadius: 10,
                    background: j === 0 && locked ? I : P,
                    color: j === 0 && locked ? P : M,
                    transform:
                      j === 0 ? `scale(${1 - 0.06 * pulse(f, 32)})` : undefined,
                  }}
                >
                  {j === 0 && locked ? "LOCKED" : "LOCK"}
                </div>
              </div>
              <div style={{ height: 35, position: "relative", marginTop: 12 }}>
                <div
                  style={{
                    height: 8,
                    background: P,
                    border: `1px solid ${LINE}`,
                    borderRadius: 10,
                    position: "absolute",
                    top: 12,
                    width: "100%",
                  }}
                />
                <div
                  style={{
                    height: 8,
                    background: C[j],
                    borderRadius: 10,
                    position: "absolute",
                    top: 13,
                    width: `${weight}%`,
                  }}
                />
                <div
                  style={{
                    height: 22,
                    width: 22,
                    border: `1.5px solid ${I}`,
                    background: P,
                    borderRadius: 20,
                    position: "absolute",
                    top: 5,
                    left: `${weight}%`,
                    transform: "translateX(-50%)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <Button light pressed={Math.abs(f - beat(36)) < 4}>
          + Add asset
        </Button>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button pressed={Math.abs(f - beat(47)) < 4}>Review portfolio →</Button>
      </div>
    </div>
  );
}
const demoCard: PortfolioCardInput = {
  id: "demo-everyday",
  name: "Everyday mix",
  assets: [
    { id: "wsol", symbol: "WSOL", color: C[0], weight: 40 },
    { id: "teth", symbol: "tETH", color: C[3], weight: 20 },
    { id: "dusd", symbol: "dUSD", color: C[1], weight: 40 },
  ],
};
const galleryCards: PortfolioCardInput[] = [
  demoCard,
  {
    id: "demo-calm",
    name: "Quiet balance",
    assets: [
      { id: "wsol", symbol: "WSOL", color: C[0], weight: 20 },
      { id: "dusd", symbol: "dUSD", color: C[1], weight: 80 },
    ],
  },
  {
    id: "demo-horizon",
    name: "Wide horizon",
    assets: [
      { id: "wsol", symbol: "WSOL", color: C[0], weight: 35 },
      { id: "dusd", symbol: "dUSD", color: C[1], weight: 15 },
      { id: "tbtc", symbol: "tBTC", color: C[2], weight: 30 },
      { id: "teth", symbol: "tETH", color: C[3], weight: 20 },
    ],
  },
];
// Deliberately pick three deterministic example IDs illustrating the three available families.
galleryCards.forEach((input, j) => {
  const family = ["Orbit", "Prism", "Stack"][j];
  for (
    let n = 0;
    (cardFamily(input) !== family ||
      (j === 0 && cardFamily({ ...input, remix: 1 }) === family)) &&
    n < 100;
    n++
  )
    input.id = `demo-${j}-${n}`;
});
function CardSheet({ f }: { f: number }) {
  const p = q(f, 79, 81) * (1 - q(f, 93, 95));
  if (p === 0) return null;
  const remix = f >= beat(87) ? 1 : 0;

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(20,20,20,${p * 0.16})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "22px 24px",
          background: CARD,
          borderRadius: "24px 24px 0 0",
          transform: `translateY(${(1 - p) * 700}px)`,
        }}
      >
        <div style={{ ...label, marginBottom: 12 }}>
          CARD PNG SHARE · LOCAL RENDER
        </div>
        <b style={{ fontSize: 25, letterSpacing: -0.8 }}>
          Your mix, as one picture.
        </b>
        <div
          style={{
            position: "relative",
            width: 250,
            height: 312.5,
            margin: "18px auto 14px",
            border: `1px solid ${LINE}`,
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {[0, 1].map((v) => (
            <Img
              key={v}
              src={svgDataUrl(portfolioCardSvg({ ...demoCard, remix: v }))}
              style={{
                position: "absolute",
                inset: 0,
                width: 250,
                height: 312.5,
                opacity: v === 0 ? 1 - q(f, 87, 88) : q(f, 87, 88),
                transform: `translateX(${v === 0 ? -18 * q(f, 87, 88) : 18 * (1 - q(f, 87, 88))}px)`,
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            margin: "12px 0",
            ...mono,
            fontSize: 10,
          }}
        >
          <span>
            {cardFamily({ ...demoCard, remix })} · Remix {remix}
          </span>
          <div
            style={{
              padding: 12,
              border: `1px solid ${LINE}`,
              borderRadius: 8,
              background: P,
              transform: `scale(${1 - 0.04 * pulse(f, 74)})`,
            }}
          >
            Remix artwork
          </div>
        </div>
        <Button pressed={Math.abs(f - beat(90)) < 4}>Share PNG ↗</Button>
        <div style={{ marginTop: 12 }}>
          <Button light>Download PNG</Button>
        </div>
        <div style={{ ...label, textAlign: "center", marginTop: 15 }}>
          {f >= beat(90)
            ? "1200 × 1500 PNG · READY TO SHARE"
            : "TARGET WEIGHTS · NO WALLET ADDRESS"}
        </div>
      </div>
    </>
  );
}
function CardGallery({ f }: { f: number }) {
  if (f < beat(78) || f > beat(95)) return null;
  const enter = q(f, 78, 80),
    out = q(f, 93, 95);
  return (
    <div
      style={{
        position: "absolute",
        left: 850,
        top: 170,
        width: 930,
        opacity: enter * (1 - out),
      }}
    >
      <div style={{ ...mono, color: M, fontSize: 14, marginBottom: 26 }}>
        06 / CARD PNG SHARE
      </div>
      <div
        style={{
          fontSize: 78,
          fontWeight: 750,
          letterSpacing: -4,
          lineHeight: 1.1,
          overflow: "hidden",
        }}
      >
        {["Your portfolio.", "One picture."].map((line, j) => (
          <div
            key={line}
            style={{
              transform: `translateY(${(1 - q(f, 78 + j * 0.3, 80 + j * 0.3)) * 130}%)`,
            }}
          >
            {line}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 22, lineHeight: 1.6, color: M, marginTop: 25 }}>
        A visual composition built from your target weights.
        <br />
        Generate a PNG. Share it. Remix the picture.
      </div>
      <div style={{ display: "flex", gap: 24, marginTop: 40 }}>
        {galleryCards.map((input, j) => {
          const p = q(f, 81 + j, 83 + j);
          const source =
            j === 0 ? { ...input, remix: f >= beat(87) ? 1 : 0 } : input;
          return (
            <div
              key={input.id}
              style={{
                width: 270,
                opacity: p,
                transform: `translateY(${(1 - p) * 45}px)`,
              }}
            >
              <Img
                src={svgDataUrl(portfolioCardSvg(source))}
                style={{
                  width: 270,
                  height: 337.5,
                  borderRadius: 9,
                  border: `1px solid ${LINE}`,
                  boxShadow: "0 12px 30px #1414140d",
                }}
              />
              <div style={{ ...mono, color: M, fontSize: 11, marginTop: 14 }}>
                {input.name} / {cardFamily(source)}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          ...mono,
          color: M,
          marginTop: 25,
          fontSize: 11,
          opacity: q(f, 89, 91),
        }}
      >
        REMIX LINK → UNSIGNED DRAFT → YOUR OWN COMPOSITION
      </div>
    </div>
  );
}
function Sheet({ f, type }: { f: number; type: "asset" | "review" }) {
  const range = type === "asset" ? [36, 38, 41, 43] : [47, 49, 53, 55];
  const p = q(f, range[0], range[1]) * (1 - q(f, range[2], range[3]));
  if (!p) return null;
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(20,20,20,${p * 0.16})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: CARD,
          borderRadius: "25px 25px 0 0",
          padding: 24,
          boxShadow: "0 -10px 40px #14141415",
          transform: `translateY(${(1 - p) * 650}px)`,
        }}
      >
        <div
          style={{
            width: 34,
            height: 4,
            borderRadius: 4,
            background: LINE,
            margin: "0 auto 24px",
          }}
        />
        <div
          style={{
            fontSize: 26,
            letterSpacing: -1,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          {type === "asset" ? "Find the right fit." : "Review your mix."}
        </div>
        <div
          style={{ color: M, fontSize: 13, lineHeight: 1.6, marginBottom: 22 }}
        >
          {type === "asset"
            ? "Choose an asset to add to your target mix."
            : "Check the allocation before connecting your wallet and signing."}
        </div>
        {type === "asset" ? (
          <>
            {["WSOL", "dUSD", "tBTC"].map((x, j) => (
              <div
                key={x}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "20px 8px",
                  borderTop: `1px solid ${LINE}`,
                  background:
                    j === 2
                      ? `rgba(255,218,35,${q(f, 41, 42) * 0.15})`
                      : undefined,
                }}
              >
                <span
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 10,
                    background: C[j],
                  }}
                />
                <b>{x}</b>
                <span style={{ marginLeft: "auto", color: M }}>
                  {j === 2 && f >= beat(41) ? "✓" : "+"}
                </span>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ ...card, margin: "20px 0", fontSize: 16 }}>
              {type === "review" ? (
                <>
                  <b>Everyday mix</b>
                  <div style={{ margin: "18px 0" }}>
                    <Strip weights={[60, 30, 10]} height={20} />
                  </div>
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                    WSOL 60% · dUSD 30% · tBTC 10%
                  </span>
                </>
              ) : (
                <>
                  Amount <span style={{ float: "right" }}>0.50 SOL</span>
                </>
              )}
            </div>
            <Button>Connect wallet to continue</Button>
            <div style={{ ...label, textAlign: "center", marginTop: 18 }}>
              SIGNING REQUIRED · NO TRANSACTION SUBMITTED
            </div>
          </>
        )}
      </div>
    </>
  );
}
// Camera keyframes are component coordinates, not screenshot magnification.
const gestures = [
  { n: 11, x: 320, y: 450 },
  { n: 14, x: 193, y: 650 },
  { n: 17, x: 250, y: 562 },
  { n: 20, x: 214, y: 502 },
  { n: 23, x: 258, y: 502 },
  { n: 24, x: 258, y: 502 },
  { n: 27, x: 171, y: 502 },
  { n: 28, x: 171, y: 502 },
  { n: 30, x: 214, y: 502 },
  { n: 32, x: 309, y: 465 },
  { n: 34, x: 260, y: 530 },
  { n: 36, x: 190, y: 584 },
  { n: 39, x: 220, y: 712 },
  { n: 41, x: 230, y: 792 },
  { n: 44, x: 215, y: 668 },
  { n: 47, x: 196, y: 668 },
  { n: 50, x: 260, y: 630 },
  { n: 55, x: 260, y: 480 },
  { n: 57, x: 280, y: 450 },
  { n: 66, x: 280, y: 430 },
  { n: 77, x: 195, y: 547 },
  { n: 79, x: 195, y: 547 },
  { n: 83, x: 270, y: 510 },
  { n: 87, x: 310, y: 637 },
  { n: 90, x: 195, y: 692 },
  { n: 92, x: 230, y: 520 },
];
const clicks = [14, 32, 36, 41, 47, 79, 87, 90];
function Cursor({ f }: { f: number }) {
  if (f < beat(11) || f > beat(94)) return null;
  let a = gestures[0],
    b = gestures[gestures.length - 1];
  for (let j = 0; j < gestures.length - 1; j++) {
    if (f >= beat(gestures[j].n) && f < beat(gestures[j + 1].n)) {
      a = gestures[j];
      b = gestures[j + 1];
      break;
    }
  }
  const p = t(f, beat(a.n), beat(b.n));
  const x = a.x + (b.x - a.x) * p,
    y = a.y + (b.y - a.y) * p;
  let ring = 0,
    press = 0;
  for (const n of clicks) {
    if (f >= beat(n) && f < beat(n) + 18) {
      ring = (f - beat(n)) / 18;
      press = pulse(f, n);
    }
  }
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 30,
        pointerEvents: "none",
        opacity: q(f, 10, 11) * (1 - q(f, 92, 94)),
      }}
    >
      {ring > 0 ? (
        <div
          style={{
            position: "absolute",
            width: 44,
            height: 44,
            left: -22,
            top: -22,
            border: `1px solid ${I}`,
            borderRadius: 30,
            transform: `scale(${0.3 + ring})`,
            opacity: (1 - ring) * 0.5,
          }}
        />
      ) : null}
      <svg
        width="28"
        height="34"
        viewBox="0 0 28 34"
        style={{
          transform: `translate(-4px,-3px) scale(${1 - press * 0.18})`,
          filter: "drop-shadow(0 2px 2px #0003)",
        }}
      >
        <path
          d="M4 3 L4 26 L11 21 L16 31 L21 28 L16 18 L25 18 Z"
          fill={I}
          stroke={CARD}
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}
function Device({ f }: { f: number }) {
  const cam = camera(f);
  const create = q(f, 14, 17);
  const active = q(f, 54, 57);

  const nav = 0;
  // Device and route transform run independently: click, then response; shared chrome stays put.
  return (
    <div
      style={{
        position: "absolute",
        left: cam.x,
        top: cam.y,
        width: 390,
        height: 844,
        transform: `scale(${cam.s})`,
        transformOrigin: "0 0",
        opacity: q(f, 6, 10) * (1 - q(f, 95, 98)),
        border: `9px solid ${I}`,
        borderRadius: 36,
        background: P,
        boxShadow: "0 24px 60px #14141422",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 27,
          padding: "8px 22px 0",
          fontSize: 10,
          fontWeight: 700,
          display: "flex",
          justifyContent: "space-between",
          boxSizing: "border-box",
        }}
      >
        <span>9:41</span>
        <span>▂▄▆ ▰</span>
      </div>
      <div
        style={{
          height: 55,
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: `1px solid ${LINE}`,
          boxSizing: "border-box",
        }}
      >
        <Img
          src={staticFile("coloyond.jpg")}
          style={{ width: 31, height: 31, borderRadius: 6 }}
        />
        <b style={{ fontSize: 17, letterSpacing: -0.5 }}>Coloyond</b>
        <div
          style={{
            marginLeft: "auto",
            ...mono,
            fontSize: 8,
            padding: "10px 12px",
            background: I,
            color: P,
            borderRadius: 9,
          }}
        >
          CONNECT
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 82,
          left: 0,
          right: 0,
          bottom: 72,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translateX(${-create * 110}px)`,
            opacity: 1 - create,
          }}
        >
          <Home f={f} />
        </div>
        {f >= beat(14) && f < beat(57) ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translateX(${(1 - create) * 390}px) translateY(${-active * 180}px)`,
              opacity: 1 - active,
            }}
          >
            <Mix f={f} />
          </div>
        ) : null}
        {f >= beat(54) ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: active,
              transform: `translateY(${(1 - active) * 70}px)`,
            }}
          >
            <AutoPhone frame={f} />
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 17,
          height: 44,
          display: "flex",
          gap: 4,
        }}
      >
        {["Portfolios", "Wallet", "System"].map((x, j) => (
          <div
            key={x}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              borderRadius: 10,
              background: nav === j ? I : "transparent",
              color: nav === j ? P : M,
            }}
          >
            {x}
          </div>
        ))}
      </div>
      <Sheet f={f} type="asset" />
      <Sheet f={f} type="review" />
      <CardSheet f={f} />
      <Cursor f={f} />
    </div>
  );
}
const scenes = [
  {
    a: 9,
    z: 18,
    k: "01 / BUILD",
    lines: ["Your assets.", "Your rhythm."],
    copy: "A portfolio desk for the way you move.",
    mode: "rise",
    color: 0,
  },
  {
    a: 18,
    z: 34,
    k: "02 / ALLOCATE",
    lines: ["Slide it.", "Both ways."],
    copy: "Move the weight. Watch the balance respond.",
    mode: "slide",
    color: 1,
  },
  {
    a: 34,
    z: 45,
    k: "03 / CHOOSE",
    lines: ["Make room", "for the right fit."],
    copy: "Keep your locked weight. Add another asset.",
    mode: "mask",
    color: 2,
  },
  {
    a: 45,
    z: 56,
    k: "04 / REVIEW",
    lines: ["A clear mix.", "A considered move."],
    copy: "Review the allocation. Connect and sign when ready.",
    mode: "split",
    color: 3,
  },
];
function Editorial({ f }: { f: number }) {
  return (
    <>
      {scenes.map((s) => {
        if (f < beat(s.a) || f > beat(s.z)) return null;
        const enter = q(f, s.a, s.a + 2);
        const out = q(f, s.z - 1, s.z);
        const progress = enter * (1 - out);
        const drag =
          q(f, 20, 23, 0, 38) - q(f, 24, 27, 0, 65) + q(f, 28, 30, 0, 27);
        return (
          <div
            key={s.a}
            style={{
              position: "absolute",
              left: s.a === 45 ? 990 : 120,
              top: s.a === 45 ? 260 : 220,
              width: s.a === 45 ? 780 : 710,
              opacity: progress,
            }}
          >
            <div
              style={{
                ...mono,
                fontSize: 14,
                color: M,
                marginBottom: 32,
                transform: `translateX(${(1 - enter) * -40}px)`,
              }}
            >
              {s.k}
            </div>
            {s.lines.map((word, j) => {
              const p = q(f, s.a + 0.25 + j * 0.4, s.a + 2 + j * 0.4);
              return (
                <div
                  key={word}
                  style={{ overflow: "hidden", paddingBottom: 8 }}
                >
                  <div
                    style={{
                      fontSize: s.a === 45 ? 74 : 88,
                      fontWeight: 750,
                      letterSpacing: -4.5,
                      lineHeight: 1.08,
                      transform:
                        s.mode === "slide"
                          ? `translateX(${(1 - p) * (j ? 140 : -180) + (s.a === 18 ? 20 + drag * 0.5 * (j ? -1 : 1) : 0)}px)`
                          : s.mode === "split"
                            ? `translate(${(1 - p) * (j ? -120 : 120)}px,${(1 - p) * 35}px)`
                            : s.mode === "mask"
                              ? `translateX(${(1 - p) * -65}px)`
                              : `translateY(${(1 - p) * 125}%)`,
                      clipPath:
                        s.mode === "mask"
                          ? `inset(0 ${(1 - p) * 100}% 0 0)`
                          : undefined,
                    }}
                  >
                    {word}
                  </div>
                </div>
              );
            })}
            <div
              style={{
                height: 5,
                width: 220 * enter,
                background: C[s.color],
                margin: "28px 0",
              }}
            />
            <div
              style={{
                fontSize: 23,
                lineHeight: 1.6,
                color: M,
                maxWidth: 620,
                opacity: q(f, s.a + 1, s.a + 3),
              }}
            >
              {s.copy}
            </div>
            {s.a === 18 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 15,
                  marginTop: 34,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: 16,
                    fontSize: 90,
                    letterSpacing: -3,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    minWidth: 195,
                  }}
                >
                  {Math.round(
                    q(f, 20, 23, 60, 75) -
                      q(f, 24, 27, 0, 30) +
                      q(f, 28, 30, 0, 15),
                  )}
                  <span
                    style={{ fontSize: 38, letterSpacing: 0, fontWeight: 500 }}
                  >
                    %
                  </span>
                </span>
                <span style={{ ...mono, color: M }}>
                  {f >= beat(32) ? "WSOL · LOCKED" : "WSOL · TARGET WEIGHT"}
                </span>
              </div>
            ) : (
              <div style={{ ...mono, color: M, fontSize: 11, marginTop: 35 }}>
                {s.a === 45
                  ? "SIGNING REQUIRED"
                  : s.a >= 56
                    ? "ILLUSTRATIVE DEVNET DATA"
                    : "WEB + ANDROID"}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
function Geometry({ f }: { f: number }) {
  const opening = 1 - q(f, 6, 10);
  const ending = q(f, 94, 99);
  const energy = MUSIC.envelopes.bass[f] ?? 0;
  const high = MUSIC.envelopes.high[f] ?? 0;
  const power = Math.max(opening, ending);
  const tilt = q(f, 0, 6, -18, 0);
  return (
    <>
      <svg
        width="1920"
        height="1080"
        style={{ position: "absolute", inset: 0, opacity: 0.07 + 0.93 * power }}
        viewBox="0 0 1920 1080"
      >
        {C.map((c, j) => {
          const y = 240 + j * 155;
          const spread = power;
          const band = q(f, 18, 20) * (1 - q(f, 32, 35));
          const pts = [
            980 + spread * 60,
            540,
            1820,
            y - spread * 65,
            1820,
            y + 100 + spread * 35,
          ];
          const target = [
            940,
            420 + j * 34,
            1820,
            420 + j * 34,
            1820,
            450 + j * 34,
          ];
          const shape = pts.map((v, k) => v * (1 - band) + target[k] * band);
          return (
            <polygon
              key={c}
              points={shape.join(" ")}
              fill={c}
              style={{
                transform: `translate(${(1 - q(f, j * 0.5, 3 + j * 0.5)) * 500}px,0) rotate(${tilt * (j - 1.5) * 0.4}deg) scale(${1 + energy * 0.008})`,
                transformOrigin: "1040px 540px",
              }}
            />
          );
        })}
        <g
          style={{
            opacity: power,
            transform: `translate(${1040}px,${540}px) scale(${0.65 + 0.35 * power})`,
          }}
        >
          <polygon
            points="-210,-140 -30,-245 65,-190 -110,-85"
            fill="#a6a397"
          />
          <polygon points="-210,-140 -110,-85 -110,70 -210,20" fill="#77776e" />
          <polygon points="-210,20 -110,70 80,177 -20,215" fill="#45453e" />
          <polygon points="-110,-85 65,18 65,125 -110,20" fill="#5d5e54" />
        </g>
      </svg>
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 87,
          width: 8 + high * 6,
          height: 8 + high * 6,
          background: C[3],
          transform: "rotate(45deg)",
          opacity: 0.2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 75,
          ...mono,
          fontSize: 15,
          display: "flex",
          alignItems: "center",
          gap: 13,
        }}
      >
        <Img
          src={staticFile("coloyond.jpg")}
          style={{ width: 38, height: 38, borderRadius: 7 }}
        />
        <span>COLOYOND</span>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: 120,
          right: 120,
          display: "flex",
          justifyContent: "space-between",
          ...mono,
          fontSize: 10,
          color: M,
        }}
      >
        <span>YOUR MIX. YOUR RHYTHM.</span>
        <span>UI DEMONSTRATION · DEVNET</span>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 108,
          left: 120,
          right: 120,
          height: 1,
          background: LINE,
        }}
      >
        <div
          style={{ height: 1, width: `${(f / TOTAL) * 100}%`, background: I }}
        />
      </div>
    </>
  );
}
function Brand({ f, end = false }: { f: number; end?: boolean }) {
  const a = end ? 95 : 0;
  const show = end ? q(f, 95, 99) : q(f, 0, 2) * (1 - q(f, 6, 9));
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: end ? 260 : 300,
        width: 900,
        opacity: show,
      }}
    >
      <div
        style={{
          ...mono,
          color: M,
          fontSize: 15,
          marginBottom: 28,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: `translateY(${(1 - q(f, a, a + 2)) * 100}%)`,
          }}
        >
          {end ? "A MIX OF YOUR OWN" : "A NEW RHYTHM FOR YOUR PORTFOLIO"}
        </span>
      </div>
      <div
        style={{
          fontSize: 112,
          letterSpacing: -7,
          fontWeight: 750,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {"Coloyond.".split("").map((x, j) => (
          <span
            key={j}
            style={{
              display: "inline-block",
              transform: `translateY(${(1 - q(f, a + j * 0.12, a + 2 + j * 0.12)) * 150}%)`,
            }}
          >
            {x}
          </span>
        ))}
      </div>
      <div
        style={{
          fontSize: 30,
          color: M,
          lineHeight: 1.5,
          marginTop: 24,
          opacity: q(f, a + 2, a + 4),
        }}
      >
        {end
          ? "Build your mix. Keep your rhythm."
          : "Your portfolio as one picture."}
      </div>
      {end ? (
        <div
          style={{
            display: "flex",
            gap: 15,
            marginTop: 42,
            opacity: q(f, 99, 101),
          }}
        >
          <span
            style={{
              padding: "16px 22px",
              borderRadius: 12,
              background: I,
              color: P,
              fontSize: 17,
            }}
          >
            Explore /app ↗
          </span>
          <span
            style={{
              padding: "16px 22px",
              borderRadius: 12,
              border: `1px solid ${LINE}`,
              fontSize: 17,
            }}
          >
            Web + Android
          </span>
        </div>
      ) : null}
      {end ? (
        <div
          style={{
            ...mono,
            color: M,
            marginTop: 28,
            fontSize: 11,
            opacity: q(f, 97, 99),
          }}
        >
          github.com/a144z/coloyond
        </div>
      ) : null}
    </div>
  );
}
function NarrationCaptions({ frame }: { frame: number }) {
  const cue = CAPTIONS.find((c) => frame / 30 >= c.start && frame / 30 < c.end);
  if (!cue) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 150,
        right: 150,
        bottom: 35,
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          display: "inline-block",
          padding: "12px 22px",
          borderRadius: 10,
          background: "rgba(20,20,20,.94)",
          color: P,
          fontSize: 26,
          fontWeight: 500,
          lineHeight: 1.35,
          boxShadow: "0 3px 12px #0001",
        }}
      >
        {cue.text}
      </span>
    </div>
  );
}
export function Film() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: P,
        color: I,
        fontFamily: "Arial, Helvetica, sans-serif",
        overflow: "hidden",
      }}
    >
      <Audio
        src={staticFile("audio/coloyond-uploaded-music.m4a")}
        volume={(frame) => {
          const duck = Math.max(
            0,
            ...CAPTIONS.map(
              (c) =>
                t(frame, c.start * 30 - 8, c.start * 30) *
                (1 - t(frame, c.end * 30, c.end * 30 + 12)),
            ),
          );
          const base = 0.34 - 0.18 * duck;
          return base * t(frame, 0, 12) * (1 - t(frame, TOTAL - 30, TOTAL));
        }}
      />
      <Audio src={staticFile("audio/coloyond-narration.wav")} volume={0.94} />
      <Geometry f={f} />
      <Editorial f={f} />
      <Device f={f} />
      <RebalanceScene frame={f} />
      <CardGallery f={f} />
      <Brand f={f} />
      <Brand f={f} end />
      <NarrationCaptions frame={f} />
    </AbsoluteFill>
  );
}
registerRoot(() => (
  <Composition
    id="MobileShowcase"
    component={Film}
    durationInFrames={TOTAL}
    fps={30}
    width={1920}
    height={1080}
  />
));
