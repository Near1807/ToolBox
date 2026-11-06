// The recipe images' reference (fixtures/images.json) replayed on the PHONE's
// stack (ADR 0044): the same steps through the routes, with what the phone
// sends (the picture's content as a data: URL — a phone has no file path; a
// path still answers « Fichier introuvable »), files in the phone's store
// (OPFS in the app, here in memory) and ctx.images.normalise given by the
// host. The phone re-encodes with the browser (OffscreenCanvas), whose JPEG
// bytes differ from Skia's: what is compared is the sizes, the refusals and
// their messages, the shown images, the import and the meal_images rows —
// never the bytes or their fingerprints. The browser's normaliser itself is
// checked against the same sizes in Chromium (see the v0.31.0 report).
import { createCanvas } from '@napi-rs/canvas';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dumpWasmTables,
  loadModuleFolder,
  MemoryFileStore,
  normaliseImage,
  openWasmDatabase,
  PhoneHub,
  phoneRequest,
  readReference,
  referenceShape,
} from '@hub/sdk/testing';
import type { StateDto } from '../shared/types';

const API = '/api/modules/courses';
const REFERENCE = path.join(__dirname, 'fixtures', 'images.json');

/** The same drawings as image-regression.test.ts. */
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

describe('the recipe images on the phone = the reference (sizes, refusals, rows; not bytes)', () => {
  let hub: PhoneHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
  });

  it('same steps, messages, shown images, import and rows', async () => {
    const files = new MemoryFileStore();
    let saved = '';
    const db = await openWasmDatabase();
    hub = await PhoneHub.start({
      db,
      modules: [(await loadModuleFolder(path.resolve(__dirname, '..'))) as never],
      host: {
        files,
        normaliseImage,
        saveAs: (o) => {
          saved = String(o.data);
          return Promise.resolve(o.defaultName);
        },
        backupDb: (reason) => `test-${reason}`,
      },
      log: () => {},
    });
    const phone = hub;
    const steps: [string, unknown][] = [];
    const call = async <T>(method: string, url: string, body?: unknown) => {
      const r = await phoneRequest<T>(phone, method, `${API}${url}`, body);
      steps.push([`${method} ${url}`, { status: r.status }]);
      if (r.status >= 400) steps.push(['error', r.body]);
      return r.body;
    };
    const dataUrl = (b: Buffer, type = 'png') =>
      `data:image/${type};base64,${b.toString('base64')}`;
    const meal = async (name: string) =>
      (await call<{ id: string }>('POST', '/meals', { name, servings: 2, items: [] })).id;
    const gratin = await meal('Gratin');
    const curry = await meal('Curry');
    // The PC sent a file path here: the phone sends the content.
    await call('PUT', `/meals/${gratin}/image`, {
      data: dataUrl(drawn(3000, 2000, false).toBuffer('image/png')),
    });
    await call('PUT', `/meals/${curry}/image`, {
      data: dataUrl(await drawn(1300, 500, true).encode('webp', 80), 'webp'),
    });
    await call('PUT', `/meals/${curry}/image`, {
      data: dataUrl(drawn(600, 800, true).toBuffer('image/png')),
    });
    await call('PUT', `/meals/${gratin}/image`, { path: '/sdcard/absent.png' });
    await call('PUT', `/meals/${gratin}/image`, { data: dataUrl(Buffer.from('bonjour')) });
    await call('PUT', `/meals/${gratin}/image`, { data: 'data:text/html;base64,AAAA' });
    await call('PUT', `/meals/${gratin}/image`, {});
    await call('PUT', `/meals/${gratin}/image`, {
      data: dataUrl(Buffer.alloc(20 * 1024 * 1024 + 1)),
    });
    const third = await meal('Salade');
    await call('PUT', `/meals/${third}/image`, {
      data: dataUrl(drawn(1600, 1200, false).toBuffer('image/jpeg', 90), 'jpeg'),
    });
    await call('DELETE', `/meals/${third}/image`);
    const state = await call<StateDto>('GET', '/state');
    const shown = state.meals.map((m) => ({
      name: m.name,
      image: m.image
        ? { width: m.image.width, height: m.image.height, url: Boolean(m.image.url) }
        : null,
    }));
    await call('POST', '/export-json');
    const exported = JSON.parse(saved) as { recipes: { name: string; image?: string | null }[] };
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
    expect(backup).toMatch(/avant import/);
    const rows = dumpWasmTables(db, 'courses').courses__meal_images as Record<string, unknown>[];

    const reference = readReference(REFERENCE, undefined) as {
      steps: unknown;
      shown: unknown;
      applied: unknown;
      exportedImages: { name: string; image: string | null; prefix: string | null }[];
      files: string[];
      rows: Record<string, unknown>[];
    };
    // Rows: the same meals, sizes and deletions (bytes and sha256 are the encoder's).
    // The meals are numbered within the rows (the same meal: the same number).
    const sized = (list: Record<string, unknown>[]) => {
      const ids = new Map<unknown, number>();
      return list.map((r) => ({
        meal: ids.get(r.meal_id) ?? ids.set(r.meal_id, ids.size + 1).get(r.meal_id),
        width: r.width,
        height: r.height,
        deleted: 'deleted' in r ? r.deleted : r.deleted_at !== null,
      }));
    };
    const ours = referenceShape({ steps, shown, applied }, 0);
    expect(ours).toEqual({
      steps: reference.steps,
      shown: reference.shown,
      applied: reference.applied,
    });
    expect(sized(rows)).toEqual(sized(reference.rows));
    // The export carries a JPEG for the same recipes (its bytes are the phone's).
    expect(
      exported.recipes.map((r) => ({
        name: r.name,
        prefix: r.image ? r.image.slice(0, 23) : null,
      })),
    ).toEqual(reference.exportedImages.map(({ name, prefix }) => ({ name, prefix })));
    // As many files as on the PC: the live images (replaced and removed ones are gone).
    expect(
      [...files.files.keys()].filter((p) => p.startsWith('/modules/courses/images/')),
    ).toHaveLength(reference.files.length);
  });
});
