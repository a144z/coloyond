import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  loading?: boolean;
  leading?: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'border-0 bg-ink font-display text-[14px] font-semibold text-pulp hover:bg-ink/90 active:bg-ink/90',
  secondary:
    'border border-panel bg-ledger font-mono text-[11px] font-bold uppercase tracking-[0.04em] text-ink hover:bg-ink/5',
  danger:
    'border border-danger bg-transparent font-mono text-[11px] font-bold uppercase tracking-[0.04em] text-danger hover:bg-danger/5',
  ghost:
    'border-0 px-1 font-mono text-[11px] font-bold uppercase tracking-[0.04em] text-petrol underline underline-offset-4 hover:text-ink',
};

/**
 * Desk button: 47px hit target like .cr-primary. The primary variant is the
 * ink block that turns blue on hover; secondary and danger are 1px-rule
 * outline buttons in the desk's small mono caps.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', full = false, loading = false, leading, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`relative inline-flex min-h-[47px] select-none items-center justify-center gap-2 px-4 transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ${
        variantClasses[variant]
      } ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="h-2.5 w-2.5 animate-[coloyond-pulse_0.9s_ease-in-out_infinite] bg-current"
        />
      ) : (
        leading
      )}
      {children}
    </button>
  );
});
