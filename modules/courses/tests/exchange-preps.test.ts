// The JSON file with preparations (v0.27): « preparations » at the root,
// lines « { prep, qty } » in recipes; a preparation unknown everywhere is an
// error with its line; a recipe whose structure differs is said (same
// expansion or not); the image key; the round trip leaves the base as it is.
import Database from 'better-sqlite3';
import { createCanvas } from '@napi-rs/canvas';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestHost,
  createTestHub,
  loadModuleFolder,
  type TestHub,
  withoutSyncBookkeeping,
} from '@hub/sdk/testing';
import type { Preview } from '../shared/exchange';
import type { StateDto } from '../shared/types';

const API = '/api/modules/courses';

const BOLO_FILE = {
  format: 'toolbox-courses',
  version: 1,
  ingredients: [
    { name: 'Viande hachée', unit: 'g' },
    { name: 'Coulis', unit: 'g' },
    { name: 'Pâtes', unit: 'g' },
    { name: 'Parmesan', unit: 'g' },
  ],
  preparations: [
    {
      name: 'Sauce bolognaise',
      ingredients: [
        { name: 'Viande hachée', qty: 125, unit: 'g' },
        { name: 'Coulis', qty: 175, unit: 'g' },
      ],
      fridgeDays: 3,
      freezable: true,
      freezerDays: 90,
      note: 'Mijoter 1 h.',
    },
  ],
  recipes: [
    {
      name: 'Bolognaise',
      servings: 4,
      ingredients: [
        { prep: 'Sauce bolognaise', qty: 4 },
        { name: 'Pâtes', qty: 400, unit: 'g' },
        { name: 'Parmesan', qty: 40, unit: 'g' },
      ],
    },
  ],
};
/** The same recipe written with direct lines (the format of before). */
const BOLO_DIRECT = {
  ...BOLO_FILE,
  preparations: undefined,
  recipes: [
    {
      name: 'Bolognaise',
      servings: 4,
      ingredients: [
        { name: 'Viande hachée', qty: 500, unit: 'g' },
        { name: 'Coulis', qty: 700, unit: 'g' },
        { name: 'Pâtes', qty: 400, unit: 'g' },
        { name: 'Parmesan', qty: 40, unit: 'g' },
      ],
    },
  ],
};

describe('import / export with preparations', () => {
  let hub: TestHub;
  let saveTo = '';
  afterEach(async () => hub?.close());
  const open = async () => {
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({ selectSaveFile: () => Promise.resolve(saveTo) }),
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
  };
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status >= 400)
      throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const preview = (file: unknown) =>
    call<Preview>('POST', '/import/preview', { text: JSON.stringify(file) });
  const apply = (file: unknown, extra: object = {}) =>
    call<Record<string, unknown>>('POST', '/import/apply', {
      text: JSON.stringify(file),
      ...extra,
    });
  const state = () => call<StateDto>('GET', '/state');
  /** Every row of the module's tables (and the journal), to say « strictly the same base ». */
  const dump = () => {
    const db = new Database(path.join(hub.dataDir, 'hub.db'), { readonly: true });
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'courses__%'")
        .all() as { name: string }[]
    )
      .map((t) => t.name)
      // The synchronisation's bookkeeping (v0.32.0) is not the module's data.
      .filter((t) => !t.endsWith('__field_clock'));
    const out = withoutSyncBookkeeping(
      Object.fromEntries(
        tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]),
      ),
    );
    db.close();
    return out;
  };

  it('a file with preparations: the preparation, then the recipe that uses it', async () => {
    await open();
    const p = await preview(BOLO_FILE);
    expect(p.preparations).toEqual([
      {
        name: 'Sauce bolognaise',
        line: expect.any(Number) as number,
        status: 'new',
        unknown: [],
        changes: [],
        usedBy: [],
      },
    ]);
    expect(p.errors).toEqual([]);
    const done = await apply(BOLO_FILE);
    expect(done).toMatchObject({ prepsAdded: 1, recipesAdded: 1 });
    const s = await state();
    expect(s.preps[0]).toMatchObject({
      name: 'Sauce bolognaise',
      fridgeDays: 3,
      freezable: true,
      freezerDays: 90,
      note: 'Mijoter 1 h.',
    });
    expect(s.meals[0]!.split).toBe(true);
    expect(s.meals[0]!.items.map((i) => i.qty)).toEqual([500, 700, 400, 40]);
  });

  it('a recipe naming a preparation absent from the file and from ToolBox: an error with its line', async () => {
    await open();
    const file = { ...BOLO_FILE, preparations: undefined };
    const text = JSON.stringify(file, null, 2);
    const p = await call<Preview>('POST', '/import/preview', { text });
    expect(p.recipes).toEqual([]);
    expect(p.errors).toEqual([
      {
        line: text.split('\n').findIndex((l) => l.includes('"name": "Bolognaise"')),
        where: 'recette « Bolognaise »',
        message: 'préparation inconnue : « Sauce bolognaise » (ni dans le fichier ni dans ToolBox)',
      },
    ]);
    await call('POST', '/import/apply', { text });
    expect((await state()).meals).toEqual([]);
  });

  it('structure different: « même dépliage », or « structure et dépliage différents »', async () => {
    await open();
    await apply(BOLO_DIRECT);
    const same = await preview(BOLO_FILE);
    expect(same.recipes[0]).toMatchObject({
      status: 'differs',
      changes: ['structure différente, même dépliage'],
    });
    const other = {
      ...BOLO_FILE,
      recipes: [
        {
          ...BOLO_FILE.recipes[0]!,
          ingredients: [
            { prep: 'Sauce bolognaise', qty: 3 },
            { name: 'Pâtes', qty: 400, unit: 'g' },
          ],
        },
      ],
    };
    expect((await preview(other)).recipes[0]!.changes).toEqual([
      'structure et dépliage différents (Viande hachée 500 g → 375 g ; Coulis 700 g → 525 g ; − Parmesan 40 g)',
    ]);
    // Not ticked: nothing changes.
    const before = dump();
    await apply(other);
    const after = dump();
    expect(after.courses__meals).toEqual(before.courses__meals);
    expect(after.courses__meal_items).toEqual(before.courses__meal_items);
  });

  it('a preparation of the file that changes recipes already there: said before', async () => {
    await open();
    await apply(BOLO_FILE);
    const changed = {
      ...BOLO_FILE,
      preparations: [
        {
          ...BOLO_FILE.preparations[0]!,
          ingredients: [{ name: 'Viande hachée', qty: 150, unit: 'g' }],
        },
      ],
    };
    const p = await preview(changed);
    expect(p.preparations[0]).toMatchObject({
      status: 'differs',
      changes: ['composition'],
      usedBy: ['Bolognaise'],
    });
    await apply(changed);
    expect((await state()).preps[0]!.items).toHaveLength(2); // not ticked: unchanged
    await apply(changed, { overwritePreps: ['Sauce bolognaise'] });
    expect((await state()).preps[0]!.items).toHaveLength(1);
  });

  it('the « image » key: absent or null, the image there is never touched', async () => {
    await open();
    await apply(BOLO_DIRECT);
    const c = createCanvas(40, 30);
    const ctx2d = c.getContext('2d');
    ctx2d.fillRect(0, 0, 40, 30);
    const data = `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`;
    const meal = (await state()).meals[0]!;
    await call('PUT', `/meals/${meal.id}/image`, { data });
    const image = () =>
      (dump().courses__meal_images ?? []).filter(
        (r) => (r as { deleted_at: unknown }).deleted_at === null,
      );
    const before = image();
    expect(before).toHaveLength(1);
    const withKey = (value: unknown) => ({
      ...BOLO_DIRECT,
      recipes: [{ ...BOLO_DIRECT.recipes[0]!, servings: 2, image: value }],
    });
    for (const file of [withKey(undefined), withKey(null)]) {
      await apply(file, { replaceRecipes: ['Bolognaise'] });
      expect(image()).toEqual(before);
    }
  });

  it('export then import: the base strictly the same; into an empty base, the same export', async () => {
    await open();
    await apply(BOLO_FILE);
    await apply({
      ...BOLO_DIRECT,
      recipes: [{ ...BOLO_DIRECT.recipes[0]!, name: 'Bolo directe' }],
    });
    const dir = mkdtempSync(path.join(os.tmpdir(), 'courses-rt-'));
    saveTo = path.join(dir, 'a.json');
    await call('POST', '/export-json');
    const text = readFileSync(saveTo, 'utf8');
    expect(JSON.parse(text)).toMatchObject({
      preparations: [{ name: 'Sauce bolognaise' }],
      recipes: [
        { name: 'Bolo directe' },
        { name: 'Bolognaise', ingredients: [{ prep: 'Sauce bolognaise', qty: 4 }, {}, {}] },
      ],
    });
    const before = dump();
    const p = await call<Preview>('POST', '/import/preview', { text });
    expect(
      [...p.ingredients, ...p.preparations, ...p.recipes].every((x) => x.status === 'same'),
    ).toBe(true);
    await call('POST', '/import/apply', { text });
    const after = dump();
    // Only the backup taken before an import is new; no row of the module changes.
    expect(after).toEqual(before);
    await hub.close();
    await open();
    await call('POST', '/import/apply', { text });
    saveTo = path.join(dir, 'b.json');
    await call('POST', '/export-json');
    expect(readFileSync(saveTo, 'utf8')).toBe(text);
  });
});
