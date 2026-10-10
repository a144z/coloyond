import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";
import { DEFAULT_NETWORK, NETWORK_RPC } from "../../symmetry/config.js";

const APP_ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://coloyond.app";

// Golden-standard setup: ConnectionProvider + WalletProvider + WalletModalProvider.
// Passing an empty-ish wallets array keeps Wallet Standard auto-discovery, so any
// installed extension (Phantom, Solflare, Backpack, ...) is found automatically.
// Supplying our own SolanaMobileWalletAdapter overrides the built-in default and
// lets web browsers on Android connect to an installed mobile wallet via MWA.
export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = NETWORK_RPC[DEFAULT_NETWORK];
  const wallets = useMemo(
    () => [
      new SolanaMobileWalletAdapter({
        addressSelector: createDefaultAddressSelector(),
        appIdentity: { name: "coloyond", uri: APP_ORIGIN, icon: `${APP_ORIGIN}/coloyond-icon.svg` },
        authorizationResultCache: createDefaultAuthorizationResultCache(),
        cluster: WalletAdapterNetwork.Devnet,
        onWalletNotFound: createDefaultWalletNotFoundHandler(),
      }),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
