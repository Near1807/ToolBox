import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const modulesDir = path.join(root, 'modules');

/**
 * Build-time module discovery: `import modules from 'virtual:toolbox-modules'`
 * becomes the list of every folder in modules/ that has a module.json, with its
 * manifest and its backend (default export of backend/index.ts, if present).
 * Adding a module = adding a folder + rebuilding (docs/decisions/0005).
 */
export const discoverModulesPlugin = {
  name: 'toolbox-modules',
  setup(build) {
    build.onResolve({ filter: /^virtual:toolbox-modules$/ }, () => ({
      path: 'toolbox-modules',
      namespace: 'toolbox-modules',
    }));
    build.onLoad({ filter: /.*/, namespace: 'toolbox-modules' }, () => {
      const folders = existsSync(modulesDir)
        ? readdirSync(modulesDir, { withFileTypes: true })
            .filter(
              (e) => e.isDirectory() && existsSync(path.join(modulesDir, e.name, 'module.json')),
            )
            .map((e) => e.name)
            .sort()
        : [];
      const lines = [];
      const entries = folders.map((folder, i) => {
        const dir = path.join(modulesDir, folder);
        lines.push(`import manifest${i} from ${JSON.stringify(path.join(dir, 'module.json'))};`);
        const backend = ['index.ts', 'index.js']
          .map((f) => path.join(dir, 'backend', f))
          .find((f) => existsSync(f));
        if (backend) lines.push(`import backend${i} from ${JSON.stringify(backend)};`);
        return `{ folder: ${JSON.stringify(folder)}, manifest: manifest${i}, backend: ${backend ? `backend${i}` : 'undefined'} }`;
      });
      lines.push(`export default [${entries.join(', ')}];`);
      return {
        contents: lines.join('\n'),
        resolveDir: root,
        loader: 'js',
        watchDirs: [modulesDir],
      };
    });
  },
};

/**
 * Copies every modules/<folder>/assets/ to build/modules/<folder>/assets/
 * (packaged with the app, unpacked from app.asar: see electron-builder.yml).
 */
export const copyModuleAssetsPlugin = {
  name: 'toolbox-module-assets',
  setup(build) {
    build.onEnd(() => {
      const target = path.join(root, 'build', 'modules');
      rmSync(target, { recursive: true, force: true });
      if (!existsSync(modulesDir)) return;
      for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
        const assets = path.join(modulesDir, entry.name, 'assets');
        if (entry.isDirectory() && existsSync(assets)) {
          cpSync(assets, path.join(target, entry.name, 'assets'), { recursive: true });
        }
      }
    });
  },
};

/**
 * Main process + backend + module backends in one bundle. Runtime
 * `dependencies` stay external: they are shipped in node_modules by
 * electron-builder (native addons, binaries). Everything else is bundled.
 */
export const mainBuildOptions = {
  absWorkingDir: root,
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'build/main',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  alias: { '@hub/sdk': './packages/sdk' },
  external: ['electron', ...Object.keys(pkg.dependencies ?? {})],
  plugins: [discoverModulesPlugin, copyModuleAssetsPlugin],
  logLevel: 'info',
};
