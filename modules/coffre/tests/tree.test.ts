// v0.48.0 B: the tree of the contexts managed in ToolBox — move (by the tree
// and the map: the same route), merge, delete when empty, reorder; files and
// sheets together, « Annuler », the disk updated by MOVES.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextDto, DiskStatusDto, ItemDto, SearchDto, UpdateReport } from '../shared/types';
import {
  API,
  deposit,
  diskWorld,
  ok,
  registerDisk,
  sha,
  waitJob,
  type DiskWorld,
  job as runJob,
} from './disk-helpers';

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});
const lib = (...p: string[]) => path.join(w.hub.dataDir, 'coffre', ...p);
const contexts = () => ok<ContextDto[]>(w, 'GET', `${API}/contexts`);
const byPath = async (p: string) => (await contexts()).find((c) => c.path.join('/') === p)!;
const item = (id: string) => ok<ItemDto>(w, 'GET', `${API}/items/${id}`);
const undo = (undoId: string) => ok(w, 'POST', `${API}/undo`, { undoId });

describe('arbre des contextes', () => {
  it('Thermo, Réseaux, GPU (racine) déplacés dans un nouveau « Cours » : fichiers, chemins, empreintes, vues, recherche, disque en déplacements, Annuler', async () => {
    w = await diskWorld();
    const [thermo] = await deposit(w, { 'chap1.md': 'Premier principe de la thermodynamique' }, [
      'Thermo',
    ]);
    const [labo] = await deposit(w, { 'labo1.md': 'Mesure de la chaleur' }, ['Thermo', 'Labos']);
    const [res] = await deposit(w, { 'vlan.md': 'Les VLAN' }, ['Réseaux']);
    const [gpu] = await deposit(w, { 'cuda.md': 'Noyaux CUDA' }, ['GPU']);
    await ok(w, 'PUT', `${API}/items/${thermo!.id}/attributes`, { key: 'tag', values: ['examen'] });
    const shaBefore = sha(lib('Thermo', 'chap1.md'));
    // The disk saved first: then the move must be MOVES there.
    await registerDisk(w, path.join(w.E, 'S'));
    const first = await waitJob(
      w,
      (await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`)).jobId,
    );
    expect(first.status).toBe('succeeded');
    const cours = await ok<ContextDto>(w, 'POST', `${API}/contexts`, { name: 'Cours' });
    const undos: string[] = [];
    for (const name of ['Thermo', 'Réseaux', 'GPU']) {
      const c = await byPath(name);
      undos.push(
        (
          await runJob<{ undoId: string }>(w, 'POST', `${API}/contexts/${c.id}/move`, {
            parentId: cours.id,
          })
        ).undoId,
      );
    }
    expect(existsSync(lib('Thermo'))).toBe(false);
    expect(readFileSync(lib('Cours', 'Thermo', 'chap1.md'), 'utf8')).toMatch(/Premier principe/);
    expect(existsSync(lib('Cours', 'Thermo', 'Labos', 'labo1.md'))).toBe(true);
    expect(existsSync(lib('Cours', 'Réseaux', 'vlan.md'))).toBe(true);
    expect(existsSync(lib('Cours', 'GPU', 'cuda.md'))).toBe(true);
    expect(sha(lib('Cours', 'Thermo', 'chap1.md'))).toBe(shaBefore);
    expect((await item(thermo!.id)).contextPath).toEqual(['Cours', 'Thermo']);
    expect((await item(labo!.id)).path).toBe(lib('Cours', 'Thermo', 'Labos', 'labo1.md'));
    expect((await item(thermo!.id)).sha256).toBe(thermo!.sha256);
    // The views, the search.
    const tagged = await ok<ItemDto[]>(w, 'GET', `${API}/items?key=tag&value=examen`);
    expect(tagged.map((i) => i.id)).toEqual([thermo!.id]);
    const thermoCtx = await byPath('Cours/Thermo');
    expect(
      (await ok<ItemDto[]>(w, 'GET', `${API}/items?context=${thermoCtx.id}`)).map((i) => i.id),
    ).toEqual([thermo!.id]);
    expect(
      (await ok<SearchDto>(w, 'GET', `${API}/search?q=cuda`)).results[0]!.item.contextPath,
    ).toEqual(['Cours', 'GPU']);
    // The disk: 4 moves, nothing copied again.
    const plan = await ok<{ counts: DiskStatusDto['counts'] }>(w, 'GET', `${API}/disk/plan`);
    expect(plan.counts).toEqual({ copy: 0, update: 0, move: 4, trash: 0 });
    const job = await waitJob(
      w,
      (await ok<{ jobId: string }>(w, 'POST', `${API}/disk/update`)).jobId,
    );
    const report = job.result as UpdateReport;
    expect(report).toMatchObject({ copied: 0, moved: 4 });
    expect(existsSync(path.join(w.E, 'S', 'ToolBox-Coffre', 'Cours', 'GPU', 'cuda.md'))).toBe(true);
    // « Annuler » the last one: GPU back at the root.
    await undo(undos[2]!);
    expect(existsSync(lib('GPU', 'cuda.md'))).toBe(true);
    expect((await item(gpu!.id)).contextPath).toEqual(['GPU']);
    void res;
  }, 60_000);

  it('dans lui-même ou un descendant : refusé ; nom déjà pris : fusionner plutôt', async () => {
    w = await diskWorld();
    await deposit(w, { 'a.md': 'a' }, ['Cours', 'Thermo', 'Labos']);
    await deposit(w, { 'b.md': 'b' }, ['Thermo']);
    const cours = await byPath('Cours');
    const labos = await byPath('Cours/Thermo/Labos');
    const r = await w.hub.request('POST', `${API}/contexts/${cours.id}/move`, {
      parentId: labos.id,
    });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/lui-même ni dans un de ses sous-contextes/);
    expect(
      (await w.hub.request('POST', `${API}/contexts/${cours.id}/move`, { parentId: cours.id }))
        .status,
    ).toBe(409);
    const rootThermo = await byPath('Thermo');
    const clash = await w.hub.request('POST', `${API}/contexts/${rootThermo.id}/move`, {
      parentId: cours.id,
    });
    expect(clash.status).toBe(409);
    expect(JSON.stringify(clash.body)).toMatch(/fusionne-les plutôt/);
  });

  it('fusionner : éléments et sous-contextes passent, même nom fusionné, fichiers jamais écrasés « (2) », liens, cours et règles suivent ; Annuler', async () => {
    w = await diskWorld();
    const [a1] = await deposit(w, { 'notes.md': 'notes du cours' }, ['Cours', 'Thermo']);
    await deposit(w, { 'tp.md': 'tp cours' }, ['Cours', 'Thermo', 'Labos']);
    const [b1] = await deposit(w, { 'notes.md': 'autres notes' }, ['Thermodynamique']);
    const [b2] = await deposit(w, { 'mesure.md': 'mesure' }, ['Thermodynamique', 'Labos']);
    const [b3] = await deposit(w, { 'loi.md': 'loi' }, ['Thermodynamique', 'Exercices']);
    const thermo = await byPath('Cours/Thermo');
    const src = await byPath('Thermodynamique');
    await ok(w, 'PATCH', `${API}/contexts/${src.id}`, { courseName: 'Thermodynamique' });
    const [other] = await deposit(w, { 'x.md': 'x' }, ['Perso']);
    await ok(w, 'POST', `${API}/items/${other!.id}/also`, { contextId: src.id });
    const shaB1 = sha(lib('Thermodynamique', 'notes.md'));
    const { undoId } = await runJob<{ undoId: string }>(
      w,
      'POST',
      `${API}/contexts/${src.id}/merge`,
      {
        into: thermo.id,
      },
    );
    expect((await contexts()).some((c) => c.id === src.id)).toBe(false);
    expect(readFileSync(lib('Cours', 'Thermo', 'notes.md'), 'utf8')).toBe('notes du cours');
    expect(sha(lib('Cours', 'Thermo', 'notes (2).md'))).toBe(shaB1);
    expect((await item(b1!.id)).name).toBe('notes (2).md');
    expect((await item(b2!.id)).path).toBe(lib('Cours', 'Thermo', 'Labos', 'mesure.md'));
    expect((await item(b3!.id)).contextPath).toEqual(['Cours', 'Thermo', 'Exercices']);
    expect(existsSync(lib('Thermodynamique'))).toBe(false);
    expect((await item(other!.id)).alsoIn).toEqual([thermo.id]);
    expect((await contexts()).find((c) => c.id === thermo.id)!.courseName).toBe('Thermodynamique');
    expect(
      (await contexts()).filter((c) => c.path.join('/') === 'Cours/Thermo/Labos'),
    ).toHaveLength(1);
    // Nothing erased: every element still there.
    for (const id of [a1!.id, b1!.id, b2!.id, b3!.id])
      expect((await item(id)).trashedAt).toBeNull();
    // « Annuler »: exactly as before.
    await undo(undoId);
    expect(readFileSync(lib('Thermodynamique', 'notes.md'), 'utf8')).toBe('autres notes');
    expect(existsSync(lib('Thermodynamique', 'Labos', 'mesure.md'))).toBe(true);
    expect(existsSync(lib('Cours', 'Thermo', 'notes (2).md'))).toBe(false);
    expect((await item(b1!.id)).contextPath).toEqual(['Thermodynamique']);
    expect((await item(other!.id)).alsoIn).toEqual([src.id]);
    expect((await contexts()).some((c) => c.id === src.id)).toBe(true);
  }, 60_000);

  it('supprimer : refusé s’il n’est pas vide ; vide : supprimé (Annuler) ; réordonner', async () => {
    w = await diskWorld();
    await deposit(w, { 'a.md': 'a' }, ['Cours', 'Thermo']);
    const thermo = await byPath('Cours/Thermo');
    const r = await w.hub.request('DELETE', `${API}/contexts/${thermo.id}`);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/n'est pas vide \(1 élément/);
    const vide = await ok<ContextDto>(w, 'POST', `${API}/contexts`, {
      name: 'Vide',
      parentId: (await byPath('Cours')).id,
    });
    const { undoId } = await ok<{ undoId: string }>(w, 'DELETE', `${API}/contexts/${vide.id}`);
    expect((await contexts()).some((c) => c.id === vide.id)).toBe(false);
    await undo(undoId);
    expect((await contexts()).some((c) => c.id === vide.id)).toBe(true);
    // Reorder: « Vide » before « Thermo ».
    await ok(w, 'POST', `${API}/contexts/${vide.id}/reorder`, { beforeId: thermo.id });
    const kids = (await contexts()).filter((c) => c.path[0] === 'Cours' && c.path.length === 2);
    expect(kids.map((c) => c.name)).toEqual(['Vide', 'Thermo']);
  });

  it('renommer (le dossier suit, Annuler) ; déplacer vers une route nouvelle (créée à la validation, retirée par Annuler) ; noms invalides refusés', async () => {
    w = await diskWorld();
    const [a] = await deposit(w, { 'a.md': 'a' }, ['thermo', 'Labos']);
    const thermo = await byPath('thermo');
    // Only the case changes: through a temporary name (case-insensitive Windows).
    const renamed = await ok<ContextDto & { undoId: string }>(
      w,
      'PATCH',
      `${API}/contexts/${thermo.id}`,
      { name: 'Thermo' },
    );
    expect(renamed.path).toEqual(['Thermo']);
    expect((await item(a!.id)).path).toBe(lib('Thermo', 'Labos', 'a.md'));
    await undo(renamed.undoId);
    expect((await item(a!.id)).contextPath).toEqual(['thermo', 'Labos']);
    expect(existsSync(lib('thermo', 'Labos', 'a.md'))).toBe(true);
    // A route that does not exist yet: created only now, removed by « Annuler ».
    const { undoId } = await runJob<{ undoId: string }>(
      w,
      'POST',
      `${API}/contexts/${thermo.id}/move`,
      {
        newParent: ['Cours', 'Semestre 2'],
      },
    );
    expect((await item(a!.id)).contextPath).toEqual(['Cours', 'Semestre 2', 'thermo', 'Labos']);
    expect(existsSync(lib('Cours', 'Semestre 2', 'thermo', 'Labos', 'a.md'))).toBe(true);
    await undo(undoId);
    expect((await contexts()).map((c) => c.path.join('/')).sort()).toEqual([
      'thermo',
      'thermo/Labos',
    ]);
    expect(existsSync(lib('thermo', 'Labos', 'a.md'))).toBe(true);
    // Invalid Windows names: refused, nothing created.
    for (const name of ['TP: 1', 'aux', 'fin.', '_Arrivée']) {
      const r = await w.hub.request('POST', `${API}/contexts`, { name });
      expect(r.status, name).toBe(400);
    }
    const bad = await w.hub.request('POST', `${API}/contexts/${thermo.id}/move`, {
      newParent: ['Cours', 'A?B'],
    });
    expect(bad.status).toBe(400);
    expect((await contexts()).some((c) => c.name === 'Cours')).toBe(false);
  });

  it('créer un contexte : Annuler le retire (seulement tant qu’il est vide)', async () => {
    w = await diskWorld();
    const c = await ok<ContextDto & { undoId: string }>(w, 'POST', `${API}/contexts`, {
      name: 'Cours',
    });
    expect(c.undoId).toBeTruthy();
    await undo(c.undoId);
    expect((await contexts()).some((x) => x.id === c.id)).toBe(false);
    // Filled meanwhile: « Annuler » refuses (nothing is lost).
    const d = await ok<ContextDto & { undoId: string }>(w, 'POST', `${API}/contexts`, {
      name: 'Perso',
    });
    await deposit(w, { 'a.md': 'a' }, ['Perso']);
    const r = await w.hub.request('POST', `${API}/undo`, { undoId: d.undoId });
    expect(r.status).toBe(409);
    expect((await contexts()).some((x) => x.id === d.id)).toBe(true);
  });
});
