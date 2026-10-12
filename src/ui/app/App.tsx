import { useEffect, useRef } from 'react';
import { useStore } from './lib/store.js';
import { ensureScheduler, stopScheduler } from './lib/automation.js';
import { wireAndroid } from './lib/android.js';
import { AppFrame, AppHeader, BottomNav, ExecutionOverlay, ToastLayer } from './components/layout/AppFrame.js';
import { Onboarding } from './screens/Onboarding.js';
import { PortfolioList } from './screens/PortfolioList.js';
import { CreateVault } from './screens/CreateVault.js';
import { VaultDetail } from './screens/VaultDetail.js';
import { WalletScreen } from './screens/WalletScreen.js';
import { SystemScreen } from './screens/SystemScreen.js';

/**
 * Root: the 430px lacquerboard column. Screens render inside the scroll
 * area keyed by route so each navigation enters with the appear motion;
 * ER execution-state sync starts when a wallet exists.
 */
export default function App() {
  const stack = useStore((s) => s.stack);
  const wallet = useStore((s) => s.wallet);
  const connectedWallet = useStore((s) => s.connectedWallet);
  const screen = stack[stack.length - 1];
  const scrollRef = useRef<HTMLDivElement>(null);

  // ER status, balances and live feeds sync while the app is open.
  useEffect(() => {
    ensureScheduler();
    return stopScheduler;
  }, [wallet, connectedWallet]);

  // Android shell: hardware back + pulp status bar (no-op on web)
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void wireAndroid().then((remove) => {
      if (disposed) remove(); else cleanup = remove;
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);

  // each navigation starts from the top of the ledger
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [screen.id, screen.vaultId]);

  const atTabLevel = stack.length === 1;

  return (
    <AppFrame>
      <AppHeader />
      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div key={`${screen.id}:${screen.vaultId ?? ''}`} className="animate-[coloyond-appear_220ms_ease-out]">
          {screen.id === 'onboarding' ? <Onboarding /> : null}
          {screen.id === 'portfolios' ? <PortfolioList /> : null}
          {screen.id === 'wallet' ? wallet || connectedWallet ? <WalletScreen /> : <Onboarding /> : null}
          {screen.id === 'system' ? <SystemScreen /> : null}
          {screen.id === 'create' ? <CreateVault /> : null}
          {screen.id === 'vault' ? <VaultDetail vaultId={screen.vaultId ?? ''} /> : null}
        </div>
      </main>
      {atTabLevel ? <BottomNav /> : null}
      <ToastLayer />
      <ExecutionOverlay />
    </AppFrame>
  );
}
