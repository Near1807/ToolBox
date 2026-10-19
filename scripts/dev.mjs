// Development launcher: Vite (UI, hot reload) + esbuild watch (main process and
// backend) + Electron, restarted whenever the main bundle changes.
// The UI is also reachable in a regular browser at the printed Vite URL.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { context } from 'esbuild';
import { createServer } from 'vite';
import { mainBuildOptions } from './esbuild-config.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

process.env.TOOLBOX_API_PORT ??= '47321';
process.env.TOOLBOX_DEV_TOKEN = randomBytes(32).toString('hex');

const vite = await createServer({ configFile: 'vite.config.ts' });
await vite.listen();
const devUrl = vite.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
vite.printUrls();

// Electron refuses to run as root on Linux without this flag (containers, CI).
const electronArgs = ['.'];
if (process.platform === 'linux' && process.getuid?.() === 0) electronArgs.push('--no-sandbox');

let electron = null;
let shuttingDown = false;

function startElectron() {
  electron = spawn(electronPath, electronArgs, {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl },
  });
  electron.on('exit', () => {
    // Closing the window ends the dev session; restarts are handled below.
    if (!electron?.restarting && !shuttingDown) void shutdown();
  });
}

function restartElectron() {
  if (!electron) return startElectron();
  electron.restarting = true;
  electron.once('exit', startElectron);
  electron.kill();
}

const ctx = await context({
  ...mainBuildOptions,
  plugins: [
    {
      name: 'restart-electron',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) restartElectron();
        });
      },
    },
  ],
});
await ctx.watch();

async function shutdown() {
  shuttingDown = true;
  electron?.kill();
  await ctx.dispose();
  await vite.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
