// Recipe pictures over the synchronisation (ADR 0044, v0.33.0): the files
// travel after the data, in both directions, once per fingerprint, by
// pieces; a missing picture never stops the data and arrives at the next
// synchronisation; a received file is written only when its sha256 is the
// row's; a deleted picture keeps its file (restorable).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncServer } from '../../backend/core/sync/server';
import { FILE_CHUNK } from '../../backend/core/sync/files';
import { PhoneSync, syncWorkerCall, type SyncWorkerCall } from '../../packages/phone/sync-client';
import { devices, type Devices } from './harness';
import { nodePinnedHttp } from './pinned-http';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

/** A picture as a data: URL (noise: a JPEG that does not compress to nothing). */
function picture(w: number, h: number, seed: number): string {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  let x = seed;
  for (let i = 0; i < 400; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    g.fillStyle = `rgb(${x % 256}, ${(x >> 8) % 256}, ${(x >> 16) % 256})`;
    g.fillRect((x >> 3) % w, (x >> 5) % h, 20 + (x % 90), 20 + ((x >> 4) % 90));
  }
  return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`;
}

const API = '/api/modules/courses';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('recipe pictures travel with the synchronisation', () => {
  let d: Devices;
  let server: SyncServer | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
    await d?.close();
  });

  const setup = async () => {
    d = await devices();
    server = new SyncServer(d.pc.hub, '0.33.0', () => ['127.0.0.1'], null);
    const calls: string[] = [];
    const worker = <T>(call: SyncWorkerCall) => syncWorkerCall(d.phone, call) as Promise<T>;
    const phone = new PhoneSync(
      worker,
      (request) => {
        calls.push(new URL(request.url).pathname);
        return nodePinnedHttp(request);
      },
      null,
    );
    await server.setEnabled(true, await freePort());
    await phone.pair(server.newPairing().code, 'S21');
    const pcImages = () => path.join(d.pc.dataDir, 'modules', 'courses', 'images');
    const pcFile = (file: string) => path.join(pcImages(), file);
    const phoneFile = (file: string) => d.phoneFiles.read(`/modules/courses/images/${file}`);
    const rows = (device: 'pc' | 'phone') =>
      (d.rows(device, 'courses').meal_images ?? []) as {
        id: string;
        meal_id: string;
        file: string;
        sha256: string;
        deleted_at: string | null;
      }[];
    return { phone, calls, pcFile, pcImages, phoneFile, rows };
  };

  it('both ways, once per fingerprint, in pieces, after the data', async () => {
    const { phone, calls, pcFile, phoneFile, rows } = await setup();
    // On the PC: a recipe with its picture, before the first synchronisation.
    const gratin = (
      await d.onPc<{ id: string }>('POST', `${API}/meals`, {
        name: 'Gratin',
        servings: 2,
        items: [],
      })
    ).id;
    await d.onPc('PUT', `${API}/meals/${gratin}/image`, { data: picture(1600, 1200, 7) });
    const first = await phone.first('replace', async () => {});
    expect(first.files).toEqual({ sent: 0, received: 1, pending: 0 });
    const [pcRow] = rows('pc').filter((r) => !r.deleted_at);
    const bytes = readFileSync(pcFile(pcRow!.file));
    expect(sha(phoneFile(pcRow!.file)!)).toBe(pcRow!.sha256);
    expect(sha(bytes)).toBe(pcRow!.sha256);
    // The phone's screen shows it (a URL for <img>).
    const state = await d.onPhone<{ meals: { name: string; image: { url: string } | null }[] }>(
      'GET',
      `${API}/state`,
    );
    expect(state.meals.find((m) => m.name === 'Gratin')!.image?.url).toBeTruthy();

    // On the phone: a picture taken there, on a new recipe → up to the PC.
    const curry = (
      await d.onPhone<{ id: string }>('POST', `${API}/meals`, {
        name: 'Curry',
        servings: 2,
        items: [],
      })
    ).id;
    await d.onPhone('PUT', `${API}/meals/${curry}/image`, { data: picture(1200, 900, 11) });
    calls.length = 0;
    const second = await phone.now();
    expect(second.files).toEqual({ sent: 1, received: 0, pending: 0 });
    const curryRow = rows('pc').find((r) => r.meal_id === curry && !r.deleted_at)!;
    expect(sha(readFileSync(pcFile(curryRow.file)))).toBe(curryRow.sha256);
    // The data first, then the file.
    expect(calls.indexOf('/sync/exchange')).toBeLessThan(calls.indexOf('/sync/files/put'));
    // Pieces: a picture bigger than one piece needs several calls.
    const size = d.phoneFiles.read(`/modules/courses/images/${curryRow.file}`)!.length;
    expect(calls.filter((c) => c === '/sync/files/put')).toHaveLength(Math.ceil(size / FILE_CHUNK));

    // Nothing new: no file travels again.
    calls.length = 0;
    expect((await phone.now()).files).toEqual({ sent: 0, received: 0, pending: 0 });
    expect(calls.filter((c) => c.startsWith('/sync/files/get') || c === '/sync/files/put')).toEqual(
      [],
    );
  });

  it('the same picture on two recipes travels once', async () => {
    const { phone, calls, rows, phoneFile } = await setup();
    await phone.first('replace', async () => {});
    const same = picture(1000, 800, 3);
    for (const name of ['Salade', 'Salade bis']) {
      const id = (
        await d.onPc<{ id: string }>('POST', `${API}/meals`, {
          name,
          servings: 1,
          items: [],
        })
      ).id;
      await d.onPc('PUT', `${API}/meals/${id}/image`, { data: same });
    }
    calls.length = 0;
    const result = await phone.now();
    expect(result.files).toEqual({ sent: 0, received: 1, pending: 0 });
    const live = rows('phone').filter((r) => !r.deleted_at);
    expect(live).toHaveLength(2);
    expect(new Set(live.map((r) => r.sha256)).size).toBe(1);
    for (const r of live) expect(phoneFile(r.file)).toBeTruthy();
    expect(calls.filter((c) => c === '/sync/files/get')).toHaveLength(1);
  });

  it('a missing picture never stops the data; it arrives at the next synchronisation', async () => {
    const { phone, pcFile, rows, phoneFile } = await setup();
    await phone.first('replace', async () => {});
    const id = (
      await d.onPc<{ id: string }>('POST', `${API}/meals`, {
        name: 'Tarte',
        servings: 4,
        items: [],
      })
    ).id;
    await d.onPc('PUT', `${API}/meals/${id}/image`, { data: picture(900, 900, 5) });
    const row = rows('pc').find((r) => r.meal_id === id && !r.deleted_at)!;
    // The PC's file is out of reach for now (moved away).
    renameSync(pcFile(row.file), `${pcFile(row.file)}.away`);
    await d.onPc('POST', '/api/modules/todo/tasks', { title: 'Avec la tarte' });
    const result = await phone.now();
    expect(result.received).toBeGreaterThan(0);
    // The data arrived (the recipe, its picture's row, the task)…
    expect(rows('phone').some((r) => r.id === row.id)).toBe(true);
    expect(d.rows('phone', 'todo').tasks!.some((t) => t.title === 'Avec la tarte')).toBe(true);
    // …the picture waits.
    expect(result.files).toEqual({ sent: 0, received: 0, pending: 1 });
    expect(phoneFile(row.file)).toBeNull();
    renameSync(`${pcFile(row.file)}.away`, pcFile(row.file));
    expect((await phone.now()).files).toEqual({ sent: 0, received: 1, pending: 0 });
    expect(sha(phoneFile(row.file)!)).toBe(row.sha256);
  });

  it('a damaged file is refused (sha256), a path is never taken from the other device', async () => {
    const { phone, rows } = await setup();
    await phone.first('replace', async () => {});
    const id = (
      await d.onPhone<{ id: string }>('POST', `${API}/meals`, {
        name: 'Soupe',
        servings: 2,
        items: [],
      })
    ).id;
    await d.onPhone('PUT', `${API}/meals/${id}/image`, { data: picture(800, 600, 9) });
    await phone.now();
    const row = rows('pc').find((r) => r.meal_id === id)!;
    // A forged request: another file name, a wrong fingerprint, damaged bytes.
    const files = new (await import('../../backend/core/sync/files')).SyncFiles(d.pcEngine);
    const ref = { scope: 'courses', entity: 'meal_images', id: row.id, sha256: row.sha256 };
    await expect(
      files.receive({ ...ref, sha256: '0'.repeat(64) }, { offset: 0, total: 3, data: 'AAAA' }),
    ).rejects.toThrow(/inconnu ici/);
    await expect(
      files.receive({ ...ref, entity: '../../core' }, { offset: 0, total: 3, data: 'AAAA' }),
    ).rejects.toThrow(/inconnu/);
    await expect(files.receive(ref, { offset: 0, total: 3, data: 'AAAA' })).rejects.toThrow(
      /abîmé/,
    );
  });

  it('a picture replaced or deleted: the row is a tombstone, no file is deleted by a sync', async () => {
    const { phone, pcImages, rows } = await setup();
    await phone.first('replace', async () => {});
    const id = (
      await d.onPc<{ id: string }>('POST', `${API}/meals`, {
        name: 'Pizza',
        servings: 2,
        items: [],
      })
    ).id;
    await d.onPc('PUT', `${API}/meals/${id}/image`, { data: picture(800, 800, 1) });
    await phone.now();
    const old = rows('phone').find((r) => r.meal_id === id)!;
    // Replaced on the phone: a new row, the old one a tombstone.
    await d.onPhone('PUT', `${API}/meals/${id}/image`, { data: picture(800, 800, 2) });
    const result = await phone.now();
    expect(result.files).toEqual({ sent: 1, received: 0, pending: 0 });
    const pcRows = rows('pc').filter((r) => r.meal_id === id);
    expect(pcRows.find((r) => r.id === old.id)!.deleted_at).not.toBeNull();
    expect(pcRows.filter((r) => !r.deleted_at)).toHaveLength(1);
    // The PC's old file is still there (a synchronisation deletes nothing).
    expect(existsSync(path.join(pcImages(), old.file))).toBe(true);
    expect(readdirSync(pcImages()).length).toBe(2);
  });
});
