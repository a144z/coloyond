import type { ReactNode } from 'react';

/**
 * Desk panel: paper body, 1px panel edge, 18px corner and the desk's soft
 * shadow — same tiers as .cr-strategy-card / .cr-desk. The optional head
 * stripe is a hairline rule with the panel's label.
 */
export function LedgerPanel({
  stripe,
  meta,
  children,
  className = '',
  bodyClassName = '',
}: {
  stripe?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-[18px] border border-panel bg-ledger shadow-panel ${className}`}>
      {stripe !== undefined || meta !== undefined ? (
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em]">{stripe}</span>
          {meta !== undefined ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-iron">{meta}</span>
          ) : null}
        </div>
      ) : null}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
