import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the backend runs inside Electron on a fixed port. The proxy keeps the
// frontend same-origin and injects the session token, so the UI also works in a
// regular browser at http://localhost:5173 (see docs/ARCHITECTURE.md).
const apiPort = process.env.TOOLBOX_API_PORT ?? '47321';
const devToken = process.env.TOOLBOX_DEV_TOKEN ?? '';

export default defineConfig({
  root: 'frontend',
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@hub/sdk': path.resolve(import.meta.dirname, 'packages/sdk') },
  },
  build: {
    outDir: '../build/renderer',
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.TOOLBOX_VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        headers: devToken ? { 'x-toolbox-token': devToken } : {},
      },
    },
  },
});
