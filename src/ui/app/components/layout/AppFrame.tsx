import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FadersHorizontal, GearSix, Wallet as WalletIcon, X } from '@phosphor-icons/react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useStore, type TabId } from '../../lib/store.js';
import { shortKey } from '../../lib/format.js';
import { RPC_POLL_MS } from '../../lib/solana/config.js';
import { useNow } from '../../hooks/useNow.js';
import { BrandLockup } from '../brand/BrandMark.js';
import { Button } from '../ui/Button.js';
import { MicroLabel, Notice, SignatureLink, StatusSwatch } from '../ui/primitives.js';

/**
 * The app column: a 430px paper sheet. On desktop it floats as a framed
 * device on the desk's soft shadow; on a phone it fills the viewport.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="cw-app relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-pulp md:my-8 md:h-[min(880px,calc(100dvh-4rem))] md:rounded-[36px] md:border-[8px] md:border-neutral-800 md:shadow-frame">
      {children}
      <div aria-hidden className="pulp-grain pointer-events-none absolute inset-0 z-[80] opacity-[0.05] mix-blend-multiply" />
    </div>
  );
}

/** Header: back control when drilled in, brand lockup at tab level, live badge always. */
export function AppHeader() {
  const deviceWallet = useStore((s) => s.wallet);
  const setTab = useStore((s) => s.setTab);
  const depth = useStore((s) => s.stack.length);
  const popScreen = useStore((s) => s.popScreen);
  const rpc = useStore((s) => s.rpc);
  const { connected, connecting, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  useNow(1000);

  const live = !!rpc && Date.now() - rpc.at < RPC_POLL_MS * 2;

  return (
    <header className="cw-app-header flex shrink-0 items-center justify-between gap-2 border-b border-hairline bg-pulp px-5">
      {depth > 1 ? (
        <button
          type="button"
          onClick={popScreen}
          className="flex h-11 items-center gap-1.5 pl-2 pr-3 font-mono text-[12px] font-bold uppercase tracking-[0.06em] hover:bg-ink/5"
        >
          <ArrowLeft size={16} weight="bold" aria-hidden />
          Back
        </button>
      ) : (
        <BrandLockup />
      )}
      <button
        type="button"
        aria-label={connected && publicKey ? `Open wallet ${publicKey.toBase58()}` : deviceWallet ? 'Open device wallet' : 'Connect wallet'}
        title={connected || deviceWallet ? 'Open wallet controls' : 'Connect a Solana wallet on devnet'}
        onClick={() => {
          if (connected || deviceWallet) {
            setTab('wallet');
          } else {
            setVisible(true);
          }
        }}
        className={`flex h-[38px] shrink-0 items-center gap-1.5 rounded-full border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.04em] transition-opacity hover:opacity-90 ${
          connected || deviceWallet ? 'bg-pulp-shade text-ink' : 'bg-ink text-pulp'
        }`}
      >
        <StatusSwatch tone={live ? 'petrol' : 'iron'} pulse={live} />
        <WalletIcon size={14} weight="bold" aria-hidden />
        {connecting ? 'Connecting…' : connected && publicKey ? shortKey(publicKey.toBase58()) : deviceWallet ? shortKey(deviceWallet.publicKey) : 'Connect wallet'}
      </button>
    </header>
  );
}

const tabs: { id: TabId; label: string; icon: typeof FadersHorizontal }[] = [
  { id: 'portfolios', label: 'Portfolios', icon: FadersHorizontal },
  { id: 'wallet', label: 'Wallet', icon: WalletIcon },
  { id: 'system', label: 'System', icon: GearSix },
];

export function BottomNav() {
  const activeTab = useStore((s) => s.activeTab);
  const setTab = useStore((s) => s.setTab);
  return (
    <nav
      aria-label="Primary"
      className="grid shrink-0 grid-cols-3 gap-2 border-t border-hairline bg-pulp px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={active ? 'page' : undefined}
            className={`cw-nav-item flex h-[58px] flex-col items-center justify-center gap-[3px] border-t-[3px] px-2 font-display text-[12px] tracking-[-0.4px] transition-colors ${
              active
                ? 'border-ink text-ink'
                : 'border-t-transparent text-iron hover:bg-pulp-shade/60 hover:text-ink'
            }`}
          >
            <Icon size={18} weight={active ? 'fill' : 'regular'} aria-hidden />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

/** Transient toasts, stacked above the bottom nav inside the app column. */
export function ToastLayer() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const tones = { ok: 'petrol', error: 'danger', info: 'iron' } as const;

  if (toasts.length === 0) return null;
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-[calc(92px+env(safe-area-inset-bottom))] left-1/2 z-[70] flex w-[min(398px,calc(100vw-1.5rem))] -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="cw-rounded pointer-events-auto flex animate-[coloyond-appear_200ms_ease-out] items-start gap-2.5 border border-panel bg-pulp px-5.5 py-3 shadow-panel"
        >
          <span className="mt-1.5">
            <StatusSwatch tone={tones[t.kind]} pulse={t.kind === 'error'} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold leading-snug">{t.title}</p>
            {t.body ? <p className="mt-0.5 text-[11px] leading-relaxed text-iron">{t.body}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            className="flex h-8 w-8 shrink-0 items-center justify-center text-iron hover:bg-ink/5"
          >
            <X size={14} weight="bold" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Execution overlay: blocking modal for owner-signed devnet flows.
 * Square markers walk pending -> running -> done/failed, with explorer
 * links for confirmed transactions.
 */
export function ExecutionOverlay() {
  const flow = useStore((s) => s.flow);
  const dismissFlow = useStore((s) => s.dismissFlow);

  useEffect(() => {
    if (!flow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (flow.finishedAt || flow.error)) dismissFlow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, dismissFlow]);

  if (!flow) return null;
  const finished = flow.finishedAt !== null;
  const failed = flow.error !== null;
  const dismissible = finished || failed;

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={flow.title}>
      <div className="absolute inset-0 bg-ink/45" aria-hidden />
      <div className="cw-rounded absolute left-1/2 top-1/2 w-[min(400px,calc(100vw-2rem))] max-h-[min(560px,calc(100dvh-5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-panel bg-pulp shadow-frame animate-[coloyond-appear_220ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="flex items-center justify-between gap-3 border-b border-hairline bg-pulp px-5 py-3">
          <MicroLabel>{flow.micro}</MicroLabel>
          {dismissible ? (
            <button
              type="button"
              onClick={dismissFlow}
              aria-label="Close execution report"
              className="flex h-9 w-9 items-center justify-center hover:bg-ink/5"
            >
              <X size={18} weight="bold" />
            </button>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-iron">
              <StatusSwatch tone="petrol" pulse />
              executing
            </span>
          )}
        </div>

        <div className="px-4 py-4">
          <h2 className="font-display text-[22px] font-bold leading-[1.1] tracking-[-0.02em]">{flow.title}</h2>

          <ol className="mt-4">
            {flow.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 border-b border-hairline py-3 last:border-b-0">
                <span
                  aria-hidden
                  className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 border-2 border-ink ${
                    step.status === 'pending'
                      ? 'bg-ledger-subtle opacity-50'
                      : step.status === 'running'
                        ? 'animate-[coloyond-pulse_0.9s_ease-in-out_infinite] bg-ink'
                        : step.status === 'done'
                          ? 'bg-petrol'
                          : 'bg-danger'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[12.5px] font-bold leading-snug ${step.status === 'pending' ? 'text-iron' : ''}`}>
                    {step.label}
                  </p>
                  {step.note ? <p className="mt-0.5 text-[11px] leading-relaxed text-iron">{step.note}</p> : null}
                  {step.sig ? (
                    <p className="mt-1">
                      <SignatureLink sig={step.sig} />
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          {failed && flow.error ? (
            <div className="mt-4">
              <Notice tone="danger" title="Execution stopped">
                {flow.error}
              </Notice>
            </div>
          ) : null}
        </div>

        {dismissible ? (
          <div className="border-t border-hairline px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <Button variant="primary" full onClick={dismissFlow}>
              {failed ? 'Close' : 'Done'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
