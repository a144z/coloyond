import type { ReadModelV1 } from "./types.js";
import styles from "./PortfolioStatus.module.css";

type Weight = ReadModelV1["vault"]["target"][number];
type CompositionKind = "target" | "actual";

function formatWeightBps(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) return null;
  return `${(value / 100).toFixed(2)}%`;
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Invalid timestamp" : parsed.toISOString();
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

function availability(value: boolean | null): string {
  if (value === null) return "Unknown";
  return value ? "Available" : "Unavailable";
}

function WeightList({ items, kind }: { items: Weight[]; kind: CompositionKind }) {
  if (items.length === 0) {
    return <p className={styles.empty}>No {kind === "target" ? "target weights" : "actual weights"} reported.</p>;
  }

  return (
    <ul className={styles.weights}>
      {items.map((item, index) => {
        const weight = formatWeightBps(item.weightBps);
        const symbol = item.symbol.trim() || "Unnamed asset";
        const width = weight === null ? "0%" : `${item.weightBps / 100}%`;
        return (
          <li className={styles.weightRow} key={`${item.mint}:${index}`}>
            <div className={styles.weightHeading}>
              <strong>{symbol}</strong>
              <span>{weight ?? "Unknown weight"}</span>
            </div>
            <div className={styles.track} aria-hidden="true">
              <span className={kind === "target" ? styles.targetFill : styles.actualFill} style={{ width }} />
            </div>
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
        <p className={styles.empty}>No amounts reported.</p>
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

/** Read-only presentation of the frozen public ReadModelV1 projection. */
export function PortfolioStatus({ model }: { model: ReadModelV1 }) {
  const { source, network, vault, auction, reserve } = model;
  const fixture = source.kind === "fixture";
  const observedAt = formatTimestamp(source.observedAt);

  return (
    <section className={styles.root} aria-labelledby="portfolio-status-title">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Portfolio / public state</p>
          <h2 id="portfolio-status-title">Portfolio status</h2>
          <p className={styles.lede}>Configured targets and observed holdings are shown as separate facts from one read-model snapshot.</p>
        </div>
        <span className={`${styles.sourceBadge} ${fixture ? styles.fixtureBadge : styles.rpcBadge}`}>
          {fixture ? "Synthetic fixture · sample data" : "RPC observation"}
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
        <div><dt>Observed at</dt><dd>{observedAt}</dd></div>
        <div><dt>Slot</dt><dd>{source.slot ?? "Unknown"}</dd></div>
        <div className={styles.genesisFact}><dt>Genesis hash</dt><dd>{network.genesisHash ?? "Unknown"}</dd></div>
      </dl>

      <div className={styles.compositionGrid}>
        <section className={`${styles.composition} ${styles.targetPanel}`} aria-labelledby="target-composition-title">
          <div className={styles.panelHeading}>
            <div><p className={styles.index}>01 / Configuration</p><h3 id="target-composition-title">Target weights</h3></div>
            <span>Configured</span>
          </div>
          <p className={styles.panelCopy}>Desired allocation stored in the vault configuration.</p>
          <WeightList items={vault.target} kind="target" />
        </section>

        <section className={`${styles.composition} ${styles.actualPanel}`} aria-labelledby="actual-composition-title">
          <div className={styles.panelHeading}>
            <div><p className={styles.index}>02 / Observation</p><h3 id="actual-composition-title">Actual weights</h3></div>
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
        <section className={styles.factPanel} aria-labelledby="valuation-title">
          <p className={styles.index}>03 / Valuation</p>
          <h3 id="valuation-title">Estimate is not a quote</h3>
          <dl className={styles.keyFacts}>
            <div><dt>Estimated NAV</dt><dd>{formatUsd(vault.estimatedNavUsd)}</dd></div>
            <div><dt>Executable quote</dt><dd>Not provided</dd></div>
          </dl>
          <p className={styles.note}>NAV is an estimate tied to the observation above. An executable quote must be fetched separately for a specific amount and route; this read model does not establish liquidity or an executable price.</p>
        </section>

        <section className={styles.factPanel} aria-labelledby="vault-facts-title">
          <p className={styles.index}>04 / Vault</p>
          <h3 id="vault-facts-title">Vault facts</h3>
          <dl className={styles.keyFacts}>
            <div><dt>Phase</dt><dd>{vault.phase}</dd></div>
            <div><dt>Configuration revision</dt><dd>{vault.configRevision ?? "Unknown"}</dd></div>
            <div><dt>Total share supply</dt><dd>{vault.totalSupply === null ? "Unavailable" : formatBaseUnits(vault.totalSupply)} <small>raw base units</small></dd></div>
            <div><dt>Exit availability</dt><dd>{availability(vault.exit.available)}</dd></div>
            <div><dt>Exit mode</dt><dd>{vault.exit.mode === "in_kind" ? "In kind" : "Unknown"}</dd></div>
          </dl>
          <p className={styles.note}>Share decimals are not part of ReadModelV1, so supply is shown in raw base units.</p>
        </section>
      </div>

      <section className={styles.settlementPanel} aria-labelledby="fees-reserve-title">
        <div className={styles.panelHeading}>
          <div><p className={styles.index}>05 / Settlement</p><h3 id="fees-reserve-title">Fee, reserve &amp; exit</h3></div>
          <span>{auction === null ? "Auction state unavailable" : "Auction snapshot"}</span>
        </div>
        <dl className={styles.keyFacts}>
          <div><dt>Auction fee</dt><dd>{auction === null ? "Unknown" : formatBps(auction.feeBps)}</dd></div>
          <div><dt>In-kind exit</dt><dd>{vault.exit.mode === "in_kind" ? availability(vault.exit.available) : "Mode unknown"}</dd></div>
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
    </section>
  );
}
