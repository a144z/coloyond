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
    'bg-ink text-ledger border-2 border-ink hover:shadow-btn active:shadow-none active:translate-x-[1px] active:translate-y-[1px]',
  secondary:
    'bg-transparent text-ink border-2 border-ink hover:bg-ink/5 active:translate-x-[1px] active:translate-y-[1px]',
  danger:
    'bg-transparent text-danger border-2 border-danger hover:bg-danger/5 active:translate-x-[1px] active:translate-y-[1px]',
  ghost:
    'bg-transparent text-petrol border-0 px-1 underline underline-offset-4 hover:text-ink active:translate-y-[1px]',
};

/**
 * Ledger button: sharp corners, ink rules, 48px hit target, uppercase mono.
 * The primary variant carries the attention spectrum as a 3px top edge,
 * exactly like the flash-ui reference's btn-attention.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', full = false, loading = false, leading, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`relative inline-flex min-h-12 select-none items-center justify-center gap-2 px-4 font-mono text-[12px] font-bold uppercase tracking-[0.06em] transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 ${
        variantClasses[variant]
      } ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {variant === 'primary' && (
        <span aria-hidden className="band-attention absolute inset-x-0 top-0 h-[3px]" />
      )}
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
