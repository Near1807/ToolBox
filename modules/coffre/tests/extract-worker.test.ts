// v0.47.1: the texts are read OUT of the server's thread — a worker thread,
// a maximum time per file (« illisible : trop long », read again at the next
// start), a new worker when one crashed. Measured: the API answers while a
// 300-page PDF is read.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractFile } from '../backend/extract';
import { ExtractPool } from '../backend/extract-pool';
import type { HomeDto } from '../shared/types';
import { API, deposit, diskWorld, ok, type DiskWorld } from './disk-helpers';
import { makeDocx, makePdf } from './text-fixtures';

const dir = mkdtempSync(path.join(tmpdir(), 'coffre-worker-'));
/** A PDF of `n` pages of text. */
function bigPdf(n: number): string {
  const pages = Array.from({ length: n }, (_, i) =>
    Array.from(
      { length: 40 },
      (__, l) => `Page ${i + 1} ligne ${l + 1} : thermodynamique appliquée`,
    ).join('\n'),
  );
  const p = path.join(dir, `gros-${n}.pdf`);
  writeFileSync(p, makePdf(pages));
  return p;
}

let w: DiskWorld | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
  delete process.env.TOOLBOX_COFFRE_EXTRACT_MAX_MS;
});

describe('lecture des textes dans un worker', () => {
  it('le même résultat que dans le fil principal', async () => {
    const pool = new ExtractPool();
    const p = bigPdf(3);
    expect(await pool.run('file', p, 'pdf')).toEqual(await extractFile(p));
    await pool.stop();
  });

  it('trop long : « illisible : trop long », le worker est remplacé pour le fichier suivant', async () => {
    const pool = new ExtractPool(30);
    const r = await pool.run('file', bigPdf(300), 'pdf');
    expect(r).toMatchObject({ status: 'toolong', parts: [] });
    expect(r.error).toMatch(/illisible : trop long/);
    const small = path.join(dir, 'petit.txt');
    writeFileSync(small, 'encore lisible');
    const pool2 = pool;
    // A generous time for the next one, on a new worker.
    (pool2 as unknown as { maxMs: number }).maxMs = 30_000;
    expect(await pool2.run('file', small, 'txt')).toMatchObject({ status: 'ok' });
    expect(pool2.started).toBe(2);
    await pool2.stop();
  }, 60_000);

  it('un worker qui s’arrête : « illisible », puis un nouveau worker', async () => {
    const pool = new ExtractPool();
    const p = bigPdf(200);
    const running = pool.run('file', p, 'pdf');
    // The worker dies in the middle (as it would on a crash).
    await new Promise((r) => setTimeout(r, 50));
    await (pool as unknown as { worker: { terminate(): Promise<number> } }).worker.terminate();
    const r = await running;
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/le lecteur s’est arrêté/);
    expect((await pool.run('file', bigPdf(2), 'pdf')).status).toBe('ok');
    expect(pool.started).toBe(2);
    await pool.stop();
  }, 60_000);

  it('dans le Coffre : trop long → compté illisible, relu au démarrage suivant', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'coffre-toolong-'));
    process.env.TOOLBOX_COFFRE_EXTRACT_MAX_MS = '20';
    w = await diskWorld({ dataDir });
    const pdf = makePdf(Array.from({ length: 300 }, (_, i) => `Page ${i + 1} : entropie`));
    await deposit(w, { 'long.pdf': pdf });
    const end = Date.now() + 30_000;
    let h: HomeDto;
    for (;;) {
      h = await ok<HomeDto>(w, 'GET', `${API}/home`);
      if (h.health.index.pending === 0 && !h.health.index.running) break;
      if (Date.now() > end) throw new Error('pas fini');
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(h.health.index).toMatchObject({ done: 1, errors: 1, withText: 0 });
    await w.close();
    // Next start, with the usual time: read again, found.
    delete process.env.TOOLBOX_COFFRE_EXTRACT_MAX_MS;
    w = await diskWorld({ dataDir });
    for (;;) {
      h = await ok<HomeDto>(w, 'GET', `${API}/home`);
      if (h.health.index.withText === 1) break;
      if (Date.now() > end + 30_000) throw new Error('pas relu');
      await new Promise((r) => setTimeout(r, 50));
    }
    const found = await ok<{ results: unknown[] }>(w, 'GET', `${API}/search?q=entropie`);
    expect(found.results).toHaveLength(1);
  }, 90_000);

  it('mesure : l’API répond pendant la lecture d’un PDF de 300 pages', async () => {
    w = await diskWorld();
    const p = bigPdf(300);
    const ping = async () => {
      const t0 = performance.now();
      const r = await w!.hub.request('GET', '/api/health');
      expect(r.status).toBe(200);
      return performance.now() - t0;
    };
    /** Pings every 10 ms while `during` runs: response times, and the longest wait without any answer. */
    const sample = async (during: () => Promise<unknown>) => {
      const times: number[] = [];
      let done = false;
      let last = performance.now();
      let gap = 0;
      const job = during().finally(() => (done = true));
      while (!done) {
        times.push(await ping());
        const now = performance.now();
        gap = Math.max(gap, now - last);
        last = now;
        await new Promise((r) => setTimeout(r, 10));
      }
      await job;
      gap = Math.max(gap, performance.now() - last);
      return Object.assign(
        times.sort((a, b) => a - b),
        { gap },
      );
    };
    const stats = (t: number[] & { gap?: number }) => ({
      n: t.length,
      median: Math.round(t[Math.floor(t.length / 2)]! * 10) / 10,
      max: Math.round(t[t.length - 1]! * 10) / 10,
      ...(t.gap !== undefined ? { sansReponseMax: Math.round(t.gap) } : {}),
    });
    const idle: number[] = [];
    for (let i = 0; i < 30; i++) idle.push(await ping());
    idle.sort((a, b) => a - b);
    const pool = new ExtractPool();
    const t0 = performance.now();
    const inWorker = await sample(() => pool.run('file', p, 'pdf'));
    const workerMs = Math.round(performance.now() - t0);
    await pool.stop();
    // For comparison: the same reading in the server's own thread (as in v0.47.0).
    const inThread = await sample(() => extractFile(p));
    console.log(
      `[mesure] /api/health — au repos ${JSON.stringify(stats(idle))} ; PDF 300 pages dans le worker (${workerMs} ms) ${JSON.stringify(stats(inWorker))} ; dans le fil du serveur (v0.47.0) ${JSON.stringify(stats(inThread))}`,
    );
    expect(stats(inWorker).max).toBeLessThan(250);
    expect(inWorker.length).toBeGreaterThan(5);
    // A large Word document (read in one go, no pause possible inside): the difference shows.
    const docx = path.join(dir, 'gros.docx');
    writeFileSync(
      docx,
      makeDocx(
        Array.from(
          { length: 150_000 },
          (_, i) => `Paragraphe ${i} : enthalpie et entropie du système`,
        ),
      ),
    );
    const pool2 = new ExtractPool();
    const docxWorker = await sample(() => pool2.run('file', docx, 'docx'));
    await pool2.stop();
    const docxThread = await sample(() => extractFile(docx));
    console.log(
      `[mesure] /api/health — .docx de 150 000 paragraphes : dans le worker ${JSON.stringify(stats(docxWorker))} ; dans le fil du serveur (v0.47.0) ${JSON.stringify(stats(docxThread))}`,
    );
    expect(stats(docxWorker).max).toBeLessThan(250);
    expect(docxWorker.gap).toBeLessThan(250);
  }, 120_000);
});
