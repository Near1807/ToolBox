// Build of the probe app's page (dist/), copied into the APK by `npx cap sync`.
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths: the page is served from the APK's assets.
  base: './',
  // sqlite-wasm finds its .wasm next to its module (import.meta.url).
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
