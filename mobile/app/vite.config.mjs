// Build of the phone app's page and Worker (dist/), copied into the APK by
// `npx cap sync android`. React, the SDK, the themes and the modules come
// from the repository's root (one copy of React: dedupe).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.resolve(import.meta.dirname, '../..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@hub/sdk': path.join(root, 'packages/sdk') },
    dedupe: ['react', 'react-dom', 'react-router'],
  },
  define: { __APP_VERSION__: JSON.stringify(version) },
  // sqlite-wasm finds its .wasm next to its module (import.meta.url).
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  server: { fs: { allow: [root] } },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
