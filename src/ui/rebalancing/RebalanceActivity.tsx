import type { ReadModelV1 } from "./types.js";
import styles from "./RebalanceActivity.module.css";

export type RebalanceActivityStatus =
  | "within-band"
  | "eligible"
  | "open"
  | "partial"
  | "stalled"
  | "expired"
  | "paused"
  | "stale"
  | "unknown";

type DecodedStatus = Exclude<RebalanceActivityStatus, "unknown">;

export const REBALANCE_ACTIVITY_STATUS_LABELS: Record<RebalanceActivityStatus, string> = {
  "within-band": "Within band",
  eligible: "Eligible",
  open: "Open",
  partial: "Partially filled",
  stalled: "Stalled",
  expired: "Expired",
  paused: "Paused",
  stale: "Stale",
  unknown: "State unknown",
};

/** A lifecycle assessment must be tied to the exact public snapshot it describes. */
export interface RebalanceActivityAssessment {
  status: DecodedStatus;
  snapshot: {
    cluster: ReadModelV1["network"]["cluster"];
    genesisHash: string;
    programId: string;
    vaultAddress: string;
    configRevision: string;
    observedAt: string;
    slot: string;
    auctionSequence: string | null;
  };
}

export type ConfirmedTransitionStatus =
  | { state: "confirmed"; kind: string; slot: string; signature: string }
  | { state: "unknown" };

const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;
const SIGNED_INTEGER = /^(?:0|-?[1-9]\d*)$/;
const U64_MAX = 18_446_744_073_709_551_615n;

function isCanonicalU64(value: string): boolean {
  return value.length <= 20 && UNSIGNED_INTEGER.test(value) && BigInt(value) <= U64_MAX;
}

function epochSeconds(value: string | null): bigint | null {
  if (value === null) return null;
  if (SIGNED_INTEGER.test(value)) return BigInt(value);
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? BigInt(Math.floor(milliseconds / 1000)) : null;
}

function isExpired(model: ReadModelV1): boolean {
  if (model.vault.phase !== "auction" || model.auction === null) return false;
  const observed = epochSeconds(model.source.observedAt);
  const expires = epochSeconds(model.auction.expiresAt);
  return observed !== null && expires !== null && observed >= expires;
}

function matchesSnapshot(model: ReadModelV1, assessment: RebalanceActivityAssessment): boolean {
  return model.network.genesisHash !== null
    && model.program.programId !== null
    && model.vault.address !== null
    && model.vault.configRevision !== null
    && model.source.observedAt !== null
    && model.source.slot !== null
    && model.network.cluster === assessment.snapshot.cluster
    && model.network.genesisHash === assessment.snapshot.genesisHash
    && model.program.programId === assessment.snapshot.programId
    && model.vault.address === assessment.snapshot.vaultAddress
    && model.vault.configRevision === assessment.snapshot.configRevision
    && model.source.observedAt === assessment.snapshot.observedAt
    && model.source.slot === assessment.snapshot.slot
    && (model.auction?.sequence ?? null) === assessment.snapshot.auctionSequence;
}

function statusFitsPhase(model: ReadModelV1, status: DecodedStatus): boolean {
  if (status === "within-band" || status === "eligible") {
    return model.vault.phase === "active" && model.auction === null;
  }
  if (status === "open" || status === "partial" || status === "stalled") {
    return model.vault.phase === "auction" && model.auction !== null;
  }
  if (status === "expired") return isExpired(model);
  if (status === "paused") return model.vault.phase === "paused";
  return status === "stale";
}

/**
 * Resolve only what this snapshot can establish. In particular, `active` does
 * not prove within-band/eligible, and a condition-rule eligibility is separate
 * from rebalance eligibility.
 */
export function resolveRebalanceActivityStatus(
  model: ReadModelV1,
  assessment?: RebalanceActivityAssessment | null,
): RebalanceActivityStatus {
  if (model.vault.phase === "paused") return "paused";
  if (isExpired(model)) return "expired";
  if (model.oracle.some((feed) => feed.state === "stale")) return "stale";
  if (!assessment || !matchesSnapshot(model, assessment) || !statusFitsPhase(model, assessment.status)) return "unknown";
  return assessment.status;
}

export function confirmedTransitionStatus(model: ReadModelV1): ConfirmedTransitionStatus {
  const transition = model.lastConfirmedTransition;
  if (transition === null || transition.signature.trim() === "" || transition.kind.trim() === "" || !isCanonicalU64(transition.slot)) {
    return { state: "unknown" };
  }
  return { state: "confirmed", kind: transition.kind, slot: transition.slot, signature: transition.signature };
}

export function formatExactTimestamp(value: string | null): string {
  if (value === null) return "Unknown";
  if (SIGNED_INTEGER.test(value)) {
    const milliseconds = BigInt(value) * 1000n;
    if (milliseconds <= 8_640_000_000_000_000n && milliseconds >= -8_640_000_000_000_000n) {
      const date = new Date(Number(milliseconds));
      if (!Number.isNaN(date.getTime())) return `${date.toISOString()} · ${value} Unix seconds`;
    }
    return `${value} Unix seconds`;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? `${value} · ${new Date(milliseconds).toISOString()}` : `Unrecognized timestamp · ${value}`;
}

function exactInteger(value: string | null): string {
  if (value === null) return "Unknown";
  return UNSIGNED_INTEGER.test(value) ? value : "Invalid read-model value";
}

function StateDescription({ status }: { status: RebalanceActivityStatus }) {
  const descriptions: Record<RebalanceActivityStatus, string> = {
    "within-band": "The matched decoder assessment reports drift within the configured rebalance band.",
    eligible: "A matched decoder assessment reports rebalance eligibility. Eligibility is not a submitted transaction or a confirmed trade.",
    open: "A matched decoder assessment reports an open auction in this snapshot.",
    partial: "A matched decoder assessment reports a partial fill. The remaining amount below is the value in the read model.",
    stalled: "A matched decoder assessment reports stalled progress. This display does not infer a keeper action.",
    expired: "The auction expiry is at or before this snapshot’s observed time.",
    paused: "The vault phase in this read model is paused.",
    stale: "At least one oracle feed in this read model is marked stale, or a matched decoder assessment reports stale state.",
    unknown: "This snapshot does not establish a lifecycle state. Missing activity facts remain unknown.",
  };
  return <p className={styles.stateDescription}>{descriptions[status]}</p>;
}

/** Read-only lifecycle presentation; it never submits or implies a transaction. */
export function RebalanceActivity({
  model,
  assessment = null,
}: {
  model: ReadModelV1;
  assessment?: RebalanceActivityAssessment | null;
}) {
  const status = resolveRebalanceActivityStatus(model, assessment);
  const fixture = model.source.kind === "fixture";
  const auction = model.auction;
  const transition = confirmedTransitionStatus(model);

  return (
    <section className={styles.root} aria-labelledby="rebalance-activity-title">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Portfolio / protocol activity</p>
          <h2 id="rebalance-activity-title">Rebalance activity</h2>
          <p className={styles.lede}>Lifecycle labels are tied to one decoded snapshot. A ready or eligible state is not transaction confirmation.</p>
        </div>
        <span className={`${styles.sourceBadge} ${fixture ? styles.fixtureBadge : styles.rpcBadge}`}>
          {fixture ? "Synthetic fixture · sample data" : "RPC observation"}
        </span>
      </header>

      {fixture && <p className={styles.fixtureNotice} role="note">SYNTHETIC FIXTURE — this is sample data, not a live cluster observation.</p>}

      <dl className={styles.sourceFacts} aria-label="Read-model source and observation">
        <div><dt>Cluster</dt><dd>{model.network.cluster}</dd></div>
        <div><dt>Provider</dt><dd>{model.source.providerLabel ?? "Unknown"}</dd></div>
        <div><dt>Observed at</dt><dd>{formatExactTimestamp(model.source.observedAt)}</dd></div>
        <div><dt>Observed slot</dt><dd>{exactInteger(model.source.slot)}</dd></div>
      </dl>

      <section className={styles.statePanel} aria-label="Rebalance lifecycle state" aria-live="polite">
        <div className={styles.stateHeading}>
          <div><p className={styles.index}>01 / Lifecycle</p><h3>{REBALANCE_ACTIVITY_STATUS_LABELS[status]}</h3></div>
          <span className={styles.stateBadge}>{status === "unknown" ? "No classification" : "Snapshot classification"}</span>
        </div>
        <StateDescription status={status} />
        {assessment && status === "unknown" && (
          <p className={styles.note}>The supplied assessment does not match this snapshot’s observed time, slot, auction sequence, or vault phase.</p>
        )}
      </section>

      <section className={styles.auctionPanel} aria-labelledby="auction-facts-title">
        <div className={styles.panelHeading}>
          <div><p className={styles.index}>02 / Auction</p><h3 id="auction-facts-title">Decoded activity facts</h3></div>
          <span>{auction === null ? "Not reported" : "Read-model snapshot"}</span>
        </div>
        {auction === null ? (
          <p className={styles.empty}>No auction facts are present in this read-model snapshot.</p>
        ) : (
          <dl className={styles.activityFacts}>
            <div><dt>Sequence</dt><dd>{exactInteger(auction.sequence)}</dd></div>
            <div><dt>Remaining · raw base units</dt><dd>{exactInteger(auction.remaining)}</dd></div>
            <div><dt>Expires at</dt><dd>{formatExactTimestamp(auction.expiresAt)}</dd></div>
          </dl>
        )}
      </section>

      <section className={styles.transitionPanel} aria-labelledby="transition-title">
        <div className={styles.panelHeading}>
          <div><p className={styles.index}>03 / Transaction record</p><h3 id="transition-title">Last confirmed transition</h3></div>
          <span>{transition.state === "unknown" ? "Unknown" : "Confirmed on chain"}</span>
        </div>
        {transition.state === "unknown" ? (
          <p className={styles.empty}>No confirmed transition is included in this snapshot.</p>
        ) : (
          <dl className={styles.activityFacts}>
            <div><dt>Kind</dt><dd>{transition.kind || "Unknown"}</dd></div>
            <div><dt>Confirmed slot</dt><dd>{exactInteger(transition.slot)}</dd></div>
            <div className={styles.signatureFact}><dt>Signature</dt><dd><code>{transition.signature || "Unknown"}</code></dd></div>
          </dl>
        )}
        <p className={styles.note}>Submitted transaction status is not part of ReadModelV1 and remains unknown here. Only the explicit last-confirmed transition is labeled confirmed.</p>
      </section>
    </section>
  );
}
