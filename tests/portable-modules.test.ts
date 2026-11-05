// Portable modules (ADR 0044: the five of the phone, the template, any new
// one) import nothing of the PC and use no Node global: ESLint fails on a
// forbidden import or global in their code, never in their tests nor in the
// PC-only modules (music, assistant).
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: root });
const errorsOf = async (file: string, code: string, rule = 'toolbox/module-boundaries') => {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result!.messages.filter((m) => m.ruleId === rule).map((m) => m.message);
};
const globalsOf = (file: string, code: string) => errorsOf(file, code, 'no-restricted-globals');
const PORTABLE = ['courses', 'sport', 'todo', 'timer', 'ideas', '_template', 'nouveau-module'];

describe('portable modules (ESLint)', () => {
  const forbidden = [
    "import { readFileSync } from 'node:fs';",
    "import path from 'path';",
    "import { promises } from 'fs/promises';",
    "import { app } from 'electron';",
    "import type { FastifyRequest } from 'fastify';",
    "import Database from 'better-sqlite3';",
    "import { createCanvas } from '@napi-rs/canvas';",
    "import { HttpError } from '@hub/sdk/backend';",
    "export { HttpError } from '@hub/sdk/backend';",
    "const m = await import('node:crypto');",
  ];
  for (const folder of PORTABLE)
    it(`${folder}: a forbidden import fails`, async () => {
      for (const code of forbidden) {
        const errors = await errorsOf(`modules/${folder}/backend/x.ts`, `${code}\nexport {};\n`);
        expect(errors, code).toHaveLength(1);
        expect(errors[0]).toMatch(/tourne aussi sur le téléphone/);
      }
    });

  it('allowed: the portable SDK, the module’s own files; frontend and shared code checked too', async () => {
    expect(
      await errorsOf(
        'modules/todo/backend/x.ts',
        "import { HttpError } from '@hub/sdk/core';\nimport { a } from '../shared';\nexport { HttpError, a };\n",
      ),
    ).toEqual([]);
    expect(
      await errorsOf('modules/sport/frontend/x.tsx', "import 'node:fs';\nexport {};\n"),
    ).toHaveLength(1);
    expect(
      await errorsOf('modules/courses/shared/x.ts', "import 'node:path';\nexport {};\n"),
    ).toHaveLength(1);
  });

  it('not concerned: their tests, the music modules and the assistant', async () => {
    const code = "import { readFileSync } from 'node:fs';\nexport { readFileSync };\n";
    expect(await errorsOf('modules/todo/tests/x.test.ts', code)).toEqual([]);
    expect(await errorsOf('modules/music-library/backend/x.ts', code)).toEqual([]);
    expect(await errorsOf('modules/assistant/backend/x.ts', code)).toEqual([]);
  });

  const nodeGlobals = [
    'export const a = Buffer.from("x");',
    'export const a = process.env.HOME;',
    'export const a = global;',
    'export const a = __dirname;',
    'export const a = __filename;',
    'export const a = require("x");',
  ];
  for (const folder of PORTABLE)
    it(`${folder}: a Node global fails`, async () => {
      for (const code of nodeGlobals) {
        const errors = await globalsOf(`modules/${folder}/backend/x.ts`, `${code}\n`);
        expect(errors, code).toHaveLength(1);
        expect(errors[0]).toMatch(/global de Node/);
      }
    });

  it('Node globals: allowed in tests and in the PC-only modules; Web globals allowed', async () => {
    const code = 'export const a = Buffer.from(process.env.HOME ?? "");\n';
    expect(await globalsOf('modules/todo/tests/x.test.ts', code)).toEqual([]);
    expect(await globalsOf('modules/music-library/backend/x.ts', code)).toEqual([]);
    expect(await globalsOf('modules/assistant/backend/x.ts', code)).toEqual([]);
    expect(
      await globalsOf(
        'modules/todo/backend/x.ts',
        'export const a = [crypto.randomUUID(), btoa("x"), new TextEncoder()];\n',
      ),
    ).toEqual([]);
  });

  it('the code the phone shares with the PC: no Node import, no Node global', async () => {
    for (const file of ['packages/phone/x.ts', 'backend/core/migrations-core.ts']) {
      const [result] = await eslint.lintText(
        "import { readFileSync } from 'node:fs';\nexport const a = [readFileSync, Buffer];\n",
        { filePath: path.join(root, file) },
      );
      expect(result!.messages.map((m) => m.ruleId).sort(), file).toEqual([
        'no-restricted-globals',
        'no-restricted-imports',
      ]);
    }
  });
});
