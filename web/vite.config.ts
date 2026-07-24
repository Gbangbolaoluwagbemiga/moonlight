import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // @midnight-ntwrk/ledger-v8 ships a WASM module (the ZK/ledger runtime); this
  // plugin lets Vite bundle it instead of erroring on the ESM-Wasm import.
  // (vite-plugin-top-level-await is intentionally omitted: it hard-requires the
  // classic `rollup` package, which Vite 8's Rolldown-based build no longer
  // ships. Not needed anyway since the esnext build target already assumes
  // native top-level-await support.)
  plugins: [react(), wasm()],
  // esbuild's default target can't downlevel the destructuring patterns used by
  // the WASM glue code; the browser already has WebSocket/BigInt/top-level-await
  // support, so just target modern browsers instead of transpiling.
  build: {
    target: 'esnext',
  },
  esbuild: {
    target: 'esnext',
  },
  resolve: {
    alias: {
      // isomorphic-ws's browser build assigns `module.exports = WebSocket`
      // (no named export), which breaks Rollup's static named-import
      // analysis. The browser already has a native WebSocket, so shim it.
      'isomorphic-ws': path.resolve(__dirname, 'src/shims/isomorphic-ws.ts'),
    },
  },
  define: {
    global: 'globalThis',
  },
  server: {
    fs: {
      // Allow serving the compiled ZK circuit assets from ../contract/src/managed
      allow: ['..'],
    },
  },
});
