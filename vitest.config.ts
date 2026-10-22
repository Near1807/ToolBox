import path from 'node:path';
import { defineConfig } from 'vitest/config';

// `vitest run --mode full` (npm run test:full): also the complete renders
// (fullRenderTests in @hub/sdk/testing).
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { '@hub/sdk': path.resolve(import.meta.dirname, 'packages/sdk') },
  },
  test: {
    include: ['tests/**/*.test.ts', 'modules/**/*.test.ts'],
    environment: 'node',
    // Integration tests start real hubs and run FFmpeg: allow for slow CI machines.
    testTimeout: 20_000,
    env: { TOOLBOX_TEST_FULL: mode === 'full' ? '1' : '' },
  },
}));
