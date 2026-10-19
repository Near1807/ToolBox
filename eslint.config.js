import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const root = import.meta.dirname;
const modulesDir = path.join(root, 'modules');

/**
 * Enforces the module contract (docs/MODULES.md):
 * - a module imports only @hub/sdk (and npm packages / Node built-ins), never
 *   the hub core, never `electron`, never another module — except `import type`
 *   from another module's contract.ts;
 * - @hub/sdk/testing only from tests;
 * - the hub core never imports a module.
 */
const moduleBoundaries = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const file = context.filename;
    const inModules = file.startsWith(modulesDir + path.sep);
    const ownFolder = inModules ? path.relative(modulesDir, file).split(path.sep)[0] : null;
    const isTest = /[\\/]tests[\\/]|\.test\.tsx?$/.test(file);

    function check(node, source, isTypeOnly) {
      if (typeof source !== 'string') return;
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
