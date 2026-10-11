import "./polyfills.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { SolanaWalletProvider } from "./wallet/SolanaWalletProvider.js";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SolanaWalletProvider>
      <App />
    </SolanaWalletProvider>
  </StrictMode>,
);
