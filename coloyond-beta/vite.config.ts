import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// web3.js v1 needs Buffer/global shims in the browser bundle.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: false,
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
