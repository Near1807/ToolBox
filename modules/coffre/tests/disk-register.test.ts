// v0.46.0 A: the disk is registered once and found again by its IDENTITY
// (never by its letter or path); watching it never writes on it.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DISK_FOLDER, IDENTITY_FILE, quotaPlan, wantedDiskPath } from '../backend/disk-layout';
import { splitVolume } from '../backend/volumes';
import {
  API,
  deposit,
  diskWorld,
  ok,
  registerDisk,
  snapshot,
  status,
  type DiskWorld,
} from './disk-helpers';

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

describe('le disque du coffre', () => {
  it('crée « ToolBox-Coffre » et son identité ; le même dossier est reconnu sans doublon', async () => {
    w = await diskWorld();
    const chosen = path.join(w.E, 'Sauvegardes');
    const s = await registerDisk(w, chosen);
    const folder = path.join(chosen, DISK_FOLDER);
    expect(s.connected).toBe(true);
    expect(s.root).toBe(folder);
    const identity = JSON.parse(readFileSync(path.join(folder, IDENTITY_FILE), 'utf8'));
    expect(identity).toMatchObject({
      format: 'toolbox-coffre',
      id: s.disk!.id,
      name: 'Disque 1 To',
    });
    // Chosen again (the parent, or ToolBox-Coffre itself): the same disk.
    expect((await registerDisk(w, chosen)).disk!.id).toBe(s.disk!.id);
    expect((await registerDisk(w, folder)).disk!.id).toBe(s.disk!.id);
    expect(JSON.parse(readFileSync(path.join(folder, IDENTITY_FILE), 'utf8')).id).toBe(s.disk!.id);
  });

  it('reconnu par son identité quand il revient sur une autre lettre ; absent sinon', async () => {
    w = await diskWorld();
    const s = await registerDisk(w, path.join(w.E, 'Sauvegardes'));
    // Unplugged…
    renameSync(path.join(w.E, 'Sauvegardes'), path.join(w.E, '..', 'ailleurs'));
    const away = await status(w);
    expect(away.connected).toBe(false);
    expect(away.disk!.name).toBe('Disque 1 To');
    // …and plugged back as « F: ».
    renameSync(path.join(w.E, '..', 'ailleurs'), path.join(w.F, 'Sauvegardes'));
    const back = await status(w);
    expect(back.connected).toBe(true);
    expect(back.root).toBe(path.join(w.F, 'Sauvegardes', DISK_FOLDER));
    expect(back.disk!.id).toBe(s.disk!.id);
  });

  it('la surveillance n’écrit jamais rien sur le disque', async () => {
    w = await diskWorld();
    await deposit(w, { 'cours.pdf': 'pdf' });
    await registerDisk(w, path.join(w.E, 'Sauvegardes'));
    const before = snapshot(w.E);
    for (let i = 0; i < 5; i++) await status(w);
    await new Promise((r) => setTimeout(r, 300));
    expect(snapshot(w.E)).toEqual(before);
    // Something to copy, never copied without the click.
    expect((await status(w)).counts.copy).toBe(1);
  });

  it('un coffre d’une autre installation, un second disque : refusés clairement', async () => {
    w = await diskWorld();
    const foreign = path.join(w.F, 'Autre', DISK_FOLDER);
    mkdirSync(foreign, { recursive: true });
    writeFileSync(
      path.join(foreign, IDENTITY_FILE),
      JSON.stringify({
        format: 'toolbox-coffre',
        version: 1,
        id: 'a1b2',
        name: 'Vieux disque',
        createdAt: '',
      }),
    );
    const r = await w.hub.request('POST', `${API}/disk/register`, { path: foreign, name: 'x' });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('Restaurer depuis un disque');
    await registerDisk(w, path.join(w.E, 'Un'));
    mkdirSync(path.join(w.E, 'Deux'));
    const second = await w.hub.request('POST', `${API}/disk/register`, {
      path: path.join(w.E, 'Deux'),
      name: 'x',
    });
    expect(second.status).toBe(409);
    expect(existsSync(path.join(w.E, 'Deux', DISK_FOLDER))).toBe(false);
  });

  it('« Oublier ce disque » ne touche à rien sur le disque', async () => {
    w = await diskWorld();
    await registerDisk(w, path.join(w.E, 'S'));
    const before = snapshot(w.E);
    const s = await ok<{ disk: unknown }>(w, 'POST', `${API}/disk/forget`);
    expect(s.disk).toBeNull();
    expect(snapshot(w.E)).toEqual(before);
    // Chosen again: recognised (the same identity), not a new disk.
    const again = await registerDisk(w, path.join(w.E, 'S'));
    expect(again.connected).toBe(true);
  });
});

describe('pur', () => {
  it('le chemin dans son volume', () => {
    const E = path.resolve('/vol/E');
    expect(splitVolume(path.join(E, 'a', 'b'), [path.resolve('/vol/F'), E])).toEqual({
      root: E,
      rel: path.join('a', 'b'),
    });
  });

  it('la place sur le disque : la même que sur le PC, la corbeille pour un supprimé', () => {
    const item = { id: 'i1', name: 'x.pdf', trashed_at: null, deleted_at: null };
    expect(wantedDiskPath({ ...item, rel_path: 'Cours/Thermo/x.pdf' })).toBe('Cours/Thermo/x.pdf');
    expect(wantedDiskPath({ ...item, rel_path: '_Corbeille/i1/x.pdf', trashed_at: 't' })).toBe(
      '_ToolBox/Corbeille/i1/x.pdf',
    );
  });

  it('quota : les plus anciennes d’abord ; une version plus grosse que le quota gardée et signalée', () => {
    const v = (id: string, size: number, savedAt: string) => ({ id, size, savedAt });
    const r = quotaPlan([v('c', 4, '2026-03'), v('a', 4, '2026-01'), v('b', 4, '2026-02')], 9);
    expect(r.remove).toEqual(['a']);
    expect(r.after).toBe(8);
    const big = quotaPlan([v('big', 50, '2026-01'), v('a', 4, '2026-02')], 10);
    expect(big.remove).toEqual([]);
    expect(big.oversized).toEqual(['big']);
  });
});
