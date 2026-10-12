/** Brand lockup: the mix mark (petrol/brass split square) + "coloyond ✳︎". */

/** U+2733 with the text-presentation selector so iOS renders ink, not emoji. */
const ASTERISK = '\u2733\uFE0E';

export function MixMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 gap-[2px] rounded-[5px] bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-500 p-[6px] ${className}`}
      style={{ width: size, height: size }}
    >
      <span className="w-full rounded-[1px] bg-white/90" />
    </span>
  );
}

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
      <MixMark size={22} />
      <Wordmark className={wordmarkSize} />
    </span>
  );
}
