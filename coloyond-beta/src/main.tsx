import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import './styles/theme.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import App from './App';
import { RPC_URL } from './lib/solana/config';
import { useStore } from './lib/store';
import type { WalletSigner } from './lib/solana/tx';

function WalletStateBridge() {
  const { connected, publicKey, signTransaction } = useWallet();
  const setConnectedWallet = useStore((state) => state.setConnectedWallet);
  const signer = useMemo<WalletSigner | null>(() => {
    if (!connected || !publicKey) return null;
    return {
      publicKey,
      signTransaction: signTransaction
        ? (transaction) => signTransaction(transaction)
        : async () => { throw new Error('This wallet can connect, but it does not support transaction signing.'); },
    };
  }, [connected, publicKey, signTransaction]);

  useEffect(() => {
    setConnectedWallet(signer);
  }, [setConnectedWallet, signer]);

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <WalletStateBridge />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </StrictMode>,
);
