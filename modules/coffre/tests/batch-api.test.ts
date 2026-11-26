// v0.48.0 E: « Pour tous » on the server — a lot of 8 put away in one request
// (route created at the validation, tags, names from the template, one
// exception, one unchecked to Arrivée), ONE « Annuler »; the original name kept
// and searchable; « Modifier la sélection » of 5 stored elements, undone.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBatch, applyEntry, emptyBatch, entriesOf, markException } from '../frontend/logic';
import type { ContextDto, ItemDto, SearchDto } from '../shared/types';
import { API, deposit, diskWorld, ok, type DiskWorld, job, analyze } from './disk-helpers';

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});
const lib = (...p: string[]) => path.join(w.hub.dataDir, 'coffre', ...p);
const contexts = () => ok<ContextDto[]>(w, 'GET', `${API}/contexts`);
const item = (id: string) => ok<ItemDto>(w, 'GET', `${API}/items/${id}`);
const tagsOf = (i: ItemDto) => i.attributes.filter((a) => a.key === 'tag');

describe('Pour tous (serveur)', () => {
  it('lot de 8 : route + tags + renommage, une exception, un décoché → Arrivée ; un seul Annuler ; « choisi »', async () => {
    w = await diskWorld();
    await deposit(w, { 'old.md': 'x' }, ['Cours', 'Thermo']);
    const paths = Array.from({ length: 8 }, (_, i) => {
      const p = path.join(w.dl, 'lot', `labo ${i + 1}.pdf`);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, `pdf ${i + 1}`);
      return p;
    });
    const analyzed = await analyze(w, {
      paths,
    });
    const cs = await contexts();
    const thermo = cs.find((c) => c.path.join('/') === 'Cours/Thermo')!;
    let entries = entriesOf(analyzed);
    entries = entries.map((e, i) => (i === 7 ? { ...e, checked: false } : e));
    const v = {
      ...emptyBatch(),
      route: {
        kind: 'new' as const,
        path: ['Cours', 'Thermo', 'Labos'],
        origin: 'chosen' as const,
        reason: null,
      },
      tagsAdd: ['labo'],
      template: 'Thermo - {nom}',
    };
    entries = applyBatch(entries, v, cs);
    entries[2] = {
      ...entries[2]!,
      choice: { kind: 'existing', id: thermo.id, origin: 'chosen', reason: null },
      exceptions: markException(entries[2]!, 'route', v),
    };
    // « Labos » does not exist yet: created only now.
    expect((await contexts()).some((c) => c.name === 'Labos')).toBe(false);
    const r = await job<{ created: ItemDto[]; undoId: string }>(w, 'POST', `${API}/deposit/apply`, {
      entries: entries.map((e) => applyEntry(e, !e.checked)),
    });
    expect(r.created).toHaveLength(8);
    const byName = new Map(r.created.map((i) => [i.originalName ?? i.name, i]));
    const first = byName.get('labo 1.pdf')!;
    expect(first.name).toBe('Thermo - labo 1.pdf');
    expect(first.contextPath).toEqual(['Cours', 'Thermo', 'Labos']);
    expect(tagsOf(first)).toEqual([expect.objectContaining({ value: 'labo', origin: 'chosen' })]);
    expect(existsSync(lib('Cours', 'Thermo', 'Labos', 'Thermo - labo 1.pdf'))).toBe(true);
    expect(byName.get('labo 3.pdf')!.contextPath).toEqual(['Cours', 'Thermo']);
    const unchecked = r.created.find((i) => i.name === 'labo 8.pdf')!;
    expect(unchecked.arrival).toBe(true);
    expect(unchecked.originalName).toBeNull();
    // The original name: kept and searchable.
    const found = await ok<SearchDto>(w, 'GET', `${API}/search?q=${encodeURIComponent('labo 5')}`);
    expect(found.results.map((x) => x.item.name)).toContain('Thermo - labo 5.pdf');
    // ONE « Annuler »: the 8 gone, « Labos » (created for them) too, the rest intact.
    await ok(w, 'POST', `${API}/undo`, { undoId: r.undoId });
    const after = await contexts();
    expect(after.some((c) => c.name === 'Labos')).toBe(false);
    expect(after.some((c) => c.path.join('/') === 'Cours/Thermo')).toBe(true);
    expect(existsSync(lib('Cours', 'Thermo', 'Labos'))).toBe(false);
    expect(existsSync(lib('Cours', 'Thermo', 'old.md'))).toBe(true);
  }, 60_000);

  it('Modifier la sélection : 5 éléments rangés (route nouvelle, nature, tags, renommage), un seul Annuler', async () => {
    w = await diskWorld();
    const made = await deposit(
      w,
      { 'a.md': 'a', 'b.md': 'b', 'c.md': 'c', 'd.md': 'd', 'e.md': 'e' },
      ['Arrivage'],
    );
    await ok(w, 'PUT', `${API}/items/${made[0]!.id}/attributes`, {
      key: 'tag',
      values: ['vieux', 'garde'],
    });
    const ids = made.map((i) => i.id);
    const names = Object.fromEntries(made.map((i, n) => [i.id, `Projet ${n + 1} - ${i.name}`]));
    // A collision inside the folder: « Projet 1 - a.md » already exists there.
    await deposit(w, { 'Projet 1 - a.md': 'déjà là' }, ['Projets', 'Web']);
    const r = await ok<{ items: ItemDto[]; undoId: string }>(w, 'POST', `${API}/items/batch`, {
      ids,
      newContext: ['Projets', 'Web'],
      set: { nature: 'notes' },
      tagsAdd: ['web'],
      tagsRemove: ['vieux'],
      names,
    });
    const a = r.items.find((i) => i.id === ids[0])!;
    expect(a.contextPath).toEqual(['Projets', 'Web']);
    expect(a.name).toBe('Projet 1 - a (2).md');
    expect(a.originalName).toBe('a.md');
    expect(
      tagsOf(a)
        .map((t) => t.value)
        .sort(),
    ).toEqual(['garde', 'web']);
    expect(a.attributes.find((x) => x.key === 'nature')).toMatchObject({
      value: 'notes',
      origin: 'chosen',
    });
    expect(existsSync(lib('Projets', 'Web', 'Projet 1 - a (2).md'))).toBe(true);
    for (const i of r.items) expect(i.contextPath).toEqual(['Projets', 'Web']);
    // ONE « Annuler »: names, places, attributes as before.
    await ok(w, 'POST', `${API}/undo`, { undoId: r.undoId });
    const back = await item(ids[0]!);
    expect(back.name).toBe('a.md');
    expect(back.contextPath).toEqual(['Arrivage']);
    expect(
      tagsOf(back)
        .map((t) => t.value)
        .sort(),
    ).toEqual(['garde', 'vieux']);
    expect(back.attributes.find((x) => x.key === 'nature')?.value).not.toBe('notes');
    expect(existsSync(lib('Arrivage', 'a.md'))).toBe(true);
    // « Projets/Web » existed before (the other file): kept.
    expect((await contexts()).some((c) => c.path.join('/') === 'Projets/Web')).toBe(true);
  }, 60_000);
});
