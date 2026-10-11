import { assetSpec, type AssetId } from '../../lib/solana/assets';

/** Allocation bar: one segment per asset in its registry color, ink target ticks. */
export interface MixSegment {
  key: string;
  pct: number;
  color: string;
}

export function MixBar({
  segments,
  ticks = [],
  height = 10,
  className = '',
  ariaLabel,
}: {
  segments: MixSegment[];
  ticks?: number[];
  height?: number;
  className?: string;
  ariaLabel?: string;
}) {
  let cursor = 0;
  return (
    <div
      role="img"
      aria-label={
        ariaLabel ??
        `Mix: ${segments
          .map((s) => `${assetSpec(s.key).symbol} ${Math.min(100, Math.max(0, s.pct)).toFixed(0)}%`)
          .join(', ')}`
      }
      className={`relative w-full overflow-visible border border-ink bg-pulp-shade ${className}`}
      style={{ height }}
    >
      {segments.map((s) => {
        const pct = Math.min(100, Math.max(0, s.pct));
        const left = cursor;
        cursor = Math.min(100, cursor + pct);
        return (
          <div
            key={s.key}
            aria-hidden
            className="absolute inset-y-0 transition-[left,width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ left: `${left}%`, width: `${cursor - left}%`, backgroundColor: s.color }}
          />
        );
      })}
      {ticks.map((t, i) => (
        <div
          key={i}
          aria-hidden
          className="absolute -inset-y-[2px] w-[2px] bg-ink"
          style={{ left: `calc(${Math.min(100, Math.max(0, t))}% - 1px)` }}
        />
      ))}
    </div>
  );
}

/** Build segments from weighted entries, filling any target-less remainder with nothing. */
export function segmentsOf(entries: { assetId: AssetId; pct: number }[]): MixSegment[] {
  return entries.map((e) => ({ key: e.assetId, pct: e.pct, color: assetSpec(e.assetId).color }));
}
