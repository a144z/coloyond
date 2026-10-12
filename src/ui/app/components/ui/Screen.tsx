import type { ReactNode } from 'react';
import { MicroLabel } from './primitives.js';

/** Screen shell: consistent horizontal padding and bottom breathing room. */
export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 pb-10 pt-4 ${className}`}>{children}</div>;
}

/** Micro label + display title + optional sub copy. */
export function ScreenHeading({
  micro,
  title,
  sub,
}: {
  micro?: string;
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {micro ? <MicroLabel>{micro}</MicroLabel> : null}
      <h1 className="mt-1.5 font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em]">{title}</h1>
      {sub ? <p className="mt-2.5 max-w-[46ch] text-[12.5px] leading-[1.6] text-iron">{sub}</p> : null}
    </header>
  );
}
