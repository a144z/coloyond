import { useId } from "react";
import type { ReadModelV1 } from "./types.js";
import styles from "./PortfolioStatus.module.css";

type Weight = ReadModelV1["vault"]["target"][number];
type CompositionKind = "target" | "actual";
type OracleObservation = ReadModelV1["oracle"][number];

function formatWeightBps(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) return null;
  return `${(value / 100).toFixed(2)}%`;
}

function parseTimestamp(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "Unknown";
  return parseTimestamp(value)?.toISOString() ?? "Invalid timestamp";
}

function formatAge(value: string | null, now = Date.now()): string {
  if (value === null) return "Unknown";
  const observedAt = parseTimestamp(value);
  if (observedAt === null) return "Invalid timestamp";

  const seconds = Math.floor((now - observedAt.getTime()) / 1_000);
  if (seconds < 0) return "Timestamp is in the future";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function formatBps(value: number | null): string {
  if (value === null) return "Unknown";
  if (!Number.isInteger(value) || value < 0 || value > 10_000) return "Invalid read-model value";
  return `${value} bps · ${(value / 100).toFixed(2)}%`;
}

function formatUsd(value: string | null): string {
  if (value === null) return "Unavailable";
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return "Invalid read-model value";
  return `USD ${value}`;
}

function formatBaseUnits(value: string): string {
  return /^(?:0|[1-9]\d*)$/.test(value) ? value : "Invalid read-model value";
}

function formatOraclePublishTime(value: string | null): string {
  if (value === null) return "Unknown";
  return /^(?:0|[1-9]\d*)$/.test(value) ? `${value} Unix seconds` : "Invalid read-model value";
}

function formatOracleAge(value: number | null): string {
  if (value === null) return "Unknown";
  if (!Number.isSafeInteger(value) || value < 0) return "Invalid read-model value";
  return `${value} sec`;
}

function availability(value: boolean | null): string {
  if (value === null) return "Unknown";
  return value ? "Reported available" : "Reported unavailable";
}

function exitAvailability(model: ReadModelV1["vault"]["exit"]): string {
  return model.mode === "in_kind" ? availability(model.available) : "Unknown";
}

function WeightList({ items, kind }: { items: Weight[]; kind: CompositionKind }) {
  if (items.length === 0) {
    return <p className={styles.empty}>No {kind === "target" ? "target" : "actual"} weight entries reported.</p>;
  }

  return (
    <ul className={styles.weights}>
      {items.map((item, index) => {
        const weight = formatWeightBps(item.weightBps);
        const symbol = item.symbol.trim() || "Unnamed asset";
        return (
          <li className={styles.weightRow} key={`${item.mint}:${index}`}>
            <div className={styles.weightHeading}>
              <strong>{symbol}</strong>
              <span>{weight ?? "Unknown weight"}</span>
            </div>
            {weight === null ? (
              <p className={styles.invalidWeight}>Allocation bar omitted because this weight is invalid.</p>
            ) : (
              <div className={styles.track} aria-hidden="true">
                <span className={kind === "target" ? styles.targetFill : styles.actualFill} style={{ width: `${item.weightBps / 100}%` }} />
              </div>
            )}
            <code className={styles.mint}>{item.mint}</code>
          </li>
        );
      })}
    </ul>
  );
}

function ReserveRows({ title, amounts }: { title: string; amounts: Record<string, string> }) {
  const entries = Object.entries(amounts).sort(([left], [right]) => left.localeCompare(right));
  return (
    <div className={styles.reserveGroup}>
      <h4>{title}</h4>
      {entries.length === 0 ? (
        <p className={styles.empty}>No token entries in this snapshot.</p>
      ) : (
        <ul className={styles.rawAmounts}>
          {entries.map(([mint, amount]) => (
            <li key={mint}>
              <code>{mint}</code>
              <strong>{formatBaseUnits(amount)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OracleRows({ observations }: { observations: OracleObservation[] }) {
  if (observations.length === 0) {
    return <p className={styles.empty}>No oracle observations reported.</p>;
  }

  return (
    <ul className={styles.oracleList}>
      {observations.map((observation, index) => {
        const stateClass = observation.state === "stale" || observation.state === "depegged"
          ? styles.oracleAttention
          : styles.oracleNeutral;
        return (
          <li className={styles.oracleRow} key={`${observation.feedId}:${index}`}>
            <div className={styles.oracleHeading}>
              <code>{observation.feedId}</code>
              <strong className={stateClass}>{observation.state}</strong>
            </div>
            <dl className={styles.oracleFacts}>
              <div><dt>Verification</dt><dd>{observation.verification}</dd></div>
              <div><dt>Age</dt><dd>{formatOracleAge(observation.ageSeconds)}</dd></div>
              <div><dt>Publish time</dt><dd>{formatOraclePublishTime(observation.publishTime)}</dd></div>
              <div><dt>Confidence</dt><dd>{formatBps(observation.confidenceBps)}</dd></div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

/** Read-only presentation of the frozen public ReadModelV1 projection. */
export function PortfolioStatus({ model }: { model: ReadModelV1 }) {
  const id = useId();
  const { source, network, program, vault, oracle, auction, reserve, lastConfirmedTransition } = model;
  const fixture = source.kind === "fixture";
  const observedAt = formatTimestamp(source.observedAt);
  const sourceAge = formatAge(source.observedAt);
  const identityId = `portfolio-status-${id}`;
  const targetId = `${identityId}-target`;
  const actualId = `${identityId}-actual`;
  const valuationId = `${identityId}-valuation`;
  const vaultId = `${identityId}-vault`;
  const oracleId = `${identityId}-oracle`;
  const settlementId = `${identityId}-settlement`;
  const transitionId = `${identityId}-transition`;

  return (
    <section className={styles.root} aria-labelledby={identityId}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Portfolio / public state</p>
          <h2 id={identityId}>Portfolio status</h2>
          <p className={styles.lede}>Configured targets and observed holdings are shown as separate facts from one read-model snapshot.</p>
        </div>
        <span className={`${styles.sourceBadge} ${fixture ? styles.fixtureBadge : styles.rpcBadge}`}>
          {fixture ? "Synthetic fixture · sample data" : "RPC-reported snapshot"}
        </span>
      </header>

      {fixture && (
        <p className={styles.fixtureNotice} role="note">
          SYNTHETIC FIXTURE — this is sample data, not a live cluster observation.
        </p>
      )}

      <dl className={styles.sourceFacts} aria-label="Read-model source and observation">
        <div><dt>Cluster</dt><dd>{network.cluster}</dd></div>
        <div><dt>Provider</dt><dd>{source.providerLabel ?? "Unknown"}</dd></div>
        <div>
          <dt>Observed at</dt>
          <dd>
            <time dateTime={parseTimestamp(source.observedAt)?.toISOString()}>{observedAt}</time>
            <small className={styles.age}>Age at display · {sourceAge}</small>
          </dd>
        </div>
        <div><dt>Slot</dt><dd>{source.slot ?? "Unknown"}</dd></div>
        <div className={styles.genesisFact}><dt>Genesis hash</dt><dd>{network.genesisHash ?? "Unknown"}</dd></div>
      </dl>

      <dl className={styles.identityFacts} aria-label="Vault and program identity">
        <div><dt>Vault address</dt><dd>{vault.address ?? "Unknown"}</dd></div>
        <div><dt>Share mint</dt><dd>{vault.shareMint ?? "Unknown"}</dd></div>
        <div><dt>Program ID</dt><dd>{program.programId ?? "Unknown"}</dd></div>
        <div><dt>Program binary hash</dt><dd>{program.binaryHash ?? "Unknown"}</dd></div>
        <div><dt>Program verified flag</dt><dd>{program.verified ? "true" : "false"}</dd></div>
      </dl>

      <div className={styles.compositionGrid}>
        <section className={`${styles.composition} ${styles.targetPanel}`} aria-labelledby={targetId}>
          <div className={styles.panelHeading}>
            <div><p className={styles.index}>01 / Configuration</p><h3 id={targetId}>Target weights</h3></div>
            <span>Configured</span>
          </div>
          <p className={styles.panelCopy}>Desired allocation stored in the vault configuration.</p>
          <WeightList items={vault.target} kind="target" />
        </section>

        <section className={`${styles.composition} ${styles.actualPanel}`} aria-labelledby={actualId}>
          <div className={styles.panelHeading}>
            <div><p className={styles.index}>02 / Observation</p><h3 id={actualId}>Actual weights</h3></div>
            <span>Balance-derived</span>
          </div>
          <p className={styles.panelCopy}>Observed balance composition. It may differ from targets as prices and activity change.</p>
          {vault.actual === null ? (
            <p className={styles.empty}>Actual composition is unknown in this observation.</p>
          ) : (
            <WeightList items={vault.actual} kind="actual" />
          )}
        </section>
      </div>

      <div className={styles.factsGrid}>
        <section className={styles.factPanel} aria-labelledby={valuationId}>
          <p className={styles.index}>03 / Valuation</p>
          <h3 id={valuationId}>Estimate is not a quote</h3>
          <dl className={styles.keyFacts}>
            <div><dt>Estimated NAV</dt><dd>{formatUsd(vault.estimatedNavUsd)}</dd></div>
            <div><dt>Executable quote</dt><dd>Not provided</dd></div>
          </dl>
          <p className={styles.note}>NAV is an estimate tied to the observation above. This read model does not establish liquidity or an executable price for any amount or route.</p>
        </section>

        <section className={styles.factPanel} aria-labelledby={vaultId}>
          <p className={styles.index}>04 / Vault</p>
          <h3 id={vaultId}>Vault facts</h3>
          <dl className={styles.keyFacts}>
            <div><dt>Phase</dt><dd>{vault.phase}</dd></div>
            <div><dt>Configuration revision</dt><dd>{vault.configRevision ?? "Unknown"}</dd></div>
            <div><dt>Total share supply</dt><dd>{vault.totalSupply === null ? "Unavailable" : formatBaseUnits(vault.totalSupply)} <small>raw base units</small></dd></div>
            <div><dt>Exit availability</dt><dd>{exitAvailability(vault.exit)}</dd></div>
            <div><dt>Exit mode</dt><dd>{vault.exit.mode === "in_kind" ? "In kind" : "Unknown"}</dd></div>
          </dl>
          <p className={styles.note}>Share decimals are not part of ReadModelV1, so supply is shown in raw base units. Exit availability is a reported snapshot fact; no quote or transaction is prepared here.</p>
        </section>
      </div>

      <section className={styles.oraclePanel} aria-labelledby={oracleId}>
        <div className={styles.panelHeading}>
          <div><p className={styles.index}>05 / Price evidence</p><h3 id={oracleId}>Oracle observations</h3></div>
          <span>State preserved</span>
        </div>
        <OracleRows observations={oracle} />
        <p className={styles.note}>Oracle age and state are shown as reported. Stale, depegged, unavailable, or unknown data is not treated as a usable price.</p>
      </section>

      <section className={styles.settlementPanel} aria-labelledby={settlementId}>
        <div className={styles.panelHeading}>
          <div><p className={styles.index}>06 / Settlement</p><h3 id={settlementId}>Fee, reserve &amp; exit</h3></div>
          <span>{auction === null ? "Auction state unavailable" : "Auction snapshot"}</span>
        </div>
        <dl className={styles.keyFacts}>
          <div><dt>Auction fee</dt><dd>{auction === null ? "Unknown" : formatBps(auction.feeBps)}</dd></div>
          <div><dt>In-kind exit</dt><dd>{exitAvailability(vault.exit)}</dd></div>
        </dl>
        {reserve === null ? (
          <p className={styles.empty}>Reserve balances and bounty liabilities are unknown in this observation.</p>
        ) : (
          <div className={styles.reserveGrid}>
            <ReserveRows title="Reserve amounts · raw base units" amounts={reserve.amountByMint} />
            <ReserveRows title="Bounty liabilities · raw base units" amounts={reserve.bountyLiabilityByMint} />
          </div>
        )}
        <p className={styles.note}>Reserve values are raw token base units keyed by mint. ReadModelV1 does not include token decimals or a USD conversion, so no dollar total is inferred.</p>
      </section>

      <section className={styles.transitionPanel} aria-labelledby={transitionId}>
        <div className={styles.panelHeading}>
          <div><p className={styles.index}>07 / Confirmed activity</p><h3 id={transitionId}>Last confirmed transition</h3></div>
          <span>{lastConfirmedTransition === null ? "None reported" : "Confirmed in read model"}</span>
        </div>
        {lastConfirmedTransition === null ? (
          <p className={styles.empty}>No confirmed transition is included in this snapshot.</p>
        ) : (
          <dl className={styles.transitionFacts}>
            <div><dt>Kind</dt><dd>{lastConfirmedTransition.kind}</dd></div>
            <div><dt>Slot</dt><dd>{lastConfirmedTransition.slot}</dd></div>
            <div className={styles.signatureFact}><dt>Signature</dt><dd><code>{lastConfirmedTransition.signature}</code></dd></div>
          </dl>
        )}
      </section>
    </section>
  );
}
