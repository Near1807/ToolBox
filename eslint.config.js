import { builtinModules } from 'node:module';
import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const root = import.meta.dirname;
const modulesDir = path.join(root, 'modules');

/**
 * The modules that also run on the phone (ADR 0044): their code (tests
 * aside) imports nothing of the PC — no Node built-in, no Electron, no
 * Fastify, no native package, not the PC part of the SDK (`@hub/sdk/core`
 * instead of `@hub/sdk/backend`).
 */
export const PORTABLE_MODULES = ['courses', 'sport', 'todo', 'timer', 'ideas'];
const PC_ONLY_PACKAGES = [
  'electron',
  'fastify',
  'better-sqlite3',
  'ffmpeg-static',
  '@derhuerst/ffprobe-static',
  'uiohook-napi',
  'onnxruntime-web',
];

/** Why `source` cannot be imported by a portable module (null when it can). */
export function pcOnlyImport(source) {
  if (source.startsWith('node:') || builtinModules.includes(source.split('/')[0]))
    return `« ${source} » est un module de Node`;
  if (source === '@hub/sdk/backend' || source === '@hub/sdk/testing')
    return `« ${source} » est la partie PC du SDK (utiliser @hub/sdk/core)`;
  if (source.startsWith('@napi-rs/') || source.startsWith('@fastify/'))
    return `« ${source} » ne tourne que sur le PC`;
  if (PC_ONLY_PACKAGES.some((p) => source === p || source.startsWith(`${p}/`)))
    return `« ${source} » ne tourne que sur le PC`;
  return null;
}

/**
 * Enforces the module contract (docs/MODULES.md):
 * - a module imports only @hub/sdk (and npm packages / Node built-ins), never
 *   the hub core, never `electron`, never another module — except `import type`
 *   from another module's contract.ts;
 * - @hub/sdk/testing only from tests;
 * - the modules that also run on the phone (PORTABLE_MODULES) import nothing
 *   of the PC (pcOnlyImport);
 * - the hub core never imports a module.
 */
const moduleBoundaries = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = context.filename;
    const inModules = file.startsWith(modulesDir + path.sep);
    const ownFolder = inModules ? path.relative(modulesDir, file).split(path.sep)[0] : null;
    const isTest = /[\\/]tests[\\/]|\.test\.tsx?$/.test(file);
    const portable = inModules && !isTest && PORTABLE_MODULES.includes(ownFolder);

    function check(node, source, isTypeOnly) {
      if (typeof source !== 'string') return;
      if (portable) {
        const why = pcOnlyImport(source);
        if (why)
          return context.report({
            node,
            message: `${why} : ce module tourne aussi sur le téléphone (ADR 0044), il passe par ctx.`,
          });
      }
      if (inModules) {
        if (source === '@hub/sdk/testing' && !isTest) {
          return context.report({ node, message: '@hub/sdk/testing est réservé aux tests.' });
        }
        if (source.startsWith('@hub/sdk')) return;
        if (source === 'electron') {
          return context.report({
            node,
            message: 'Un module n’importe jamais electron : utiliser ctx (ctx.files.open…).',
          });
        }
        if (!source.startsWith('.')) return; // npm package or Node built-in
        const target = path.resolve(path.dirname(file), source);
        if (target.startsWith(path.join(modulesDir, ownFolder) + path.sep)) return;
        if (target.startsWith(modulesDir + path.sep)) {
          if (isTypeOnly && path.basename(target).replace(/\.tsx?$/, '') === 'contract') return;
          return context.report({
            node,
            message:
              'Un module n’importe jamais un autre module : passer par ctx.services ou ctx.events ' +
              '(seul « import type » depuis le contract.ts d’un autre module est permis).',
          });
        }
        return context.report({
          node,
          message: 'Un module n’importe que @hub/sdk, jamais le code du socle.',
        });
      }
      if (
        source.startsWith('.') &&
        path.resolve(path.dirname(file), source).startsWith(modulesDir + path.sep)
      ) {
        context.report({
          node,
          message: 'Le socle ne connaît aucun module : il ne les importe jamais.',
        });
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value, node.importKind === 'type'),
      ExportNamedDeclaration: (node) =>
        node.source && check(node, node.source.value, node.exportKind === 'type'),
      ExportAllDeclaration: (node) => check(node, node.source.value, node.exportKind === 'type'),
      ImportExpression: (node) =>
        node.source.type === 'Literal' && check(node, node.source.value, false),
    };
  },
};

export default tseslint.config(
  { ignores: ['build/', 'dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['electron/**/*.ts', 'backend/**/*.ts', 'tests/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['frontend/**/*.{ts,tsx}', 'packages/**/*.tsx', 'modules/**/frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['modules/**/backend/**/*.ts', 'modules/**/tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { toolbox: { rules: { 'module-boundaries': moduleBoundaries } } },
    rules: { 'toolbox/module-boundaries': 'error' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
