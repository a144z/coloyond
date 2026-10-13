/** Brand lockup: the portfolio artwork + "coloyond ✳︎". */

import { ReferenceArt } from '../../../ReferenceArt.js';

/** U+2733 with the text-presentation selector so iOS renders ink, not emoji. */
const ASTERISK = '\u2733\uFE0E';

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`select-none font-display font-bold leading-none tracking-[-0.04em] text-ink ${className}`}
    >
      coloyond{' '}
      <span aria-label="asterisk" className="text-[0.82em] align-baseline">
        {ASTERISK}
      </span>
    </span>
  );
}

export function BrandLockup({ wordmarkSize = 'text-[19px]' }: { wordmarkSize?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-[5px]">
        <ReferenceArt variant="planes" className="h-full w-full" title="Coloyond portfolio artwork" />
      </span>
      <Wordmark className={wordmarkSize} />
    </span>
  );
}
