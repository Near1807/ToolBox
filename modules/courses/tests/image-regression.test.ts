// Non-regression of the recipe images (step 2 of the phone version, ADR
// 0044): a fixed set of images (drawn here, their bytes checked), reduced
// and re-encoded by the module, directly and through every route that
// touches them (set from a file or a data URL, replaced, removed, exported
// in the JSON, imported back). The reference (fixtures/images.json) was
// written by the v0.29.0 code, before the images moved behind an adapter of
// the core: same sizes, same sha256, same JPEG bytes (md5), same errors.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestHost,
  createTestHub,
  dumpTables,
  loadModuleFolder,
  readReference,
  normaliseImage as normaliseWith,
  referenceShape,
  type TestHub,
} from '@hub/sdk/testing';
import { RECIPE_IMAGE } from '../backend/images';
import type { StateDto } from '../shared/types';

const API = '/api/modules/courses';
const REFERENCE = path.join(__dirname, 'fixtures', 'images.json');
/** A recipe image as the module stores it (`ctx.images.normalise` with its options). */
const normaliseImage = (input: Uint8Array) => normaliseWith(input, RECIPE_IMAGE);
const hash = (algo: 'sha256' | 'md5', data: Uint8Array) =>
  createHash(algo).update(data).digest('hex');

/** The fixed image set: shapes and gradients, with and without transparency, every format. */
function drawn(w: number, h: number, alpha: boolean) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, alpha ? 'rgba(200, 40, 40, 0.2)' : '#c82828');
  grad.addColorStop(1, alpha ? 'rgba(20, 60, 200, 0.9)' : '#143cc8');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = alpha ? 'rgba(250, 220, 0, 0.5)' : '#fadc00';
  g.beginPath();
  g.arc(w * 0.6, h * 0.4, Math.min(w, h) / 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#103010';
  g.fillRect(w * 0.1, h * 0.7, w * 0.3, h * 0.2);
  return c;
}
const INPUTS: [string, () => Promise<Buffer> | Buffer][] = [
  ['png 3000×2000', () => drawn(3000, 2000, false).toBuffer('image/png')],
  ['png 600×800 transparent', () => drawn(600, 800, true).toBuffer('image/png')],
  ['jpeg 1600×1200', () => drawn(1600, 1200, false).encode('jpeg', 90)],
  ['webp 1300×500 transparent', () => drawn(1300, 500, true).encode('webp', 80)],
  ['png 1×1', () => drawn(1, 1, false).toBuffer('image/png')],
  ['png 1200×1201', () => drawn(1200, 1201, false).toBuffer('image/png')],
  ['empty', () => Buffer.alloc(0)],
  ['text', () => Buffer.from('bonjour')],
  ['too heavy', () => Buffer.alloc(20 * 1024 * 1024 + 1)],
];

describe('non-regression of the recipe images (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());

  it('same sizes, fingerprints, JPEG bytes and errors, directly and through the routes', async () => {
    const inputs = new Map<string, Buffer>();
    for (const [name, make] of INPUTS) inputs.set(name, await make());
    const direct: Record<string, unknown> = {};
    for (const [name, input] of inputs) {
      try {
        const img = await normaliseImage(input);
        // The inputs are drawn here: their PNG bytes may differ between systems (the
        // encoder), never what the module stores from them.
        direct[name] = {
          width: img.width,
          height: img.height,
          bytes: img.data.length,
          sha256: img.sha256,
          sha256OfData: hash('sha256', img.data),
          md5: hash('md5', img.data),
        };
      } catch (err) {
        direct[name] = { error: (err as Error).message };
      }
    }

    // Through the routes.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'courses-img-'));
    let saveTo = '';
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({ selectSaveFile: () => Promise.resolve(saveTo) }),
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const steps: [string, unknown][] = [];
    const call = async <T>(method: string, url: string, body?: unknown) => {
      const r = await hub.request<T>(method, `${API}${url}`, body);
      steps.push([`${method} ${url}`, { status: r.status }]);
      if (r.status >= 400) steps.push(['error', r.body]);
      return r.body;
    };
    const meal = async (name: string) =>
      (await call<{ id: string }>('POST', '/meals', { name, servings: 2, items: [] })).id;
    const gratin = await meal('Gratin');
    const curry = await meal('Curry');
    const file = path.join(dir, 'big.png');
    writeFileSync(file, inputs.get('png 3000×2000')!);
    const dataUrl = (b: Buffer, type = 'png') =>
      `data:image/${type};base64,${b.toString('base64')}`;
    await call('PUT', `/meals/${gratin}/image`, { path: file });
    await call('PUT', `/meals/${curry}/image`, {
      data: dataUrl(inputs.get('webp 1300×500 transparent')!, 'webp'),
    });
    // Replaced (the old file goes to the Recycle Bin), refused, removed.
    await call('PUT', `/meals/${curry}/image`, {
      data: dataUrl(inputs.get('png 600×800 transparent')!),
    });
    await call('PUT', `/meals/${gratin}/image`, { path: path.join(dir, 'absent.png') });
    await call('PUT', `/meals/${gratin}/image`, { data: dataUrl(Buffer.from('bonjour')) });
    await call('PUT', `/meals/${gratin}/image`, { data: 'data:text/html;base64,AAAA' });
    await call('PUT', `/meals/${gratin}/image`, {});
    const heavy = path.join(dir, 'heavy.png');
    writeFileSync(heavy, inputs.get('too heavy')!);
    await call('PUT', `/meals/${gratin}/image`, { path: heavy });
    const third = await meal('Salade');
    await call('PUT', `/meals/${third}/image`, {
      data: dataUrl(inputs.get('jpeg 1600×1200')!, 'jpeg'),
    });
    await call('DELETE', `/meals/${third}/image`);
    const state = await call<StateDto>('GET', '/state');
    const shown = state.meals.map((m) => ({
      name: m.name,
      image: m.image
        ? { width: m.image.width, height: m.image.height, url: Boolean(m.image.url) }
        : null,
    }));
    // The JSON export carries the stored JPEG, the import re-encodes it.
    saveTo = path.join(dir, 'export.json');
    await call('POST', '/export-json');
    const exported = JSON.parse(readFileSync(saveTo, 'utf8')) as {
      recipes: { name: string; image?: string | null }[];
    };
    const exportedImages = exported.recipes.map((r) => ({
      name: r.name,
      image: r.image ? hash('md5', Buffer.from(r.image.split(',')[1]!, 'base64')) : null,
      prefix: r.image ? r.image.slice(0, 23) : null,
    }));
    const text = JSON.stringify({
      ...exported,
      recipes: [
        ...exported.recipes.map((r) => ({ ...r, name: `${r.name} (copie)` })),
        { name: 'Illisible', servings: 1, ingredients: [], image: dataUrl(Buffer.from('bonjour')) },
      ],
    });
    const { backup, ...applied } = await call<{ backup: string }>('POST', '/import/apply', {
      text,
    });
    expect(backup).toMatch(/avant-import/); // Named after the real clock: checked apart.
    const images = path.join(hub.dataDir, 'modules', 'courses', 'images');
    const files = existsSync(images)
      ? readdirSync(images)
          .map((f) => hash('md5', readFileSync(path.join(images, f))))
          .sort()
      : [];
    const rows = dumpTables(hub.dataDir, 'courses').courses__meal_images;

    const snapshot = referenceShape(
      {
        direct,
        steps,
        shown,
        exportedImages,
        applied,
        files,
        rows,
      },
      0,
    );
    // Only the fingerprints and sizes of the rows (their times are the real clock).
    const { rows: liveRows, ...rest } = snapshot as { rows: Record<string, unknown>[] };
    const stable = {
      ...rest,
      rows: liveRows.map((r) => ({
        meal_id: r.meal_id,
        width: r.width,
        height: r.height,
        bytes: r.bytes,
        sha256: r.sha256,
        deleted: r.deleted_at !== null,
      })),
    };
    expect(stable).toEqual(readReference(REFERENCE, stable));
  });
});
