import { useId } from 'react';
import { assetList, type AssetId, type AssetSpec } from '../../lib/solana/assets.js';
import { AssetSwatch } from './primitives.js';

/** Pinned target percentage per asset id. A locked weight holds its value while other weights move. */
export type WeightLocks = Partial<Record<AssetId, number>>;

/** Rounding slack that still counts as an exact 100% mix. */
const EPSILON = 0.05;

/**
 * Proportional weight editor. Each asset gets an independent share slider
 * (0-100); the displayed weights are the shares normalized to 100, so the
 * target mix is always valid while editing. A share of zero removes the
 * asset from the portfolio. A locked asset's percentage is pinned: other
 * weights re-normalize within the remainder, and locking or unlocking never
 * changes any displayed weight — the lock only freezes it.
 */
export function WeightSliders({
  shares,
  onChange,
  ariaLabel = 'Target mix weights',
  assetIds,
  locked = {},
  onLockedChange,
}: {
  shares: Record<AssetId, number>;
  onChange: (next: Record<AssetId, number>) => void;
  ariaLabel?: string;
  assetIds?: readonly AssetId[];
  /** Pinned percentages by asset id. */
  locked?: WeightLocks;
  /** Provide to render the per-asset lock controls. */
  onLockedChange?: (next: WeightLocks) => void;
}) {
  const idBase = useId();
  const specs = assetList().filter((asset) => !assetIds || assetIds.includes(asset.id));
  const pcts = targetPcts(shares, specs, locked);
  const total = specs.reduce((sum, spec) => sum + pcts[spec.id], 0);
  const lockedSum = specs.reduce((sum, spec) => sum + (locked[spec.id] !== undefined ? pcts[spec.id] : 0), 0);
  const shortOfTotal = total > 0 && Math.abs(total - 100) > EPSILON;

  function toggleLock(id: AssetId) {
    if (!onLockedChange) return;
    if (locked[id] === undefined) {
      onLockedChange({ ...locked, [id]: pcts[id] });
      return;
    }
    // Unlock: rebuild the raw share so every displayed weight stays exactly where it was.
    onChange({ ...shares, [id]: shareAfterUnlock(shares, specs, locked, id) });
    const next: WeightLocks = { ...locked };
    delete next[id];
    onLockedChange(next);
  }

  function handleSliderChange(id: AssetId, desiredPct: number) {
    // Reverse-engineer the raw share from the desired normalized percentage.
    // The normalization formula: pct_i = remaining * share_i / unlockedTotal
    // Solving for share_i: share_i = pct_i * total_other_unlocked / (remaining - pct_i)
    const unlockedSpecs = specs.filter((s) => locked[s.id] === undefined);
    const lockedSum = specs.reduce((sum, spec) => {
      const pin = locked[spec.id];
      if (pin === undefined) return sum;
      return sum + Math.max(0, Math.min(100, pin));
    }, 0);
    const remaining = Math.max(0, 100 - lockedSum);
    // Edge case: desired percentage >= remaining, or no remaining budget
    if (remaining <= 0 || desiredPct >= remaining - 0.05) {
      onChange({ ...shares, [id]: desiredPct >= remaining ? 10000 : 0 });
      return;
    }
    // Sum of all other unlocked assets' shares (excluding this one)
    const totalOther = unlockedSpecs.reduce((sum, spec) => {
      if (spec.id === id) return sum;
      return sum + Math.max(0, shares[spec.id] ?? 0);
    }, 0);
    // Reverse-engineer the raw share
    const newShare = totalOther > 0 ? (desiredPct * totalOther) / (remaining - desiredPct) : desiredPct;
    onChange({ ...shares, [id]: Math.max(0, Math.round(newShare)) });
  }

  return (
    <div role="group" aria-label={ariaLabel}>
      {specs.map((spec) => {
        const isLocked = locked[spec.id] !== undefined;
        const pct = pcts[spec.id];
        const inputId = `${idBase}-${spec.id}`;
        return (
          <div key={spec.id} className="border-b border-hairline py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={inputId} className="flex min-w-0 items-center gap-2 text-[12px] font-bold">
                <AssetSwatch color={spec.color} />
                {spec.symbol}
                <span className="min-w-0 truncate font-normal text-iron">· {spec.name}</span>
              </label>
              <span className="flex shrink-0 items-center gap-2">
                <strong className="font-mono text-[14px]">{pct.toFixed(1)}%</strong>
                {onLockedChange ? (
                  <button
                    type="button"
                    aria-pressed={isLocked}
                    aria-label={
                      isLocked ? `Unlock ${spec.symbol} weight` : `Lock ${spec.symbol} weight at ${pct.toFixed(1)}%`
                    }
                    title={
                      isLocked ? `Unlock ${spec.symbol} weight` : `Pin ${spec.symbol} at ${pct.toFixed(1)}% while other weights move`
                    }
                    onClick={() => toggleLock(spec.id)}
                    className="cw-weight-lock"
                  >
                    {isLocked ? 'locked' : 'lock'}
                  </button>
                ) : null}
              </span>
            </div>
            <input
              id={inputId}
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={pct}
              onChange={(e) => handleSliderChange(spec.id, Number(e.target.value))}
              disabled={isLocked}
              className="ledger-range mt-1.5"
              aria-label={`${spec.symbol} share`}
              aria-valuetext={`${pct.toFixed(1)} percent of the mix${isLocked ? ' · locked' : ''}`}
            />
          </div>
        );
      })}
      <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3 text-[11px] text-iron">
        <span>
          {total > 0
            ? lockedSum > 0
              ? `Total target · ${lockedSum.toFixed(1)}% locked`
              : 'Total target'
            : 'No assets selected'}
        </span>
        <strong className={`font-mono ${shortOfTotal ? 'text-danger' : ''}`}>
          {total > 0 ? `${total.toFixed(1)}%` : '—'}
        </strong>
      </div>
      {shortOfTotal ? (
        <p className="mt-1.5 text-[11px] font-bold leading-relaxed text-danger">
          · Unlocked assets must cover the remaining {(100 - lockedSum).toFixed(1)}% of the mix.
        </p>
      ) : null}
    </div>
  );
}

/** Displayed target percentages: locked ids keep their pinned value; unlocked shares normalize within the remainder. */
function targetPcts(
  shares: Record<AssetId, number>,
  specs: readonly AssetSpec[],
  locked: WeightLocks = {},
): Record<AssetId, number> {
  const out = {} as Record<AssetId, number>;
  let lockedSum = 0;
  for (const spec of specs) {
    const pin = locked[spec.id];
    if (pin === undefined) continue;
    const pct = Math.max(0, Math.min(100, pin));
    out[spec.id] = pct;
    lockedSum += pct;
  }
  const remaining = Math.max(0, 100 - lockedSum);
  let unlockedTotal = 0;
  for (const spec of specs) {
    if (locked[spec.id] !== undefined) continue;
    unlockedTotal += Math.max(0, shares[spec.id] ?? 0);
  }
  for (const spec of specs) {
    if (locked[spec.id] !== undefined) continue;
    out[spec.id] = unlockedTotal > 0 ? (remaining * Math.max(0, shares[spec.id] ?? 0)) / unlockedTotal : 0;
  }
  return out;
}

/** Raw share for a freshly unlocked asset (must currently be pinned) that preserves its percentage exactly. */
function shareAfterUnlock(
  shares: Record<AssetId, number>,
  specs: readonly AssetSpec[],
  locked: WeightLocks,
  id: AssetId,
): number {
  const pin = Math.max(0, Math.min(100, locked[id] ?? 0));
  let lockedSum = 0;
  let unlockedTotal = 0;
  for (const spec of specs) {
    const pinValue = locked[spec.id];
    if (pinValue !== undefined) {
      lockedSum += Math.max(0, Math.min(100, pinValue));
    } else {
      unlockedTotal += Math.max(0, shares[spec.id] ?? 0);
    }
  }
  const remaining = Math.max(0, 100 - lockedSum);
  if (remaining <= 0 || unlockedTotal <= 0) return Math.round(pin);
  return Math.max(0, Math.round((unlockedTotal * pin) / remaining));
}

/** Normalize raw shares into target percentages that sum to 100 (empty input → empty record). Locked assets keep their pinned percentage. */
export function normalizeShares(
  shares: Record<AssetId, number>,
  assetIds?: readonly AssetId[],
  locked: WeightLocks = {},
): Partial<Record<AssetId, number>> {
  const specs = assetList().filter((asset) => !assetIds || assetIds.includes(asset.id));
  const pcts = targetPcts(shares, specs, locked);
  const out: Partial<Record<AssetId, number>> = {};
  for (const spec of specs) {
    if (pcts[spec.id] > 0) out[spec.id] = pcts[spec.id];
  }
  return out;
}

/** Read normalized shares back from target percentages (for editing existing targets). */
export function sharesFromTargets(targets: Record<string, number>, assetIds?: readonly AssetId[]): Record<AssetId, number> {
  const out = Object.fromEntries(assetList().map((s) => [s.id, 0])) as Record<AssetId, number>;
  for (const spec of assetList().filter((asset) => !assetIds || assetIds.includes(asset.id))) {
    out[spec.id] = Math.round(targets[spec.id] ?? 0);
  }
  return out;
}
