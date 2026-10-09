export const INTRO_TITLE = ["A little room", "for interpretation."];

export const INTRO_COPY = [
  "The strategy has an identity. Its expression can keep changing.",
  "Abstract artwork, an optional caption, and a quiet factual footer. The financial details stay within reach.",
];

export const PREVIEW_LABEL = "Offline product preview · Sample artwork and IDs";

export const STATUS_TIME = "9:41";
export const STATUS_GLYPHS = "▰ ▰ ▰";

export const TOP_LINKS = { create: "Saved", remix: "Remix" };

export const SCREENS = [
  ["01", "Select a strategy"],
  ["02", "Save an expression"],
  ["03", "Make a remix"],
];

export const STUDY_LABELS = ["Folded planes", "An interrupted orbit", "Almost meeting"];

export const STUDY_SHAPES = [
  "Illustrative folded planes with cobalt, coral, yellow, and violet beams",
  "Illustrative interrupted black ring with saturated colored planes",
  "Illustrative offset slabs with an opening between blue and yellow forms",
];

export const CAPTIONS = [
  "The yellow arrived first",
  "Held, lightly",
  "An opening at the edge",
  "Almost a circle",
  "Still becoming",
  "Where the light goes",
  "Between possibilities",
  "Beyond this moment",
  "An unfamiliar horizon",
  "What might unfold",
];

export const NOTICE = {
  study: "Showing another authored visual study. The strategy ID stays the same.",
  remix: "Showing a sample remix expression. No financial action was performed.",
  saved: "Saved this illustrative expression for sharing. The imported remix parent stays intact.",
};

export const SHARE_DIALOG = {
  title: "Share card layout",
  note: "Illustrative export layout. The product renders a 1080 × 1350 PNG locally and exports the validated strategy separately.",
  close: "Close preview",
};

export interface StrategyCardData {
  id: string;
  network: string;
  label: string;
  funding: { left: string; right: string };
  targets: { asset: string; pct: number; dotClass: string }[];
  bar: { bluePct: number };
  details: { summary: string; body: string };
  generate: string;
  micro: string[];
}

export const STRATEGY: StrategyCardData = {
  id: "cb2:7c4a91…e912b7",
  network: "Solana",
  label: "Existing managed strategy · sample",
  funding: { left: "One share token", right: "Protocol managed" },
  targets: [
    { asset: "Target jupSOL", pct: 60, dotClass: "" },
    { asset: "Target USDC", pct: 40, dotClass: "yellow" },
  ],
  bar: { bluePct: 60 },
  details: {
    summary: "Strategy details",
    body: "Illustrative saved target weights, not actual holdings. The product verifies an existing vault, its share mint, fees, management activity, NAV, and independent Jupiter entry/exit routes. No live vault is verified in this preview.",
  },
  generate: "Generate image",
  micro: [
    "Preview interaction cycles authored visual studies.",
    "Live GenAI and vault verification are specified.",
  ],
};

export interface ExpressionCardData {
  id: string;
  facts: string[];
  tools: { image: string; caption: string };
  save: string;
  share: string;
  details: { summary: string; body: string };
  micro: string[];
}

export const EXPRESSION: ExpressionCardData = {
  id: STRATEGY.id,
  facts: [
    "Target weights · saved configuration",
    "60% jupSOL / 40% USDC · Symmetry / Solana · Sample",
  ],
  tools: { image: "Another image", caption: "Another caption" },
  save: "Save expression",
  share: "Share preview",
  details: {
    summary: "View strategy",
    body: "The artwork interprets a saved configuration. NAV, market price, current holdings, and an executable quote are separate facts. Sharing does not buy a token.",
  },
  micro: ["The caption belongs to this expression.", "The strategy ID stays the same."],
};

export interface RemixData {
  parentStudy: number;
  parentLabel: string;
  parentId: string;
  caption: string;
  baseId: string;
  baseStatus: string;
  allocations: { value: number; label: string }[];
  ids: { [value: number]: string };
  statuses: { [value: number]: string };
  explanations: { [value: number]: string };
  preview: string;
  micro: string;
}

export const REMIX: RemixData = {
  parentStudy: 0,
  parentLabel: "From this expression",
  parentId: "cbe1:8b716e…639ca2",
  caption: "An opening at the edge",
  baseId: "cb2:a18f32…03c47e",
  baseStatus: "Changed strategy",
  allocations: [
    { value: 70, label: "70 / 30 · another sample vault" },
    { value: 60, label: "60 / 40 · same saved strategy" },
    { value: 50, label: "50 / 50 · unmatched draft" },
  ],
  ids: {
    50: "cbd1:9de257…af63d9",
    60: "cb2:7c4a91…e912b7",
    70: "cb2:a18f32…03c47e",
  },
  statuses: {
    70: "Another sample vault",
    60: "Same saved strategy",
    50: "Allocation draft · no vault",
  },
  explanations: {
    70: "Select another existing vault; the parent stays intact.",
    60: "Another expression for the same saved strategy.",
    50: "Desired weights only. No matching vault or share mint is implied.",
  },
  preview: "Preview new expression",
  micro: "No live purchase is available in this preview.",
};

export const FOOTNOTES = [
  "One share token represents managed holdings. Saved target weights remain readable; actual composition and current NAV are separate facts.",
  "Captions can be sensory, spatial, intimate, or absent. They stay small enough to let the image speak.",
  "A remix inherits a visual gesture. Select another existing vault, or keep desired weights as an explicit draft. The parent stays intact.",
];

export const FOOTER_NOTE =
  "Design artifact only. No wallet, inference, live quotes, or financial execution.\nAll shown IDs are illustrative. Color reflects composition, not risk.";

export const FOOTER_LINK = {
  label: "Read the specification →",
  href: "/docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md",
};

export const SHARE_TARGET = "Saved expression";
