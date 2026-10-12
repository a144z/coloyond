import {readSharedMix} from './lib/art/remix-link.js';
// Mounts the coloyond-beta mobile app in this frontend. The adapter context
// (ConnectionProvider, WalletProvider, WalletModalProvider) already wraps every
// route via SolanaWalletProvider in main.tsx; only a ConnectionProvider for the
// beta devnet endpoint is nested here, mirroring coloyond-beta/src/main.tsx.
// The wallet state bridge below is that file's WalletStateBridge, verbatim.
import { useEffect, useMemo } from "react";
import { ConnectionProvider, useWallet } from "@solana/wallet-adapter-react";
import { useStore } from "./lib/store.js";
import { RPC_URL } from "./lib/solana/config.js";
import type { WalletSigner } from "./lib/solana/tx.js";
import App from "./App.js";
import "./styles/app-theme.css";

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
    // Wallet association resets navigation; restore a validated, unsigned remix draft afterwards.
    if (readSharedMix(window.location.search)) useStore.getState().pushScreen({id: "create"});
  }, [setConnectedWallet, signer]);

  return <App />;
}

export function MobileApp() {
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletStateBridge />
    </ConnectionProvider>
  );
}
