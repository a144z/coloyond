// The live bridge between the portfolio desk and the verified ETF client.
// Pure functions only: no React, no DOM, no network beyond the deployment
// loader. The desk may only show what the verified snapshot can honestly
// support, so every gate here mirrors etf-client's own rules for building a
// poke (verified snapshot, Full feeds inside accepted limits, pool usable) and
// the live drift uses the same BigInt math the program mirrors (deviationBps
// over oracle-marked USD values). Fail-closed by construction: an unusable
// input yields a null figure plus a reason string, never a guess.
import { Connection } from "@solana/web3.js";
import {
  ETF_DEVNET_GENESIS_HASH,
  WeightedMathFailure,
  deviationBps,
  isQuoteDirectionImproving,
  normalizeUsdValue,
  quoteExactIn,
  verifyEtfManifest,
  type EtfPoolSnapshot,
  type VerifiedEtfManifest,
} from "../../../packages/etf-client/src/index.js";

/** The same accepted-deployment resources the transaction desk reads. */
import { ETF_DEPLOYMENT_MANIFESTS_URL, ETF_DEPLOYMENT_MANIFEST_URL, ETF_IDL_URL } from "../etf/deploymentProbe.js";
export { ETF_DEPLOYMENT_MANIFEST_URL, ETF_IDL_URL };

export type EtfLiveContextResult = Readonly<
  | { status: "ready"; genesis: string; context: VerifiedEtfManifest }
  | { status: "unreachable"; reason: string }
  | { status: "genesis_mismatch"; actual: string | null }
  | { status: "awaiting_deployment"; reason: string }
>;

async function readJson(resource: Response, label: string): Promise<unknown> {
  if (!resource.ok || !(resource.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
    throw new Error(resource.ok ? `${label}_not_published_as_json` : `${label}_http_${resource.status}`);
  }
  try {
    return (await resource.json()) as unknown;
  } catch {
    throw new Error(`${label}_invalid_json`);
  }
}

/** Fetches the accepted manifest plus matching IDL and admits them against the pinned Devnet genesis. */
export async function loadVerifiedEtfContext(connection: Connection): Promise<EtfLiveContextResult> {
  let genesis: string;
  try {
    genesis = await connection.getGenesisHash();
  } catch {
    return { status: "unreachable", reason: "genesis_read_failed" };
  }
  if (genesis !== ETF_DEVNET_GENESIS_HASH) return { status: "genesis_mismatch", actual: genesis };
  try {
    const [manifestResponse, idlResponse] = await Promise.all([
      fetch(ETF_DEPLOYMENT_MANIFEST_URL, { cache: "no-store" }),
      fetch(ETF_IDL_URL, { cache: "no-store" }),
    ]);
    const manifest = await readJson(manifestResponse, "deployment_manifest");
    const idl = await readJson(idlResponse, "etf_idl");
    return { status: "ready", genesis, context: verifyEtfManifest(manifest, idl, genesis) };
  } catch (error) {
    return { status: "awaiting_deployment", reason: error instanceof Error ? error.message : "deployment_resources_unreadable" };
  }
}

/** The vault registry: zero or more accepted manifests, each admitted on its own. */
export type EtfVaultRegistryResult = Readonly<
  | { status: "ready"; genesis: string; contexts: readonly VerifiedEtfManifest[]; rejected: readonly { label: string; reason: string }[]; instructionNames: readonly string[] }
  | { status: "unreachable"; reason: string }
  | { status: "genesis_mismatch"; actual: string | null }
  | { status: "awaiting_deployment"; reason: string }
>;

/** Accepts one document, a list, or a `{ manifests: [...] }` envelope; the pending placeholder yields none. */
export function parseRegistryDocument(parsed: unknown): readonly unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object" || parsed === null) throw new Error("deployment_manifests_unrecognised");
  const record = parsed as { status?: unknown; manifests?: unknown; schema?: unknown };
  if (record.status === "pending") return [];
  if (Array.isArray(record.manifests)) return record.manifests as readonly unknown[];
  if (typeof record.schema === "string") return [record];
  throw new Error("deployment_manifests_unrecognised");
}

async function fetchServedJson(url: string): Promise<{ json: unknown } | { error: string }> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { error: `http_${response.status}` };
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) return { error: "not_served_as_json" };
    return { json: await response.json() };
  } catch {
    return { error: "fetch_failed" };
  }
}

/** Loads the vault registry: the plural list when served, else the single manifest wrapped; verifies each entry, rejects each failure by name. */
export async function loadEtfVaultRegistry(connection: Connection): Promise<EtfVaultRegistryResult> {
  let genesis: string;
  try {
    genesis = await connection.getGenesisHash();
  } catch {
    return { status: "unreachable", reason: "genesis_read_failed" };
  }
  if (genesis !== ETF_DEVNET_GENESIS_HASH) return { status: "genesis_mismatch", actual: genesis };
  const listSource = await fetchServedJson(ETF_DEPLOYMENT_MANIFESTS_URL);
  let documents: readonly unknown[];
  if ("json" in listSource) {
    try {
      documents = parseRegistryDocument(listSource.json);
    } catch (error) {
      return { status: "awaiting_deployment", reason: error instanceof Error ? error.message : "deployment_manifests_unreadable" };
    }
  } else {
    const singleSource = await fetchServedJson(ETF_DEPLOYMENT_MANIFEST_URL);
    if ("error" in singleSource) return { status: "awaiting_deployment", reason: `deployment_manifest_${singleSource.error}` };
    try {
      documents = parseRegistryDocument(singleSource.json);
    } catch (error) {
      return { status: "awaiting_deployment", reason: error instanceof Error ? error.message : "deployment_manifest_unreadable" };
    }
  }
  const idlSource = await fetchServedJson(ETF_IDL_URL);
  if ("error" in idlSource) return { status: "awaiting_deployment", reason: `etf_idl_${idlSource.error}` };
  const contexts: VerifiedEtfManifest[] = [];
  const rejected: { label: string; reason: string }[] = [];
  for (const [index, document] of documents.entries()) {
    const label = typeof document === "object" && document !== null ? String((document as { pool?: unknown }).pool ?? (document as { programId?: unknown }).programId ?? `entry ${index + 1}`) : `entry ${index + 1}`;
    try {
      contexts.push(verifyEtfManifest(document, idlSource.json, genesis));
    } catch (error) {
      rejected.push({ label, reason: error instanceof Error ? error.message : "manifest_rejected" });
    }
  }
  if (contexts.length === 0) {
    return { status: "awaiting_deployment", reason: rejected.length > 0 ? `no_manifest_accepted (${rejected.map((entry) => `${entry.label}: ${entry.reason}`).join("; ")})` : "no_deployment_manifest_served" };
  }
  const instructionNames = Array.isArray((idlSource.json as { instructions?: unknown }).instructions) ? ((idlSource.json as { instructions: { name: string }[] }).instructions).map((instruction) => instruction.name) : [];
  return { status: "ready", genesis, contexts, rejected, instructionNames };
}

/** Which of the architecture's verbs today's verified IDL already exposes, by instruction name; null means pending in the program. */
export function etfProgramVerbs(instructionNames: readonly string[]): Readonly<{ schedule: string | null; setTargets: string | null; close: string | null }> {
  const find = (candidates: readonly string[]): string | null => instructionNames.find((name) => candidates.includes(name)) ?? null;
  return Object.freeze({
    schedule: find(["schedule_rebalance", "schedule_poke", "schedule_task", "schedule"]),
    setTargets: find(["set_target_weights", "set_targets", "update_target_weights", "update_targets", "set_strategy", "set_pool_config"]),
    close: find(["close_pool", "close"]),
  });
}

export type EtfLiveAssetRow = Readonly<{
  label: string;
  backing: "native_wrapped" | "synthetic_unbacked";
  decimals: number;
  targetPct: number;
  /** Null whenever any figure needed to weigh this asset is missing or the feed is not accepted. */
  livePct: number | null;
  valueUsd: number | null;
  custodyAmount: string;
  feedReady: boolean;
  verification: string;
  freshness: string;
  ageSeconds: string | null;
  confidenceBpsCeil: string | null;
}>;

/** One side of the move a rebalance would make: pool gives ("out") or pool takes ("in"). */
export type EtfRebalanceMove = Readonly<{ label: string; direction: "in" | "out"; amount: number; usd: number }>;

/** What correcting today's drift would take, with the blueprint's §4.6 fee tier applied to it. */
export type EtfRebalancePreview = Readonly<{ moves: readonly EtfRebalanceMove[]; totalUsd: number; feeTierBps: number; feePct: number }>;

export type EtfLiveDeskState = Readonly<{
  lifecycle: EtfPoolSnapshot["state"]["lifecycle"];
  riskPaused: boolean;
  driftBps: number | null;
  driftPct: number | null;
  driftReason: string | null;
  rebalance: EtfRebalancePreview | null;
  rebalanceReason: string | null;
  assets: readonly EtfLiveAssetRow[];
  lastObservation: EtfPoolSnapshot["state"]["lastObservation"];
  schedulerEnabled: boolean;
  schedulerGeneration: string;
  /** True exactly while buildEligibilityPokeInstruction would accept this snapshot. */
  pokeReady: boolean;
  pokeBlockedReason: string | null;
}>;

// The same total-variation drift the program's mirror reports, over oracle-
// marked USD values; null plus a reason, never a fabricated number.
function liveValues(snapshot: EtfPoolSnapshot): { values: readonly bigint[]; reason: null } | { values: null; reason: string } {
  const values: bigint[] = [];
  for (const asset of snapshot.assets) {
    const oracle = asset.oracle;
    if (oracle.verification !== "full" || oracle.freshness !== "within_approved_limits") return { values: null, reason: `asset_${asset.index}_oracle_not_within_approved_limits` };
    if (oracle.rawPrice === null || oracle.exponent === null) return { values: null, reason: `asset_${asset.index}_oracle_price_unreadable` };
    values.push(normalizeUsdValue(BigInt(asset.custodyAmount), asset.decimals, BigInt(oracle.rawPrice), oracle.exponent));
  }
  return { values, reason: null };
}

function pow10(exponent: bigint): bigint {
  return 10n ** exponent;
}

/** Converts an oracle-marked USD delta back into base units of one asset, inverting the shared normalizer exactly. */
function baseUnitsFor(absoluteValue: bigint, asset: EtfPoolSnapshot["assets"][number]): bigint {
  const raw = BigInt(asset.oracle.rawPrice!);
  const denominatorExponent = BigInt(asset.decimals) - BigInt(asset.oracle.exponent!);
  return denominatorExponent >= 12n ? (absoluteValue * pow10(denominatorExponent - 12n)) / raw : absoluteValue / (raw * pow10(12n - denominatorExponent));
}

/** The single funded swap the preview suggests: the biggest underweight asset in against the biggest overweight one out, quoted through the program's own math. */
export type EtfRebalanceSwapPlan = Readonly<{ assetIn: number; assetOut: number; amountIn: bigint; expectedOut: bigint; minAmountOut: bigint }>;

/** Null plus a reason whenever no honest swap stands: unusable snapshot, oracle outside limits, no lean to correct, or the program's accepted input cap. */
export function planRebalanceSwap(context: VerifiedEtfManifest, snapshot: EtfPoolSnapshot): Readonly<{ plan: EtfRebalanceSwapPlan | null; reason: string }> {
  if (snapshot.state.lifecycle === "closed") return { plan: null, reason: "pool_closed" };
  if (snapshot.state.riskPaused) return { plan: null, reason: "risk_paused" };
  if (snapshot.state.lifecycle === "unseeded") return { plan: null, reason: "pool_not_seeded" };
  const marks = liveValues(snapshot);
  if (marks.values === null) return { plan: null, reason: marks.reason };
  const values = marks.values;
  const weights = snapshot.assets.map((asset) => asset.targetWeightBps);
  const total = values.reduce((sum, value) => sum + value, 0n);
  if (total === 0n) return { plan: null, reason: "ZeroTotalValue" };
  let outIndex = -1;
  let inIndex = -1;
  let outDelta = 0n;
  let inDelta = 0n;
  for (const [index, value] of values.entries()) {
    const target = (total * BigInt(weights[index]!)) / 10_000n;
    const delta = value - target;
    if (delta > outDelta) { outDelta = delta; outIndex = index; }
    if (delta < 0n && -delta > inDelta) { inDelta = -delta; inIndex = index; }
  }
  if (outIndex < 0 || inIndex < 0) return { plan: null, reason: "on_target" };
  const amountIn = baseUnitsFor(inDelta, snapshot.assets[inIndex]!);
  const balances = snapshot.assets.map((asset) => BigInt(asset.custodyAmount));
  if (amountIn > (balances[inIndex]! * BigInt(context.manifest.feePolicy.maximumInputBps)) / 10_000n) return { plan: null, reason: "swap_exceeds_accepted_input_cap" };
  const feeBps = context.manifest.feePolicy.swapFeeBps;
  let quote: ReturnType<typeof quoteExactIn>;
  try {
    quote = quoteExactIn(balances, weights, inIndex, outIndex, amountIn, feeBps);
  } catch (error) {
    return { plan: null, reason: error instanceof WeightedMathFailure ? `quote_${error.code}` : "quote_failed" };
  }
  const marksForQuote = snapshot.assets.map((asset) => ({ mintDecimals: asset.decimals, rawPrice: BigInt(asset.oracle.rawPrice!), priceExponent: asset.oracle.exponent! }));
  let improves = false;
  try {
    improves = isQuoteDirectionImproving(balances, weights, inIndex, outIndex, quote, feeBps, marksForQuote);
  } catch {
    improves = false;
  }
  if (!improves) return { plan: null, reason: "swap_would_not_improve_drift" };
  return { plan: Object.freeze({ assetIn: inIndex, assetOut: outIndex, amountIn, expectedOut: quote.amountOut, minAmountOut: (quote.amountOut * 9_900n) / 10_000n }), reason: "planned" };
}

/** Sizes the move a rebalance would make per asset, from the same oracle-marked values the drift uses; null plus a reason when the drift itself is not computable. */
export function computeRebalancePreview(values: readonly bigint[] | null, snapshot: EtfPoolSnapshot, weights: readonly number[], driftBps: number | null, driftReason: string | null): Readonly<{ preview: EtfRebalancePreview | null; reason: string | null }> {
  if (driftBps === null) return { preview: null, reason: driftReason ?? "drift_uncomputable" };
  if (values === null) return { preview: null, reason: driftReason ?? "oracle_not_within_approved_limits" };
  const feeTierBps = driftBps >= 1_000 ? 1_000 : driftBps >= 500 ? 500 : 30;
  const total = values.reduce((sum, value) => sum + value, 0n);
  const moves: EtfRebalanceMove[] = [];
  for (const [index, asset] of snapshot.assets.entries()) {
    const value = values[index]!;
    const target = (total * BigInt(weights[index]!)) / 10_000n;
    const delta = value - target;
    if (delta === 0n) continue;
    const bringing = delta < 0n;
    const absolute = bringing ? -delta : delta;
    const baseDelta = baseUnitsFor(absolute, asset);
    const amount = Number(baseDelta) / 10 ** asset.decimals;
    const usd = Number(absolute / 1_000_000_000_000n) + Number(absolute % 1_000_000_000_000n) / 1_000_000_000_000;
    moves.push(Object.freeze({ label: asset.label, direction: bringing ? "in" as const : "out" as const, amount, usd }));
  }
  const totalUsd = moves.filter((move) => move.direction === "out").reduce((sum, move) => sum + move.usd, 0);
  return { preview: Object.freeze({ moves: Object.freeze(moves), totalUsd, feeTierBps, feePct: feeTierBps / 100 }), reason: null };
}

/** Describes what the desk may show from one verified snapshot; every number here came from RPC state. */
export function describeLiveEtfDesk(snapshot: EtfPoolSnapshot): EtfLiveDeskState {
  const weights = snapshot.assets.map((asset) => asset.targetWeightBps);
  const marks = liveValues(snapshot);
  let driftBps: number | null = null;
  let driftReason: string | null = null;
  if (marks.values === null) {
    driftReason = marks.reason;
  } else {
    try {
      driftBps = deviationBps(marks.values, weights);
    } catch (error) {
      driftReason = error instanceof WeightedMathFailure ? error.code : "drift_uncomputable";
    }
  }
  const total = marks.values === null ? 0n : marks.values.reduce((sum, value) => sum + value, 0n);
  const assets = snapshot.assets.map((asset, index) => {
    const oracle = asset.oracle;
    const priceReadable = oracle.verification === "full" && oracle.freshness === "within_approved_limits" && oracle.rawPrice !== null && oracle.exponent !== null;
    let valueQ: bigint | null = null;
    if (priceReadable) {
      try {
        valueQ = normalizeUsdValue(BigInt(asset.custodyAmount), asset.decimals, BigInt(oracle.rawPrice!), oracle.exponent!);
      } catch {
        valueQ = null;
      }
    }
    return Object.freeze({
      label: asset.label,
      backing: asset.backing,
      decimals: asset.decimals,
      targetPct: asset.targetWeightBps / 100,
      livePct: valueQ === null || total === 0n ? null : Number((valueQ * 10_000n) / total) / 100,
      valueUsd: valueQ === null ? null : Number(valueQ / 1_000_000n) / 1_000_000,
      custodyAmount: asset.custodyAmount,
      feedReady: priceReadable,
      verification: oracle.verification,
      freshness: oracle.freshness,
      ageSeconds: oracle.ageSeconds,
      confidenceBpsCeil: oracle.confidenceBpsCeil,
    });
  });
  const feedsReady = assets.every((row) => row.feedReady);
  const preview = computeRebalancePreview(marks.values, snapshot, weights, driftBps, driftReason);
  const blocked =
    snapshot.state.lifecycle === "closed" ? "pool_closed" :
      snapshot.state.riskPaused ? "risk_paused" :
        snapshot.state.lifecycle === "unseeded" ? "pool_not_seeded" :
          feedsReady ? null : "oracle_outside_accepted_limits";
  return Object.freeze({
    lifecycle: snapshot.state.lifecycle,
    riskPaused: snapshot.state.riskPaused,
    driftBps,
    driftPct: driftBps === null ? null : driftBps / 100,
    driftReason,
    rebalance: preview.preview,
    rebalanceReason: preview.reason,
    assets,
    lastObservation: snapshot.state.lastObservation,
    schedulerEnabled: snapshot.state.schedulerEnabled,
    schedulerGeneration: snapshot.state.schedulerGeneration,
    pokeReady: blocked === null,
    pokeBlockedReason: blocked,
  });
}
