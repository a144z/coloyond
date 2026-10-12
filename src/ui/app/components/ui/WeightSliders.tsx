import { useId, useState } from 'react';
import { assetList, type AssetId, type AssetSpec } from '../../lib/solana/assets.js';

/** Pinned target percentage per asset id. A locked weight holds its value while other weights move. */
export type WeightLocks = Partial<Record<AssetId, number>>;

/** Rounding slack that still counts as an exact 100% mix. */
const EPSILON = 0.05;

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Exact-entry percentage box, the desk's `TargetField` pattern: keeps a local
 * draft while typing, commits each parseable value so the other weights
 * re-normalize under it.
 */
function PercentField({
  value,
  disabled,
  label,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  label: string;
  onCommit: (pct: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? clampPct(value).toFixed(0);
  return (
    <span className="cr-input-suffix">
      <input
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() !== '' && Number.isFinite(parsed)) onCommit(clampPct(parsed));
        }}
        onBlur={() => setDraft(null)}
      />
      <span>%</span>
    </span>
  );
}

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
    onChange(sharesForDesiredPct(shares,id,desiredPct,assetIds,locked));
  }

  return (
    // Desk pattern (the /prototype allocation editor): colour dot · name ·
    // split-track slider · state · exact % · lock, ruled rows on the ledger.
    <div className="cr-desk-allocation" role="group" aria-label={ariaLabel}>
      <div className="cr-desk-targets">
        {specs.map((spec) => {
          const isLocked = locked[spec.id] !== undefined;
          const pct = pcts[spec.id];
          const inputId = `${idBase}-${spec.id}`;
          const shareTrack = `linear-gradient(to right, ${spec.color} 0%, ${spec.color} ${clampPct(pct)}%, var(--field) ${clampPct(pct)}%, var(--field) 100%)`;
          return (
            <div className="cr-desk-target" key={spec.id}>
              <span className="cr-pt-dot" style={{ background: spec.color }} />
              <span className="cr-desk-target-name">
                <strong>{spec.symbol}</strong>
                <small>{spec.name}</small>
              </span>
              <input
                id={inputId}
                className="cr-desk-slider-input"
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={clampPct(pct)}
                style={{ '--cr-split-track': shareTrack } as React.CSSProperties}
                onChange={(event) => handleSliderChange(spec.id, Number(event.target.value))}
                disabled={isLocked}
                aria-label={`Target slider for ${spec.symbol}`}
                aria-valuetext={`${pct.toFixed(1)} percent of the mix${isLocked ? ' · locked' : ''}`}
              />
              <PercentField
                value={pct}
                disabled={isLocked}
                label={`Exact target percentage for ${spec.symbol}`}
                onCommit={(next) => handleSliderChange(spec.id, next)}
              />
              {onLockedChange ? (
                <button
                  type="button"
                  className="cr-desk-lock"
                  aria-pressed={isLocked}
                  aria-label={
                    isLocked ? `Unlock ${spec.symbol} weight` : `Lock ${spec.symbol} weight at ${pct.toFixed(1)}%`
                  }
                  title={
                    isLocked
                      ? `Unlock ${spec.symbol} weight`
                      : `Pin ${spec.symbol} at ${pct.toFixed(1)}% while other weights move`
                  }
                  onClick={() => toggleLock(spec.id)}
                >
                  {isLocked ? 'locked' : 'lock'}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="cr-pt-total">
        <span>
          {total > 0
            ? lockedSum > 0
              ? `Targets total · ${lockedSum.toFixed(1)}% locked`
              : 'Targets total'
            : 'No assets selected'}
        </span>
        <strong>{total > 0 ? `${total.toFixed(1)}%` : '—'}</strong>
      </div>
      {shortOfTotal ? (
        <p className="cr-error">
          Unlocked assets must cover the remaining {(100 - lockedSum).toFixed(1)}% of the mix.
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
  if (remaining <= 0 || unlockedTotal <= 0) return pin;
  return Math.max(0, (unlockedTotal * pin) / remaining);
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
    out[spec.id] = targets[spec.id] ?? 0;
  }
  return out;
}

/** Desired percentages retain fractional raw shares; early rounding would turn 40% into 40.3%. */
export function sharesForDesiredPct(shares:Record<AssetId,number>,id:AssetId,desiredPct:number,assetIds?:readonly AssetId[],locked:WeightLocks={}):Record<AssetId,number>{
    // Reverse-engineer the raw share from the desired normalized percentage.
    // The normalization formula: pct_i = remaining * share_i / unlockedTotal
    // Solving for share_i: share_i = pct_i * total_other_unlocked / (remaining - pct_i)
    const specs=assetList().filter(asset=>!assetIds||assetIds.includes(asset.id));
    if(locked[id]!==undefined)return {...shares};
    desiredPct=Math.max(0,Math.min(100,desiredPct));
    const unlockedSpecs = specs.filter((s) => locked[s.id] === undefined);
    const lockedSum = specs.reduce((sum, spec) => {
      const pin = locked[spec.id];
      if (pin === undefined) return sum;
      return sum + Math.max(0, Math.min(100, pin));
    }, 0);
    const remaining = Math.max(0, 100 - lockedSum);
    // Edge case: desired percentage >= remaining, or no remaining budget
    if (remaining <= 0 || desiredPct >= remaining - 0.05) {
      const next={...shares};
      if(desiredPct>=remaining&&remaining>0){for(const spec of unlockedSpecs)next[spec.id]=spec.id===id?remaining:0;}else next[id]=0;
      return next;
    }
    // Sum of all other unlocked assets' shares (excluding this one)
    const totalOther = unlockedSpecs.reduce((sum, spec) => {
      if (spec.id === id) return sum;
      return sum + Math.max(0, shares[spec.id] ?? 0);
    }, 0);
    // Reverse-engineer the raw share
    const newShare = totalOther > 0 ? (desiredPct * totalOther) / (remaining - desiredPct) : desiredPct;
    return { ...shares, [id]: Math.max(0, newShare) };
}
