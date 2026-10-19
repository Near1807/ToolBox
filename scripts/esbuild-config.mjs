import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * Main process + backend bundle. Runtime `dependencies` stay external: they are
 * shipped in node_modules by electron-builder (native addons, binaries).
 * Everything bundled by Vite for the UI belongs in devDependencies.
 */
export const mainBuildOptions = {
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'build/main',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: ['electron', ...Object.keys(pkg.dependencies ?? {})],
  logLevel: 'info',
};
