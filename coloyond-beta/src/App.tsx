import { useEffect, useRef } from 'react';
import { useStore } from './lib/store';
import { ensureScheduler } from './lib/automation';
import { wireAndroid } from './lib/android';
import { AppFrame, AppHeader, BottomNav, ExecutionOverlay, ToastLayer } from './components/layout/AppFrame';
import { Onboarding } from './screens/Onboarding';
import { PortfolioList } from './screens/PortfolioList';
import { CreateVault } from './screens/CreateVault';
import { VaultDetail } from './screens/VaultDetail';
import { WalletScreen } from './screens/WalletScreen';
import { SystemScreen } from './screens/SystemScreen';

/**
 * Root: the 430px lacquerboard column. Screens render inside the scroll
 * area keyed by route so each navigation enters with the appear motion;
 * ER execution-state sync starts when a wallet exists.
 */
export default function App() {
  const stack = useStore((s) => s.stack);
  const wallet = useStore((s) => s.wallet);
  const screen = stack[stack.length - 1];
  const scrollRef = useRef<HTMLDivElement>(null);

  // ER status, balances and live feeds sync while the app is open.
  useEffect(() => {
    if (wallet) ensureScheduler();
  }, [wallet]);

  // Android shell: hardware back + pulp status bar (no-op on web)
  useEffect(() => {
    void wireAndroid();
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
          {screen.id === 'wallet' ? <WalletScreen /> : null}
          {screen.id === 'system' ? <SystemScreen /> : null}
          {screen.id === 'create' ? <CreateVault /> : null}
          {screen.id === 'vault' ? <VaultDetail vaultId={screen.vaultId ?? ''} /> : null}
        </div>
      </main>
      {wallet && atTabLevel ? <BottomNav /> : null}
      <ToastLayer />
      <ExecutionOverlay />
    </AppFrame>
  );
}
