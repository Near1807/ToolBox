// v0.51.0 A4 (ADR 0068): measures, for the report — one project of 10 000
// files (its exclusions apart) and 50 projects: the indexing (names and
// contents), a look when nothing changed, the search, and the API's answer
// time WHILE it indexes (the interface stays fluid). Run on demand
// (COFFRE_TEST_PERF=1) and by the Windows CI.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HomeDto, SearchDto } from '../shared/types';
import { API, diskWorld, job as runJob, ok, type DiskWorld } from './disk-helpers';

let w: DiskWorld | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
});

const WORDS = ['moteur', 'capteur', 'servo', 'pile', 'graphe', 'routage', 'tension', 'boucle'];
/** A project of `n` code files (and a node_modules beside, excluded). */
function makeProject(root: string, n: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const dir = path.join(root, 'src', `m${Math.floor(i / 100)}`);
    if (i % 100 === 0) mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `f${i}.py`),
      `# module ${i}\nimport os\n\ndef ${WORDS[(i + seed) % WORDS.length]}_${i}():\n    return ${i} * 2  # marqueur${seed}x${i}\n`,
    );
  }
  writeFileSync(path.join(root, 'main.py'), `print("projet ${seed}")\n`);
  mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), 'x');
}
async function indexed(W: DiskWorld) {
  for (;;) {
    const h = await ok<HomeDto>(W, 'GET', `${API}/home`);
    if (h.health.index.pending === 0 && !h.health.index.running) return h.health.index;
    await new Promise((r) => setTimeout(r, 50));
  }
}
/** The API's answer time sampled every 100 ms while `work` runs. */
async function sampled<T>(W: DiskWorld, work: Promise<T>) {
  const times: number[] = [];
  let done = false;
  const probe = (async () => {
    while (!done) {
      const t = performance.now();
      await W.hub.request('GET', '/api/health');
      times.push(performance.now() - t);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const result = await work;
  done = true;
  await probe;
  times.sort((a, b) => a - b);
  return {
    result,
    median: times[Math.floor(times.length / 2)] ?? 0,
    max: times[times.length - 1] ?? 0,
    n: times.length,
  };
}
const ms = (t: number) => `${Math.round(t)} ms`;

describe.runIf(process.env.COFFRE_TEST_PERF === '1')('mesures : fichiers intérieurs', () => {
  it('un projet de 10 000 fichiers, puis 50 projets', { timeout: 900_000 }, async () => {
    process.env.TOOLBOX_COFFRE_INDEX_PAUSE_MS = '0';
    w = await diskWorld();
    const W = w;
    // 1. One project of 10 000 files.
    const big = path.join(W.dl, 'gros');
    makeProject(big, 10_000, 1);
    let t = performance.now();
    const dep = await sampled(
      W,
      runJob(W, 'POST', `${API}/deposit/apply`, {
        entries: [{ path: big, newFolder: ['Perf'], projects: [''], labels: [] }],
      }),
    );
    const deposit = performance.now() - t;
    t = performance.now();
    const text = await sampled(W, indexed(W));
    const reading = performance.now() - t;
    t = performance.now();
    await ok(W, 'POST', `${API}/search/refresh`);
    const look = performance.now() - t;
    const s1 = await ok<SearchDto>(W, 'GET', `${API}/search?q=f9999.py`);
    const s2 = await ok<SearchDto>(W, 'GET', `${API}/search?q=marqueur1x4242`);
    const s3 = await ok<SearchDto>(W, 'GET', `${API}/search?q=servo`);
    expect(s1.results[0]?.inner?.rel).toBe('src/m99/f9999.py');
    expect(s2.results[0]?.inner).toMatchObject({ rel: 'src/m42/f4242.py', line: 5 });
    console.log(
      `[mesure] 10 000 fichiers : rangement + index des noms ${ms(deposit)} (API pendant : médiane ${ms(dep.median)}, max ${ms(dep.max)}, ${dep.n} mesures) ; lecture des textes ${ms(reading)} (API pendant : médiane ${ms(text.median)}, max ${ms(text.max)}) ; regard sans changement ${ms(look)} ; recherche par nom ${s1.ms} ms, par contenu ${s2.ms} ms, « servo » (${s3.results.length} résultats) ${s3.ms} ms`,
    );
    // 2. 50 projects of 200 files.
    const many = path.join(W.dl, 'cinquante');
    for (let p = 0; p < 50; p++) makeProject(path.join(many, `projet${p}`), 200, p + 10);
    t = performance.now();
    const dep2 = await sampled(
      W,
      runJob(W, 'POST', `${API}/deposit/apply`, {
        entries: [
          {
            path: many,
            newFolder: ['Perf'],
            projects: Array.from({ length: 50 }, (_, p) => `projet${p}`),
            labels: [],
          },
        ],
      }),
    );
    const deposit2 = performance.now() - t;
    t = performance.now();
    const text2 = await sampled(W, indexed(W));
    const reading2 = performance.now() - t;
    t = performance.now();
    await ok(W, 'POST', `${API}/search/refresh`);
    const look2 = performance.now() - t;
    const s4 = await ok<SearchDto>(W, 'GET', `${API}/search?q=main.py`);
    const s5 = await ok<SearchDto>(W, 'GET', `${API}/search?q=marqueur33x7`);
    expect(s5.results[0]?.inner?.rel).toBe('src/m0/f7.py');
    console.log(
      `[mesure] 50 projets (10 000 fichiers) : rangement ${ms(deposit2)} (API : médiane ${ms(dep2.median)}, max ${ms(dep2.max)}) ; lecture des textes ${ms(reading2)} (API : médiane ${ms(text2.median)}, max ${ms(text2.max)}) ; regard sans changement de 51 projets (20 000 fichiers) ${ms(look2)} ; recherche « main.py » (${s4.results.length}) ${s4.ms} ms, contenu ${s5.ms} ms`,
    );
  });
});
