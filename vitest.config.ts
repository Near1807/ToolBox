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
    // A test that checks nothing fails (every test makes at least one assertion).
    expect: { requireAssertions: true },
    // Integration tests start real hubs and run FFmpeg: allow for slow CI machines.
    testTimeout: 20_000,
    // The non-regression references were written in UTC (the CI's zone too): the
    // same zone on every machine (Thomas's PC is in Europe/Brussels), so a test
    // gives the same result everywhere. Tests about time zones name theirs.
    env: { TOOLBOX_TEST_FULL: mode === 'full' ? '1' : '', TZ: 'UTC' },
  },
}));
