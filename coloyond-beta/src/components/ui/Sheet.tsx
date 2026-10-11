import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import { MicroLabel } from './primitives';

/**
 * Review sheet: a bottom sheet constrained to the app column.
 * Portals out of the scroll container; slides up over 260ms.
 */
export function Sheet({
  open,
  onClose,
  micro,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  micro: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close review"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/45"
      />
      <div className="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[430px] flex-col">
        <div className="max-h-[82dvh] overflow-y-auto border-t-2 border-ink bg-pulp shadow-frame animate-[coloyond-sheet-up_260ms_cubic-bezier(0.16,1,0.3,1)]">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
            <MicroLabel>{micro}</MicroLabel>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center text-ink hover:bg-ink/5"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
          <div className="px-5 py-4">
            <h2 className="mb-3 font-display text-[22px] font-bold leading-[1.1] tracking-[-0.02em]">{title}</h2>
            {children}
          </div>
          {footer ? (
            <div className="border-t border-hairline px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
