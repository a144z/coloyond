import type { ReactNode } from 'react';

/**
 * Ledger panel: ledger-white body, 2px ink rule, hard offset shadow,
 * subtle top stripe with the panel's label. The workhorse container
 * from the flash-ui reference.
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
    <section className={`border-2 border-ink bg-ledger shadow-panel ${className}`}>
      {stripe !== undefined || meta !== undefined ? (
        <div className="flex items-center justify-between gap-3 border-b border-ink bg-ledger-subtle px-4 py-2.5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em]">{stripe}</span>
          {meta !== undefined ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-iron">{meta}</span>
          ) : null}
        </div>
      ) : null}
      <div className={`p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
