// Verifies that native dependencies load inside Electron's own Node runtime
// (ELECTRON_RUN_AS_NODE), not only in the system Node used by Vitest.
// better-sqlite3 >= 13 ships N-API prebuilds, so one binary serves both
// (see docs/decisions/0003-sqlite-better-sqlite3.md). This guards against regressions.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const probe = `
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const { v } = db.prepare('select sqlite_version() as v').get();
  console.log('better-sqlite3 OK in Electron ' + process.versions.electron + ' (Node ' + process.versions.node + ', SQLite ' + v + ')');
`;

const result = spawnSync(electronPath, ['-e', probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.status !== 0) {
  console.error('Native module check failed under Electron.');
  process.exit(1);
}
