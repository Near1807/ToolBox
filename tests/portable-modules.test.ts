// The modules that also run on the phone (ADR 0044) import nothing of the PC:
// the ESLint rule fails on a forbidden import in their code, never in their
// tests nor in the other modules.
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: root });
const errorsOf = async (file: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result!.messages
    .filter((m) => m.ruleId === 'toolbox/module-boundaries')
    .map((m) => m.message);
};

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
  for (const folder of ['courses', 'sport', 'todo', 'timer', 'ideas'])
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
});
