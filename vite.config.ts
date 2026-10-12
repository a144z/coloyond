import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { global: "globalThis" },
  resolve: {
    // weights.ts imports node:crypto and hashes at module load; externalized in
    // the browser that throws and blanks the whole app. See the shim file.
    // Root-relative: a bare "src/…" target is looked up in node_modules and the
    // dev import-analysis pass fails to resolve it, which blanks every route.
    alias: { "node:crypto": "/src/ui/node-crypto-shim.ts" },
  },
});
