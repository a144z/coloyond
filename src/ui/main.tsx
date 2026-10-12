import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SolanaWalletProvider } from './wallet/SolanaWalletProvider.js';
import { App } from './App.js';
import '@solana/wallet-adapter-react-ui/styles.css';
import './app.css';
(globalThis as unknown as {Buffer:typeof Buffer}).Buffer=Buffer;
createRoot(document.getElementById('root')!).render(<StrictMode><SolanaWalletProvider><App/></SolanaWalletProvider></StrictMode>);
