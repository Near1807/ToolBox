import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@hub/sdk': path.resolve(import.meta.dirname, 'packages/sdk') },
  },
  test: {
    include: ['tests/**/*.test.ts', 'modules/**/*.test.ts'],
    environment: 'node',
    // Integration tests start real hubs and run FFmpeg: allow for slow CI machines.
    testTimeout: 20_000,
  },
});
