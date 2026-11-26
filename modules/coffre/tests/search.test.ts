// v0.47.0 A: the search in the content — the text of every format, a scanned
// PDF (« pas de texte »), accents and case, an archived element searchable
// with the disk unplugged, resumed after a restart, the hub's search (Ctrl+K
// anywhere) with the page, the time on thousands of elements.
import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { extractFile, htmlText, TooBig, unzipBounded } from '../backend/extract';
import { ftsQuery } from '../backend/text-index';
import type { HomeDto, SearchDto, UpdateReport } from '../shared/types';
import {
  API,
  deposit,
  diskWorld,
  ok,
  registerDisk,
  status,
  waitJob,
  type DiskWorld,
  job as runJob,
} from './disk-helpers';
import { makeDocx, makePdf, makePptx, makeXlsx } from './text-fixtures';

const worlds: DiskWorld[] = [];
afterEach(async () => {
  while (worlds.length) await worlds.pop()!.close();
});
async function world(options: Parameters<typeof diskWorld>[0] = {}) {
  const w = await diskWorld(options);
  worlds.push(w);
  return w;
}

/** Waits until every text is read (the health zone's counter). */
async function indexed(w: DiskWorld, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const h = await ok<HomeDto>(w, 'GET', `${API}/home`);
    if (h.health.index.pending === 0 && !h.health.index.running) return h.health.index;
    if (Date.now() > end) throw new Error(`Index pas fini : ${JSON.stringify(h.health.index)}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}
const search = (w: DiskWorld, q: string) =>
  ok<SearchDto>(w, 'GET', `${API}/search?q=${encodeURIComponent(q)}`);
const marked = (s: string) => s.replaceAll('\u0001', '[').replaceAll('\u0002', ']');

describe('extraction du texte', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'coffre-text-'));
  const file = (name: string, content: string | Buffer) => {
    const p = path.join(dir, name);
    writeFileSync(p, content);
    return p;
  };

  it('chaque format : PDF par page, Markdown, texte, HTML sans script, code, docx, pptx, xlsx', async () => {
    const pdf = await extractFile(
      file('cours.pdf', makePdf(['Introduction', 'Électricité et loi de Joule'])),
    );
    expect(pdf.status).toBe('ok');
    expect(pdf.parts).toEqual([
      { part: '1', text: 'Introduction' },
      { part: '2', text: 'Électricité et loi de Joule' },
    ]);
    expect(
      (await extractFile(file('n.md', '# Titre\n\nUne **synthèse**'))).parts[0]!.text,
    ).toContain('synthèse');
    expect(
      (await extractFile(file('n.txt', Buffer.from('caf\xe9 latin', 'latin1')))).parts[0]!.text,
    ).toBe('café latin');
    const html = await extractFile(
      file(
        'p.html',
        '<html><head><style>.x{}</style><script>alert("piège")</script></head><body><p>Bonjour &eacute;l&egrave;ve</p></body></html>',
      ),
    );
    expect(html.parts[0]!.text).toBe('Bonjour élève');
    expect(
      (await extractFile(file('main.py', 'def resistance():\n    return 42'))).parts[0]!.text,
    ).toContain('resistance');
    const docx = await extractFile(
      file('r.docx', makeDocx(['Rapport de stage', 'Conclusion générale'])),
    );
    expect(docx.parts[0]!.text).toBe('Rapport de stage\nConclusion générale');
    const pptx = await extractFile(file('s.pptx', makePptx(['Diapo un', 'Diapo deux'])));
    expect(pptx.parts).toEqual([
      { part: '1', text: 'Diapo un' },
      { part: '2', text: 'Diapo deux' },
    ]);
    const xlsx = await extractFile(file('t.xlsx', makeXlsx(['Budget', 'Loyer'])));
    expect(xlsx.parts[0]!.text).toContain('Budget\nLoyer');
    expect(xlsx.parts[0]!.text).toContain('Cellule écrite à la main');
    expect((await extractFile(file('photo.png', 'png'))).status).toBe('unsupported');
  });

  it('PDF scanné (aucun texte) : « pas de texte », pas d’OCR', async () => {
    const r = await extractFile(file('scan.pdf', makePdf([null, null])));
    expect(r).toEqual({ status: 'notext', parts: [] });
  });

  it('un PDF abîmé : une erreur, jamais une exception', async () => {
    const r = await extractFile(file('casse.pdf', '%PDF-1.4 pas un vrai pdf'));
    expect(r.status).toBe('error');
  });

  it('requête : chaque mot, son début, sans accents ; HTML : commentaires et entités', () => {
    expect(ftsQuery('  Électri  thermo ')).toBe('"electri"* AND "thermo"*');
    expect(ftsQuery('"; DROP')).toBe('"drop"*');
    expect(ftsQuery('  ')).toBeNull();
    expect(htmlText('<!-- caché --><b>A&amp;B</b>&#233;')).toBe('A&B é');
  });
});

describe('recherche dans le contenu', () => {
  it('trouvé à la bonne page, mot surligné, accents et casse ignorés ; groupé par élément', async () => {
    const w = await world();
    const [doc] = await deposit(w, {
      'cours.pdf': makePdf([
        'Introduction',
        'Rappels',
        'La loi de Joule : électricité dissipée',
        'Électricité, suite',
      ]),
    });
    await deposit(w, { 'autre.md': 'Rien à voir ici' }, ['Cours', 'Maths']);
    const state = await indexed(w);
    expect(state).toMatchObject({ total: 2, done: 2, withText: 2, noText: 0 });
    const r = await search(w, 'ELECTRICITE');
    expect(r.results).toHaveLength(1);
    const hit = r.results[0]!;
    expect(hit.item.id).toBe(doc!.id);
    expect(hit.byName).toBe(false);
    expect(hit.partCount).toBe(2);
    expect(hit.hits.map((h) => h.part).sort()).toEqual(['3', '4']);
    expect(marked(hit.hits.find((h) => h.part === '3')!.snippet)).toContain('[électricité]');
    // The reader's occurrences (« page suivante »).
    const m = await ok<{ parts: string[] }>(
      w,
      'GET',
      `${API}/files/${doc!.id}/matches?q=electricite`,
    );
    expect(m.parts.sort()).toEqual(['3', '4']);
    // The name still counts.
    expect((await search(w, 'autre')).results[0]).toMatchObject({ byName: true });
    // In the Recycle Bin: not found.
    await ok(w, 'DELETE', `${API}/files/${doc!.id}`);
    expect((await search(w, 'joule')).results).toHaveLength(0);
  });

  it('un PDF scanné : « pas de texte » dans la santé ; une modification relue', async () => {
    const w = await world();
    await deposit(w, { 'scan.pdf': makePdf([null]) });
    const [note] = await deposit(w, { 'note.md': 'premier jet' });
    expect(await indexed(w)).toMatchObject({ noText: 1, withText: 1 });
    // Modified on the PC (in its folder): read again after the look at the PC's files.
    writeFileSync(
      path.join(w.hub.dataDir, 'coffre', 'Cours', 'Thermo', 'note.md'),
      'version corrigée',
    );
    await ok(w, 'POST', `${API}/search/refresh`, {});
    await indexed(w);
    expect((await search(w, 'corrigee')).results.map((x) => x.item.id)).toEqual([note!.id]);
    expect((await search(w, 'premier')).results).toHaveLength(0);
  });

  it('archivé : toujours cherchable, disque débranché', async () => {
    const w = await world();
    const [doc] = await deposit(w, { 'synthese.pdf': makePdf(['Thermodynamique : entropie']) });
    await indexed(w);
    await registerDisk(w, path.join(w.E, 'S'));
    const { jobId } = await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`);
    const job = await waitJob(w, jobId);
    expect(job.status).toBe('succeeded');
    void (job.result as UpdateReport);
    await runJob(w, 'POST', `${API}/files/archive`, { ids: [doc!.id], confirm: true });
    renameSync(path.join(w.E, 'S'), path.join(w.E, '..', 'ailleurs'));
    expect((await status(w)).connected).toBe(false);
    const r = await search(w, 'entropie');
    expect(r.results.map((x) => x.item.id)).toEqual([doc!.id]);
    expect(r.results[0]!.item.unavailable).toBe(true);
    expect(r.results[0]!.hits[0]!.part).toBe('1');
  });

  it('reprise au redémarrage : ce qui restait est lu au démarrage suivant', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'coffre-resume-'));
    const w1 = await diskWorld({ dataDir });
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i++) files[`n${i}.md`] = `note numéro ${i} mot${i}`;
    await deposit(w1, files);
    // Closed at once: the extraction is interrupted (or not even started).
    await w1.hub.close({ keepData: true } as never);
    const w2 = await world({ dataDir });
    const state = await indexed(w2, 30_000);
    expect(state).toMatchObject({ total: 40, done: 40, withText: 40 });
    expect((await search(w2, 'mot39')).results).toHaveLength(1);
  });

  it('recherche du socle (Ctrl+K) : le Coffre donne l’élément, sa page, la route qui l’ouvre', async () => {
    const w = await world();
    const [doc] = await deposit(w, { 'cours.pdf': makePdf(['Rien', 'Le transistor bipolaire']) });
    await indexed(w);
    const r = await ok<{
      groups: {
        moduleId: string;
        label: string;
        results: { title: string; hint: string; open: string; snippet: string }[];
      }[];
    }>(w, 'GET', '/api/core/search?q=transistor');
    const g = r.groups.find((x) => x.moduleId === 'coffre')!;
    expect(g.label).toBe('Coffre');
    expect(g.results[0]).toMatchObject({
      title: 'cours.pdf',
      hint: 'Cours › Thermo · page 2',
      open: `/m/coffre/voir/${doc!.id}?page=2&q=transistor`,
    });
    expect(marked(g.results[0]!.snippet)).toContain('[transistor]');
    expect((await ok<{ groups: unknown[] }>(w, 'GET', '/api/core/search?q=')).groups).toEqual([]);
  });

  // 3000 elements in the CI's own step (COFFRE_TEST_BIG=1), 400 in the quick suite.
  it('temps mesuré sur plusieurs milliers d’éléments', async () => {
    process.env.TOOLBOX_COFFRE_INDEX_PAUSE_MS = '0';
    const w = await world().finally(() => delete process.env.TOOLBOX_COFFRE_INDEX_PAUSE_MS);
    const words = [
      'résistance',
      'condensateur',
      'bobine',
      'diode',
      'transistor',
      'entropie',
      'enthalpie',
      'pression',
    ];
    const n = process.env.COFFRE_TEST_BIG === '1' ? 3000 : 400;
    for (let start = 0; start < n; start += 500) {
      const batch: Record<string, string> = {};
      for (let i = start; i < Math.min(n, start + 500); i++)
        batch[`doc-${i}.md`] =
          `Document ${i}. ${words[i % words.length]} et ${words[(i * 7) % words.length]}. Paragraphe ${'texte '.repeat(40)} fin${i}.`;
      await deposit(w, batch, ['Cours', `Lot ${start}`]);
    }
    await indexed(w, 240_000);
    const times: number[] = [];
    for (const q of [
      'resistance',
      'condensateur pression',
      `fin${n - 1}`,
      'doc',
      'paragraphe texte',
    ]) {
      const t0 = performance.now();
      const r = await search(w, q);
      times.push(performance.now() - t0);
      expect(r.results.length).toBeGreaterThan(0);
      console.log(
        `[mesure] ${n} éléments, « ${q} » : ${r.results.length} résultats, serveur ${r.ms} ms, aller-retour ${(performance.now() - t0).toFixed(1)} ms`,
      );
    }
    expect(Math.max(...times)).toBeLessThan(1500);
  }, 600_000);
});

describe('v0.47.1 — fichier Office qui gonfle à la décompression', () => {
  it('au-delà du plafond (par partie, en tout, nombre de parties) : « illisible : trop gros », rien d’autre', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'coffre-bomb-'));
    // 120 Mo of the same letter: a few hundred Ko once compressed.
    const huge = new Uint8Array(120 * 1024 * 1024).fill(0x61);
    const bomb = Buffer.from(
      zipSync(
        { 'word/document.xml': huge, '[Content_Types].xml': strToU8('<Types/>') },
        { level: 9 },
      ),
    );
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    const p = path.join(dir, 'piege.docx');
    writeFileSync(p, bomb);
    const r = await extractFile(p);
    expect(r.status).toBe('toobig');
    expect(r.parts).toEqual([]);
    expect(r.error).toMatch(/illisible : trop gros/);
    expect(r.error).toMatch(/dépasse 104857600 octets/);
    // Many small parts, and the total.
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 30; i++) many[`ppt/slides/slide${i + 1}.xml`] = new Uint8Array(1024);
    expect(() =>
      unzipBounded(zipSync(many), () => true, { totalBytes: 1e9, entryBytes: 1e9, entries: 20 }),
    ).toThrow(TooBig);
    expect(() =>
      unzipBounded(zipSync(many), () => true, {
        totalBytes: 10_000,
        entryBytes: 1e9,
        entries: 100,
      }),
    ).toThrow(/plus de 10000 octets en tout/);
    // Within the limits: read as before.
    expect(Object.keys(unzipBounded(zipSync(many), () => true))).toHaveLength(30);
  }, 60_000);
});
