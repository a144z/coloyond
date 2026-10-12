import { useCallback, useRef, useState } from 'react';
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
  interactive = false,
  onChange,
  lockedKeys = [],
}: {
  segments: MixSegment[];
  ticks?: number[];
  height?: number;
  className?: string;
  ariaLabel?: string;
  /** When true, renders draggable handles between segments. */
  interactive?: boolean;
  /** Called with updated segments when a handle is dragged. */
  onChange?: (segments: MixSegment[]) => void;
  /** Asset keys with pinned weights; handles touching them are omitted. */
  lockedKeys?: readonly string[];
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Compute cumulative left positions
  const positions: number[] = [];
  let cursor = 0;
  for (const s of segments) {
    positions.push(cursor);
    cursor = Math.min(100, cursor + Math.min(100, Math.max(0, s.pct)));
  }

  const handlePointerDown = useCallback(
    (handleIdx: number) => (e: React.PointerEvent) => {
      if (!interactive || !onChange) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(handleIdx);
    },
    [interactive, onChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging === null || !barRef.current || !onChange) return;
      const rect = barRef.current.getBoundingClientRect();
      const pctRaw = ((e.clientX - rect.left) / rect.width) * 100;
      const pct = Math.max(0, Math.min(100, pctRaw));

      const segs = segmentsRef.current;
      // Handle index `dragging` sits between segment[dragging] and segment[dragging+1]
      const leftIdx = dragging;
      const rightIdx = dragging + 1;
      if (leftIdx < 0 || rightIdx >= segs.length) return;

      // Compute the allowed range: sum of the two segments' current pcts
      const total = segs[leftIdx].pct + segs[rightIdx].pct;
      // The new left pct = position of handle - left edge of left segment
      const leftEdge = positions[leftIdx];
      let newLeftPct = pct - leftEdge;
      newLeftPct = Math.max(0, Math.min(total, newLeftPct));
      const newRightPct = total - newLeftPct;

      const next = segs.map((s, i) => {
        if (i === leftIdx) return { ...s, pct: newLeftPct };
        if (i === rightIdx) return { ...s, pct: newRightPct };
        return s;
      });
      onChange(next);
    },
    [dragging, onChange, positions],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Keyboard support for handles
  const handleKeyDown = useCallback(
    (handleIdx: number) => (e: React.KeyboardEvent) => {
      if (!interactive || !onChange) return;
      const step = e.shiftKey ? 5 : 1;
      let delta = 0;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
      else return;
      e.preventDefault();

      const segs = segmentsRef.current;
      const leftIdx = handleIdx;
      const rightIdx = handleIdx + 1;
      if (leftIdx < 0 || rightIdx >= segs.length) return;

      const total = segs[leftIdx].pct + segs[rightIdx].pct;
      let newLeftPct = segs[leftIdx].pct + delta;
      newLeftPct = Math.max(0, Math.min(total, newLeftPct));
      const newRightPct = total - newLeftPct;

      const next = segs.map((s, i) => {
        if (i === leftIdx) return { ...s, pct: newLeftPct };
        if (i === rightIdx) return { ...s, pct: newRightPct };
        return s;
      });
      onChange(next);
    },
    [interactive, onChange],
  );

  let cursorBuild = 0;
  return (
    <div
      ref={barRef}
      role={interactive ? 'group' : 'img'}
      aria-label={
        ariaLabel ??
        `Mix: ${segments
          .map((s) => `${assetSpec(s.key).symbol} ${Math.min(100, Math.max(0, s.pct)).toFixed(0)}%`)
          .join(', ')}`
      }
      className={`relative w-full overflow-visible border border-ink bg-pulp-shade ${className}`}
      style={{ height, touchAction: 'none' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Ghost tickers for asset labels */}
      {interactive && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {segments.map((s) => {
            const left = cursorBuild;
            cursorBuild = Math.min(100, cursorBuild + Math.min(100, Math.max(0, s.pct)));
            const mid = left + (cursorBuild - left) / 2;
            if (cursorBuild - left < 8) return null;
            return (
              <span
                key={`ghost-${s.key}`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] font-bold text-ink/40 select-none"
                style={{ left: `${mid}%` }}
              >
                {assetSpec(s.key).symbol}
              </span>
            );
          })}
        </div>
      )}

      {/* Colored segments */}
      {(() => {
        let c = 0;
        return segments.map((s) => {
          const pct = Math.min(100, Math.max(0, s.pct));
          const left = c;
          c = Math.min(100, c + pct);
          return (
            <span
              key={s.key}
              data-allocation-segment={assetSpec(s.key).symbol}
              title={`${assetSpec(s.key).symbol} target ${pct.toFixed(0)}%`}
              className="absolute inset-y-0 transition-[left,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ left: `${left}%`, width: `${c - left}%`, backgroundColor: s.color }}
            />
          );
        });
      })()}

      {/* Target tick marks */}
      {ticks.map((t, i) => (
        <div
          key={i}
          aria-hidden
          className="absolute -inset-y-[2px] w-[2px] bg-ink"
          style={{ left: `calc(${Math.min(100, Math.max(0, t))}% - 1px)` }}
        />
      ))}

      {/* Draggable handles between segments; a pinned segment has no movable boundary */}
      {interactive &&
        (() => {
          const lockedSet = new Set(lockedKeys);
          return segments.slice(0, -1).map((s, i) => {
            if (lockedSet.has(segments[i].key) || lockedSet.has(segments[i + 1].key)) return null;
            const leftPct = positions[i] + Math.min(100, Math.max(0, s.pct));
            const leftSpec = assetSpec(segments[i].key);
            const rightSpec = assetSpec(segments[i + 1].key);
            const leftPctVal = segments[i].pct;
            const rightPctVal = segments[i + 1].pct;
            const minVal = 0;
            const maxVal = Math.round(leftPctVal + rightPctVal);
            return (
              <button
                key={`handle-${i}`}
                className="absolute top-1/2 z-10 flex h-[20px] w-[10px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center border border-ink bg-ink transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-petrol active:bg-petrol"
                style={{ left: `${leftPct}%` }}
                role="slider"
                aria-label={`Drag to move share between ${leftSpec.symbol} and ${rightSpec.symbol}`}
                aria-valuemin={minVal}
                aria-valuemax={maxVal}
                aria-valuenow={Math.round(leftPctVal)}
                aria-valuetext={`${leftSpec.symbol} ${leftPctVal.toFixed(0)}%, ${rightSpec.symbol} ${rightPctVal.toFixed(0)}%`}
                onPointerDown={handlePointerDown(i)}
                onKeyDown={handleKeyDown(i)}
                tabIndex={0}
              >
                <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink px-1 py-0.5 text-[8px] font-bold text-pulp opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ opacity: dragging === i ? 1 : undefined }}
                >
                  {leftSpec.symbol} {leftPctVal.toFixed(0)} / {rightSpec.symbol} {rightPctVal.toFixed(0)}
                </span>
              </button>
            );
          });
        })()}
    </div>
  );
}

/** Build segments from weighted entries, filling any target-less remainder with nothing. */
export function segmentsOf(entries: { assetId: AssetId; pct: number }[]): MixSegment[] {
  return entries.map((e) => ({ key: e.assetId, pct: e.pct, color: assetSpec(e.assetId).color }));
}
