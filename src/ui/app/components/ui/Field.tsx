import { useId, type ReactNode } from 'react';

/** Input styling: 47px tall, 1px soft rule, 6px corner — .cr-field. */
export const inputClass =
  'block w-full min-h-[47px] rounded-[6px] border border-[#bbb5a5] bg-ledger px-3 text-[14px] text-ink placeholder:text-iron/60 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px]';

export const selectClass = `${inputClass} appearance-none pr-8 bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2314171A'/%3E%3C/svg%3E")] bg-[right_0.9rem_center] bg-no-repeat`;

/** Label above input, helper below, error last. Never placeholder-as-label. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="my-4 first:mt-0">
      <label htmlFor={id} className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-iron">
        {label}
      </label>
      <div>{children}</div>
      {hint !== undefined && error === undefined ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-iron">{hint}</p>
      ) : null}
      {error !== undefined ? <p className="mt-1.5 text-[11px] font-bold leading-relaxed text-danger">{error}</p> : null}
    </div>
  );
}
