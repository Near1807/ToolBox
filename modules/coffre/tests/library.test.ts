// v0.45.0: the Coffre's data and its folder (docs/coffre/CAHIER-DES-CHARGES.md):
// names valid on Windows, copies that never touch the original, duplicates,
// projects and links, a folder change that moves the file (back on failure),
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
  const folders = [
    { id: 'c1', path: ['Cours'] },
    { id: 'c2', path: ['Cours', 'Thermo'] },
  ];
  it('extension, Mark of the Web, a folder in the name, a course of the Agenda, the year', () => {
    const r = deduce({
      name: 'TP3_thermo.py',
      isDirectory: false,
      fileDate: '2026-11-20T10:00:00.000Z',
      provenance: { zone: 3, hostUrl: 'https://moodle.ecam.be/x/TP3.py', referrerUrl: null },
      folders,
      courses: [],
      sites: [],
    });
    const byKey = Object.fromEntries(r.labels.map((a) => [a.family, a]));
    expect(byKey.language).toMatchObject({
      value: 'Python',
      origin: 'guessed',
      reason: 'extension .py',
    });
    expect(byKey.nature?.value).toBe('code');
    expect(byKey.origin?.value).toBe('téléchargé');
    expect(byKey.site?.value).toBe('moodle.ecam.be');
    expect(byKey.year?.value).toBe('2026');
    expect(r.route).toMatchObject({ kind: 'existing', id: 'c2' });
    // A course of the Agenda (no such folder yet: a new one, under « Cours »), its teacher.
    const c = deduce({
      name: 'Reseaux locaux - chap 2.pdf',
      isDirectory: false,
      fileDate: null,
      provenance: null,
      folders,
      courses: [{ name: 'Réseaux locaux', code: 'RE4L', teachers: ['LMT'], next: null }],
      sites: [],
    });
    expect(c.route).toMatchObject({ kind: 'new', path: ['Cours', 'Réseaux locaux'] });
    expect(c.labels.find((a) => a.family === 'prof')?.value).toBe('LMT');
    // The same site as an element already put away: its folder.
    const s = deduce({
      name: 'scan.pdf',
      isDirectory: false,
      fileDate: null,
      provenance: { zone: 3, hostUrl: null, referrerUrl: 'https://www.moodle.ecam.be/course/7' },
      folders,
      courses: [],
      sites: [{ host: 'moodle.ecam.be', folderId: 'c2' }],
    });
    expect(s.route).toMatchObject({ kind: 'existing', id: 'c2' });
    // No clue: nothing proposed (never at random).
    const n = deduce({
      name: 'IMG_2041.heic',
      isDirectory: false,
      fileDate: null,
      provenance: null,
      folders,
      courses: [],
      sites: [],
    });
    expect(n.route).toBeNull();
  });
  it('a value Thomas chose is never replaced by a guess', () => {
    const merged = mergeGuesses(
      [{ family: 'language', value: 'CSS', origin: 'chosen', reason: null }],
      [
        { family: 'language', value: 'Python', origin: 'guessed', reason: 'extension .py' },
        { family: 'nature', value: 'code', origin: 'guessed', reason: 'extension .py' },
      ],
    );
    expect(merged.find((a) => a.family === 'language')).toMatchObject({
      value: 'CSS',
      origin: 'chosen',
    });
    expect(merged.find((a) => a.family === 'nature')?.value).toBe('code');
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

  it('a file: copied into its folder, the original untouched; a duplicate said; Annuler', async () => {
    const original = file('thermo chap1.pdf', '%PDF-1.4 thermo');
    const before = sha(original);
    const thermo = await call<{ id: string }>('POST', '/folders', { name: 'Cours' });
    const sub = await call<{ id: string; path: string[] }>('POST', '/folders', {
      name: 'Thermo',
      parentId: thermo.id,
    });
    expect(sub.path).toEqual(['Cours', 'Thermo']);
    const [proposal] = await analyzeCall({ paths: [original] });
    expect(proposal!.route).toMatchObject({ kind: 'existing', id: sub.id });
    expect(proposal!.duplicate).toBeNull();
    const done = await apply([{ path: original, folderId: sub.id, labels: proposal!.labels }]);
    const item = done.created[0]!;
    expect(item.folderPath).toEqual(['Cours', 'Thermo']);
    expect(existsSync(path.join(library(), 'Cours', 'Thermo', 'thermo chap1.pdf'))).toBe(true);
    // The original is still there, unchanged.
    expect(existsSync(original)).toBe(true);
    expect(sha(original)).toBe(before);
    expect(item.sha256).toBe(before);
    // The same content again: said, not copied (unless kept anyway: a free name).
    const [again] = await analyzeCall({ paths: [original] });
    expect(again!.duplicate).toMatchObject({ id: item.id, folderPath: ['Cours', 'Thermo'] });
    const skipped = await apply([{ path: original, folderId: sub.id }]);
    expect(skipped.created).toHaveLength(0);
    expect(skipped.skipped).toHaveLength(1);
    const kept = await apply([{ path: original, folderId: sub.id, keepDuplicate: true }]);
    expect(kept.created[0]!.name).toBe('thermo chap1 (2).pdf');
    // Annuler: the copy and its sheet are gone; the original stays.
    await call('POST', '/undo', { undoId: kept.undoId });
    expect(existsSync(path.join(library(), 'Cours', 'Thermo', 'thermo chap1 (2).pdf'))).toBe(false);
    expect(existsSync(original)).toBe(true);
  });

  it('« Ranger plus tard »: in À ranger; a folder marked « Projet »: one entry (the whole folder)', async () => {
    const later = file('notes.md', '# notes');
    const arrived = await apply([{ path: later, later: true }]);
    expect(arrived.created[0]).toMatchObject({ folderId: null, folderPath: null });
    expect(existsSync(path.join(library(), '_À ranger', 'notes.md'))).toBe(true);
    const home = await call<{ pendingCount: number }>('GET', '/home');
    expect(home.pendingCount).toBe(1);
    // A folder dropped: « Projet » proposed with its reason.
    file('projet/src/main.rs', 'fn main() {}');
    file('projet/Cargo.toml', '[package]');
    const [proposal] = await analyzeCall({ paths: [path.join(dir, 'projet')] });
    expect(proposal).toMatchObject({ isDirectory: true, fileCount: 2, folderCount: 1 });
    expect(proposal!.projects).toEqual([{ rel: '', reason: 'Cargo.toml', nested: false }]);
    const project = await apply([
      { path: path.join(dir, 'projet'), newFolder: ['Programmation', 'Rust'], projects: [''] },
    ]);
    expect(project.created[0]).toMatchObject({
      kind: 'project',
      folderPath: ['Programmation', 'Rust', 'projet'],
    });
    expect(
      existsSync(path.join(library(), 'Programmation', 'Rust', 'projet', 'src', 'main.rs')),
    ).toBe(true);
    // A folder never cut up: a folder in À ranger is refused (it goes to a route).
    const refused = await hub.request('POST', `${API}/deposit/apply`, {
      entries: [{ path: path.join(dir, 'projet'), later: true }],
    });
    expect(refused.status).toBe(400);
  });

  it('a folder change moves the file; when the sheet cannot be written, the file comes back', async () => {
    const a = await call<{ id: string }>('POST', '/folders', { name: 'Perso' });
    const b = await call<{ id: string }>('POST', '/folders', { name: 'Scouts' });
    const done = await apply([{ path: file('contrat.pdf', '%PDF contrat'), folderId: a.id }]);
    const id = done.created[0]!.id;
    const moved = await call<{ item: ItemDto; undoId: string }>('PATCH', `/files/${id}`, {
      folderId: b.id,
    });
    expect(moved.item.folderPath).toEqual(['Scouts']);
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
      if (table === 'items' && 'folder_id' in fields) throw new Error('disque plein (simulé)');
      return real.call(this, table, rowId, fields);
    });
    const r = await hub.request('PATCH', `${API}/files/${id}`, { folderId: b.id });
    expect(r.status).toBe(500);
    spy.mockRestore();
    expect(existsSync(path.join(library(), 'Perso', 'contrat.pdf'))).toBe(true);
    expect(existsSync(path.join(library(), 'Scouts', 'contrat.pdf'))).toBe(false);
    expect((await call<ItemDto>('GET', `/files/${id}`)).folderPath).toEqual(['Perso']);
    // A rename: valid on Windows, never replacing another file.
    const renamed = await call<{ item: ItemDto }>('PATCH', `/files/${id}`, {
      name: 'contrat: bail?.pdf',
    });
    expect(renamed.item.name).toBe('contrat_ bail_.pdf');
  });

  it('a folder renamed: its folder follows, with its elements', async () => {
    const c = await call<{ id: string }>('POST', '/folders', { name: 'Admin' });
    await apply([{ path: file('bail.pdf', '%PDF bail'), folderId: c.id }]);
    await call('PATCH', `/folders/${c.id}`, { name: 'Administratif' });
    expect(existsSync(path.join(library(), 'Administratif', 'bail.pdf'))).toBe(true);
    const list = await call<ItemDto[]>('GET', `/files?folder=${c.id}`);
    expect(list[0]!.path).toBe(path.join(library(), 'Administratif', 'bail.pdf'));
  });

  it('the Recycle Bin: deleted → Annuler; erased only from the bin and when confirmed', async () => {
    const done = await apply([{ path: file('vieux.txt', 'vieux'), later: true }]);
    const id = done.created[0]!.id;
    const del = await call<{ undoId: string }>('DELETE', `/files/${id}`);
    expect(existsSync(path.join(library(), '_À ranger', 'vieux.txt'))).toBe(false);
    expect(existsSync(path.join(library(), '_Corbeille', id, 'vieux.txt'))).toBe(true);
    expect((await call<ItemDto[]>('GET', '/files?trash=1')).map((i) => i.id)).toEqual([id]);
    await call('POST', '/undo', { undoId: del.undoId });
    expect(existsSync(path.join(library(), '_À ranger', 'vieux.txt'))).toBe(true);
    // Erase: not outside the bin, not without the confirmation.
    expect((await hub.request('POST', `${API}/files/${id}/erase`, { confirm: true })).status).toBe(
      409,
    );
    await call('DELETE', `/files/${id}`);
    expect((await hub.request('POST', `${API}/files/${id}/erase`, {})).status).toBe(400);
    await call('POST', `/files/${id}/erase`, { confirm: true });
    expect(existsSync(path.join(library(), '_Corbeille', id))).toBe(false);
    expect((await hub.request('GET', `${API}/files/${id}`)).status).toBe(404);
  });

  it('Mark of the Web read on the original; Thomas’s choice never replaced by a new guess', async () => {
    const pdf = file('cours.py', 'print(1)');
    // NTFS: the file's « :Zone.Identifier » stream (elsewhere: a file of that name, read the same way).
    writeFileSync(
      `${pdf}:Zone.Identifier`,
      '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://moodle.ecam.be/course/view.php?id=7\r\nHostUrl=https://moodle.ecam.be/pluginfile.php/cours.py\r\n',
    );
    const [p] = await analyzeCall({ paths: [pdf] });
    expect(p!.labels.find((a) => a.family === 'origin')?.value).toBe('téléchargé');
    expect(p!.labels.find((a) => a.family === 'site')?.value).toBe('moodle.ecam.be');
    const done = await apply([{ path: pdf, later: true, labels: p!.labels }]);
    const id = done.created[0]!.id;
    await call('PUT', `/files/${id}/labels`, { family: 'language', values: ['CSS'] });
    const again = await call<ItemDto>('POST', `/files/${id}/guess`);
    expect(again.labels.find((a) => a.family === 'language')).toMatchObject({
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
    const done = await apply([{ path: file('setup.exe', 'MZ'), later: true }]);
    const id = done.created[0]!.id;
    const refused = await hub.request('POST', `${API}/files/${id}/open`, { how: 'app' });
    expect(refused.status).toBe(409);
    expect(opened).toEqual([]);
    await call('POST', `/files/${id}/open`, { how: 'app', runnable: true });
    expect(opened).toHaveLength(1);
  });
});
