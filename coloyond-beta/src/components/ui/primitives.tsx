import type { ReactNode } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { explorerTx } from '../../lib/solana/connection';
import { shortSig } from '../../lib/format';

/** Small uppercase mono label, the ledger's marginalia. */
export function MicroLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-iron ${className}`}>
      {children}
    </span>
  );
}

export type SwatchTone = 'petrol' | 'brass' | 'iron' | 'danger' | 'ink';

const swatchTones: Record<SwatchTone, string> = {
  petrol: 'bg-petrol',
  brass: 'bg-brass',
  iron: 'bg-iron',
  danger: 'bg-danger',
  ink: 'bg-ink',
};

/** Square status swatch. Pulses only for real live state (automation, RPC). */
export function StatusSwatch({ tone, pulse = false }: { tone: SwatchTone; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 ${swatchTones[tone]} ${pulse ? 'animate-[coloyond-pulse_1.8s_ease-in-out_infinite]' : ''}`}
    />
  );
}

/** Square asset swatch filled with the asset's registry (mix-bar) color. */
export function AssetSwatch({ color, className = '' }: { color: string; className?: string }) {
  return (
    <i
      aria-hidden
      className={`inline-block h-2.5 w-2.5 shrink-0 ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}

export interface KeyValueRow {
  k: ReactNode;
  v: ReactNode;
}

/** dl-style ledger rows: muted term left, bold value right. */
export function KeyValue({ rows }: { rows: KeyValueRow[] }) {
  return (
    <dl className="mt-1">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex items-baseline justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0"
        >
          <dt className="text-[12px] text-iron">{row.k}</dt>
          <dd className="min-w-0 break-words text-right text-[12px] font-bold">{row.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Left-ruled notice, from the mobile reference's .notice pattern. */
export function Notice({
  tone = 'brass',
  title,
  children,
}: {
  tone?: 'brass' | 'danger' | 'petrol';
  title?: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    brass: 'border-brass bg-brass/5',
    danger: 'border-danger bg-danger/5',
    petrol: 'border-petrol bg-petrol/5',
  } as const;
  return (
    <div className={`border-l-[3px] px-3.5 py-3 text-[12px] leading-relaxed ${tones[tone]}`}>
      {title ? <strong className="mb-0.5 block">{title}</strong> : null}
      {children}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-[coloyond-pulse_1.6s_ease-in-out_infinite] bg-ledger-subtle ${className}`} />;
}

/** Truncated signature linking to the devnet explorer. */
export function SignatureLink({ sig, slot }: { sig: string; slot?: number }) {
  return (
    <a
      href={explorerTx(sig)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-petrol underline underline-offset-2"
    >
      {slot ? `slot ${slot}` : shortSig(sig)}
      <ArrowSquareOut size={10} weight="bold" aria-hidden />
    </a>
  );
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`border-t border-hairline ${className}`} aria-hidden />;
}
