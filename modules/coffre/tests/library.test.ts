// v0.45.0: the Coffre's data and its folder (docs/coffre/CAHIER-DES-CHARGES.md):
// names valid on Windows, copies that never touch the original, duplicates,
// projects and links, a context change that moves the file (back on failure),
// the Recycle Bin, the provenance, Thomas's choices never replaced.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStore } from '@hub/sdk/core';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { deduce, mergeGuesses } from '../shared/deduce';
import { freeName, safeName, splitExtension } from '../shared/names';
import type { ItemDto, ProposalDto } from '../shared/types';

const API = '/api/modules/coffre';
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('names valid on Windows', () => {
  it('forbidden characters, reserved names, trailing dots, length, collisions', () => {
    expect(safeName('a<b>c:d"e/f\\g|h?i*j.pdf')).toBe('a_b_c_d_e_f_g_h_i_j.pdf');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('nul.txt')).toBe('_nul.txt');
    expect(safeName('COM1.log')).toBe('_COM1.log');
    expect(safeName('rapport. . ')).toBe('rapport');
    expect(safeName('   ')).toBe('Sans nom');
    expect(safeName(`${'x'.repeat(300)}.pdf`)).toHaveLength(100);
    expect(safeName(`${'x'.repeat(300)}.pdf`).endsWith('.pdf')).toBe(true);
    expect(splitExtension('archive.tar.gz')).toEqual({ base: 'archive', ext: '.tar.gz' });
    const taken = new Set(['rapport.pdf', 'rapport (2).pdf']);
    expect(freeName('Rapport.pdf', (n) => taken.has(n.toLowerCase()))).toBe('Rapport (3).pdf');
  });
});

describe('the deductions (pure)', () => {
  const contexts = [
    { id: 'c1', path: ['Cours'] },
    { id: 'c2', path: ['Cours', 'Thermo'] },
  ];
  it('extension, Mark of the Web, a context in the name, a course of the Agenda, the year', () => {
    const r = deduce({
      name: 'TP3_thermo.py',
      isDirectory: false,
      fileDate: '2026-11-20T10:00:00.000Z',
      provenance: { zone: 3, hostUrl: 'https://moodle.ecam.be/x/TP3.py', referrerUrl: null },
      contexts,
      courses: [],
      sites: [],
    });
    const byKey = Object.fromEntries(r.attributes.map((a) => [a.key, a]));
    expect(byKey.language).toMatchObject({
      value: 'Python',
      origin: 'guessed',
      reason: 'extension .py',
    });
    expect(byKey.nature?.value).toBe('code');
    expect(byKey.origin?.value).toBe('téléchargé');
    expect(byKey.site?.value).toBe('moodle.ecam.be');
    expect(byKey.year?.value).toBe('2026');
    expect(r.context).toMatchObject({ kind: 'existing', id: 'c2' });
    // A course of the Agenda (no such context yet: a new one, under « Cours »), its teacher.
    const c = deduce({
      name: 'Reseaux locaux - chap 2.pdf',
      isDirectory: false,
      fileDate: null,
      provenance: null,
      contexts,
      courses: [{ name: 'Réseaux locaux', code: 'RE4L', teachers: ['LMT'], next: null }],
      sites: [],
    });
    expect(c.context).toMatchObject({ kind: 'new', path: ['Cours', 'Réseaux locaux'] });
    expect(c.attributes.find((a) => a.key === 'prof')?.value).toBe('LMT');
    // The same site as an element already put away: its context.
    const s = deduce({
      name: 'scan.pdf',
      isDirectory: false,
      fileDate: null,
      provenance: { zone: 3, hostUrl: null, referrerUrl: 'https://www.moodle.ecam.be/course/7' },
      contexts,
      courses: [],
      sites: [{ host: 'moodle.ecam.be', contextId: 'c2' }],
    });
    expect(s.context).toMatchObject({ kind: 'existing', id: 'c2' });
    // No clue: nothing proposed (never at random).
    const n = deduce({
      name: 'IMG_2041.heic',
      isDirectory: false,
      fileDate: null,
      provenance: null,
      contexts,
      courses: [],
      sites: [],
    });
    expect(n.context).toBeNull();
  });
  it('a value Thomas chose is never replaced by a guess', () => {
    const merged = mergeGuesses(
      [{ key: 'language', value: 'CSS', origin: 'chosen', reason: null }],
      [
        { key: 'language', value: 'Python', origin: 'guessed', reason: 'extension .py' },
        { key: 'nature', value: 'code', origin: 'guessed', reason: 'extension .py' },
      ],
    );
    expect(merged.find((a) => a.key === 'language')).toMatchObject({
      value: 'CSS',
      origin: 'chosen',
    });
    expect(merged.find((a) => a.key === 'nature')?.value).toBe('code');
  });
});

describe('the Coffre through its routes', () => {
  let hub: TestHub;
  let dir: string;
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status !== 200)
      throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  /** v0.49.0: a route that starts a task: its result once it ended. */
  const callJob = async <T>(url: string, body?: unknown): Promise<T> => {
    const { jobId } = await call<{ jobId: string }>('POST', url, body);
    for (let i = 0; i < 1500; i++) {
      type Job = { id: string; status: string; result: unknown; error: string | null };
      const jobs = (await hub.request<Job[]>('GET', '/api/core/jobs?module=coffre')).body;
      const j = jobs.find((x) => x.id === jobId);
      if (j && j.status === 'succeeded') return j.result as T;
      if (j && !['queued', 'running'].includes(j.status))
        throw new Error(`${url}: ${j.status} ${j.error}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${url}: pas fini`);
  };
  const analyzeCall = async (body: unknown) =>
    (await callJob<{ proposals: ProposalDto[] }>('/deposit/analyze', body)).proposals;
  const library = () => path.join(hub.dataDir, 'coffre');
  beforeEach(async () => {
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    dir = mkdtempSync(path.join(tmpdir(), 'coffre-originals-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await hub?.close();
  });
  const file = (name: string, content: string) => {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
    return p;
  };
  const apply = (entries: unknown[]) =>
    callJob<{ created: ItemDto[]; skipped: { path: string }[]; undoId: string | null }>(
      '/deposit/apply',
      { entries },
    );

  it('a file: copied into its context, the original untouched; a duplicate said; Annuler', async () => {
    const original = file('thermo chap1.pdf', '%PDF-1.4 thermo');
    const before = sha(original);
    const thermo = await call<{ id: string }>('POST', '/contexts', { name: 'Cours' });
    const sub = await call<{ id: string; path: string[] }>('POST', '/contexts', {
      name: 'Thermo',
      parentId: thermo.id,
    });
    expect(sub.path).toEqual(['Cours', 'Thermo']);
    const [proposal] = await analyzeCall({ paths: [original] });
    expect(proposal!.context).toMatchObject({ kind: 'existing', id: sub.id });
    expect(proposal!.duplicate).toBeNull();
    const done = await apply([
      { path: original, as: 'file', contextId: sub.id, attributes: proposal!.attributes },
    ]);
    const item = done.created[0]!;
    expect(item.contextPath).toEqual(['Cours', 'Thermo']);
    expect(existsSync(path.join(library(), 'Cours', 'Thermo', 'thermo chap1.pdf'))).toBe(true);
    // The original is still there, unchanged.
    expect(existsSync(original)).toBe(true);
    expect(sha(original)).toBe(before);
    expect(item.sha256).toBe(before);
    // The same content again: said, not copied (unless kept anyway: a free name).
    const [again] = await analyzeCall({ paths: [original] });
    expect(again!.duplicate).toMatchObject({ id: item.id, contextPath: ['Cours', 'Thermo'] });
    const skipped = await apply([{ path: original, as: 'file', contextId: sub.id }]);
    expect(skipped.created).toHaveLength(0);
    expect(skipped.skipped).toHaveLength(1);
    const kept = await apply([
      { path: original, as: 'file', contextId: sub.id, keepDuplicate: true },
    ]);
    expect(kept.created[0]!.name).toBe('thermo chap1 (2).pdf');
    // Annuler: the copy and its sheet are gone; the original stays.
    await call('POST', '/undo', { undoId: kept.undoId });
    expect(existsSync(path.join(library(), 'Cours', 'Thermo', 'thermo chap1 (2).pdf'))).toBe(false);
    expect(existsSync(original)).toBe(true);
  });

  it('« Ranger plus tard »: in Arrivée; a project (the whole folder); a link left in its place', async () => {
    const later = file('notes.md', '# notes');
    const arrived = await apply([{ path: later, as: 'file', arrival: true }]);
    expect(arrived.created[0]).toMatchObject({ arrival: true, contextId: null });
    expect(existsSync(path.join(library(), '_Arrivée', 'notes.md'))).toBe(true);
    const home = await call<{ arrivalCount: number }>('GET', '/home');
    expect(home.arrivalCount).toBe(1);
    // A project.
    file('projet/src/main.rs', 'fn main() {}');
    file('projet/Cargo.toml', '[package]');
    const [proposal] = await analyzeCall({
      paths: [path.join(dir, 'projet')],
    });
    expect(proposal).toMatchObject({ isDirectory: true, fileCount: 2 });
    expect(proposal!.attributes.find((a) => a.key === 'language')?.value).toBe('Rust');
    const project = await apply([
      { path: path.join(dir, 'projet'), as: 'project', newContext: ['Programmation', 'Rust'] },
    ]);
    expect(project.created[0]).toMatchObject({
      kind: 'project',
      contextPath: ['Programmation', 'Rust'],
    });
    expect(
      existsSync(path.join(library(), 'Programmation', 'Rust', 'projet', 'src', 'main.rs')),
    ).toBe(true);
    // « Les fichiers un par un »: one proposal per file.
    const each = await analyzeCall({
      paths: [path.join(dir, 'projet')],
      expand: true,
    });
    expect(each.map((p) => p.name).sort()).toEqual(['Cargo.toml', 'main.rs']);
    // A link: nothing copied, marked as such.
    const flp = file('morceau.flp', 'FLhd');
    const link = await apply([{ path: flp, as: 'link', arrival: true }]);
    expect(link.created[0]).toMatchObject({ kind: 'link', externalPath: flp });
    expect(existsSync(path.join(library(), '_Arrivée', 'morceau.flp'))).toBe(false);
  });

  it('a context change moves the file; when the sheet cannot be written, the file comes back', async () => {
    const a = await call<{ id: string }>('POST', '/contexts', { name: 'Perso' });
    const b = await call<{ id: string }>('POST', '/contexts', { name: 'Scouts' });
    const done = await apply([
      { path: file('contrat.pdf', '%PDF contrat'), as: 'file', contextId: a.id },
    ]);
    const id = done.created[0]!.id;
    const moved = await call<{ item: ItemDto; undoId: string }>('PATCH', `/items/${id}`, {
      contextId: b.id,
    });
    expect(moved.item.contextPath).toEqual(['Scouts']);
    expect(existsSync(path.join(library(), 'Scouts', 'contrat.pdf'))).toBe(true);
    expect(existsSync(path.join(library(), 'Perso', 'contrat.pdf'))).toBe(false);
    // Annuler: back in « Perso ».
    await call('POST', '/undo', { undoId: moved.undoId });
    expect(existsSync(path.join(library(), 'Perso', 'contrat.pdf'))).toBe(true);
    // The sheet fails to be written: the file goes back where it was.
    const real = SyncStore.prototype.update;
    const spy = vi.spyOn(SyncStore.prototype, 'update').mockImplementation(function (
      this: SyncStore,
      table,
      rowId,
      fields,
    ) {
      if (table === 'items' && 'context_id' in fields) throw new Error('disque plein (simulé)');
      return real.call(this, table, rowId, fields);
    });
    const r = await hub.request('PATCH', `${API}/items/${id}`, { contextId: b.id });
    expect(r.status).toBe(500);
    spy.mockRestore();
    expect(existsSync(path.join(library(), 'Perso', 'contrat.pdf'))).toBe(true);
    expect(existsSync(path.join(library(), 'Scouts', 'contrat.pdf'))).toBe(false);
    expect((await call<ItemDto>('GET', `/items/${id}`)).contextPath).toEqual(['Perso']);
    // A rename: valid on Windows, never replacing another file.
    const renamed = await call<{ item: ItemDto }>('PATCH', `/items/${id}`, {
      name: 'contrat: bail?.pdf',
    });
    expect(renamed.item.name).toBe('contrat_ bail_.pdf');
  });

  it('a context renamed: its folder follows, with its elements', async () => {
    const c = await call<{ id: string }>('POST', '/contexts', { name: 'Admin' });
    await apply([{ path: file('bail.pdf', '%PDF bail'), as: 'file', contextId: c.id }]);
    await call('PATCH', `/contexts/${c.id}`, { name: 'Administratif' });
    expect(existsSync(path.join(library(), 'Administratif', 'bail.pdf'))).toBe(true);
    const list = await call<ItemDto[]>('GET', `/items?context=${c.id}`);
    expect(list[0]!.path).toBe(path.join(library(), 'Administratif', 'bail.pdf'));
  });

  it('the Recycle Bin: deleted → Annuler; erased only from the bin and when confirmed', async () => {
    const done = await apply([{ path: file('vieux.txt', 'vieux'), as: 'file', arrival: true }]);
    const id = done.created[0]!.id;
    const del = await call<{ undoId: string }>('DELETE', `/items/${id}`);
    expect(existsSync(path.join(library(), '_Arrivée', 'vieux.txt'))).toBe(false);
    expect(existsSync(path.join(library(), '_Corbeille', id, 'vieux.txt'))).toBe(true);
    expect((await call<ItemDto[]>('GET', '/items?trash=1')).map((i) => i.id)).toEqual([id]);
    await call('POST', '/undo', { undoId: del.undoId });
    expect(existsSync(path.join(library(), '_Arrivée', 'vieux.txt'))).toBe(true);
    // Erase: not outside the bin, not without the confirmation.
    expect((await hub.request('POST', `${API}/items/${id}/erase`, { confirm: true })).status).toBe(
      409,
    );
    await call('DELETE', `/items/${id}`);
    expect((await hub.request('POST', `${API}/items/${id}/erase`, {})).status).toBe(400);
    await call('POST', `/items/${id}/erase`, { confirm: true });
    expect(existsSync(path.join(library(), '_Corbeille', id))).toBe(false);
    expect((await hub.request('GET', `${API}/items/${id}`)).status).toBe(404);
  });

  it('Mark of the Web read on the original; Thomas’s choice never replaced by a new guess', async () => {
    const pdf = file('cours.py', 'print(1)');
    // NTFS: the file's « :Zone.Identifier » stream (elsewhere: a file of that name, read the same way).
    writeFileSync(
      `${pdf}:Zone.Identifier`,
      '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://moodle.ecam.be/course/view.php?id=7\r\nHostUrl=https://moodle.ecam.be/pluginfile.php/cours.py\r\n',
    );
    const [p] = await analyzeCall({ paths: [pdf] });
    expect(p!.attributes.find((a) => a.key === 'origin')?.value).toBe('téléchargé');
    expect(p!.attributes.find((a) => a.key === 'site')?.value).toBe('moodle.ecam.be');
    const done = await apply([{ path: pdf, as: 'file', arrival: true, attributes: p!.attributes }]);
    const id = done.created[0]!.id;
    await call('PUT', `/items/${id}/attributes`, { key: 'language', values: ['CSS'] });
    const again = await call<ItemDto>('POST', `/items/${id}/guess`);
    expect(again.attributes.find((a) => a.key === 'language')).toMatchObject({
      value: 'CSS',
      origin: 'chosen',
    });
  });

  it('opening: a program is never run without the confirmation', async () => {
    const opened: string[] = [];
    await hub.close();
    const { createTestHost } = await import('@hub/sdk/testing');
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
      host: { ...createTestHost(), openPath: async (p: string) => void opened.push(p) },
    });
    const done = await apply([{ path: file('setup.exe', 'MZ'), as: 'file', arrival: true }]);
    const id = done.created[0]!.id;
    const refused = await hub.request('POST', `${API}/items/${id}/open`, { how: 'app' });
    expect(refused.status).toBe(409);
    expect(opened).toEqual([]);
    await call('POST', `/items/${id}/open`, { how: 'app', runnable: true });
    expect(opened).toHaveLength(1);
  });
});
