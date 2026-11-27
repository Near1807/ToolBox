// v0.48.0 E: « Pour tous » — the rename template, valid Windows names,
// collisions « (2) », « mixte », exceptions per file, the unchecked ones.
import { describe, expect, it } from 'vitest';
import { batchNames, batchFree, common, renderName } from '../shared/batch';
import type { FolderDto, ProposalDto } from '../shared/types';
import {
  applyBatch,
  applyEntry,
  batchSummary,
  emptyBatch,
  entriesOf,
  markException,
  uncheck,
} from '../frontend/logic';

const proposal = (name: string, tags: string[] = []): ProposalDto => ({
  path: `/dl/${name}`,
  name,
  isDirectory: false,
  fileCount: 0,
  folderCount: 0,
  size: 10,
  sha256: name,
  duplicate: null,
  route: null,
  labels: [
    { family: 'nature', value: 'document', origin: 'guessed', reason: 'extension' },
    ...tags.map((value) => ({
      family: 'free' as const,
      value,
      origin: 'guessed' as const,
      reason: null,
    })),
  ],
});
const thermo: FolderDto = {
  id: 'thermo',
  parentId: 'cours',
  name: 'Thermo',
  color: null,
  css: 'var(--series-1)',
  sort: null,
  path: ['Cours', 'Thermo'],
  count: 0,
  total: 0,
  fresh: 0,
  endOfRoute: false,
  project: false,
  inside: false,
  defaults: [],
  courseName: null,
  tracked: null,
};

describe('Pour tous', () => {
  it('modèle de renommage : {nom} sans extension, {n}, {date}, {dossier} ; extension gardée ; nom Windows valide', () => {
    const v = { n: 3, total: 12, date: '2026-11-24', folder: 'Labos' };
    expect(renderName('Thermo - {nom}', 'labo 1.pdf', v)).toBe('Thermo - labo 1.pdf');
    expect(renderName('{dossier} {n} ({date})', 'x.pdf', v)).toBe('Labos 03 (2026-11-24).pdf');
    expect(renderName('{nom}.pdf', 'a.pdf', v)).toBe('a.pdf');
    expect(renderName('TP: {nom}?', 'a.pdf', v)).toBe('TP_ a_.pdf');
    expect(renderName('', 'a.pdf', v)).toBe('a.pdf');
    expect(renderName('{nom}', 'a.pdf', { ...v, folder: null })).toBe('a.pdf');
  });

  it('collisions dans le lot numérotées « (2) », par dossier de destination', () => {
    const names = batchNames(
      [
        { key: 'a', name: 'notes.pdf', folder: 'Labos' },
        { key: 'b', name: 'Notes.pdf', folder: 'Labos' },
        { key: 'c', name: 'notes.pdf', folder: 'GPU' },
      ],
      'Cours {nom}',
    );
    expect([...names.values()]).toEqual([
      'Cours notes.pdf',
      'Cours Notes (2).pdf',
      'Cours notes.pdf',
    ]);
  });

  it('mixte tant que les valeurs diffèrent ; tags ajoutés / retirés', () => {
    expect(common(['a', 'a'])).toEqual({ mixed: false, value: 'a' });
    expect(common(['a', 'b'])).toEqual({ mixed: true });
    expect(batchFree(['labo', 'Exam'], ['TP', 'labo'], ['exam'])).toEqual(['labo', 'TP']);
  });

  it('lot de 8 : route + tags + renommage, une exception, un décoché → Arrivée ; « choisi »', () => {
    let entries = entriesOf(
      Array.from({ length: 8 }, (_, i) => proposal(`labo${i + 1}.pdf`, i === 0 ? ['vieux'] : [])),
    );
    // The 8th is unchecked.
    entries = entries.map((e, i) => (i === 7 ? { ...e, checked: false } : e));
    expect(batchSummary(entries, [thermo]).free).toEqual({ everywhere: [], some: ['vieux'] });
    const v = {
      ...emptyBatch(),
      route: {
        kind: 'new' as const,
        path: ['Cours', 'Thermo', 'Labos'],
        origin: 'chosen' as const,
        reason: null,
      },
      freeAdd: ['labo'],
      template: 'Thermo - {nom}',
    };
    entries = applyBatch(entries, v, [thermo]);
    // An exception: the 2nd file goes elsewhere (changed on its own sheet).
    const second = entries[1]!;
    entries[1] = {
      ...second,
      choice: { kind: 'existing', id: 'thermo', origin: 'chosen', reason: null },
      exceptions: markException(second, 'route', v),
    };
    // « Pour tous » changed again: the exception stays.
    entries = applyBatch(entries, { ...v, year: '2026' }, [thermo]);
    expect(entries[1]!.choice).toEqual({
      kind: 'existing',
      id: 'thermo',
      origin: 'chosen',
      reason: null,
    });
    expect(entries[1]!.exceptions).toEqual(['route']);
    expect(entries[0]!.choice).toMatchObject({ kind: 'new', path: ['Cours', 'Thermo', 'Labos'] });
    expect(entries[0]!.name).toBe('Thermo - labo1.pdf');
    const tags = (i: number) =>
      entries[i]!.labels.filter((a) => a.family === 'free').map((a) => [a.value, a.origin]);
    expect(tags(0)).toEqual([
      ['vieux', 'chosen'],
      ['labo', 'chosen'],
    ]);
    expect(entries[3]!.labels.find((a) => a.family === 'year')).toMatchObject({
      value: '2026',
      origin: 'chosen',
    });
    // The unchecked one: untouched.
    expect(entries[7]!.name).toBe('labo8.pdf');
    expect(entries[7]!.choice).toBeNull();
    // What « Ranger les cochés » sends: 7 placed, the unchecked one to À ranger.
    const sent = entries.map((e) => applyEntry(e, !e.checked));
    expect(sent.filter((s) => s.later)).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: 'Thermo - labo1.pdf',
      newFolder: ['Cours', 'Thermo', 'Labos'],
    });
    expect(sent[1]).toMatchObject({ folderId: 'thermo' });
  });

  it('un fichier décoché reprend ses propres valeurs (sauf ce qui a été changé pour lui seul)', () => {
    let entries = entriesOf([proposal('a.pdf', ['x']), proposal('b.pdf')]);
    const v = { ...emptyBatch(), freeAdd: ['labo'], template: 'T - {nom}', year: '2026' };
    entries = applyBatch(entries, v, [thermo]);
    expect(entries[0]!.name).toBe('T - a.pdf');
    const back = uncheck(entries[0]!);
    expect(back.name).toBe('a.pdf');
    expect(back.labels.filter((a) => a.family === 'free').map((a) => a.value)).toEqual(['x']);
    expect(back.labels.some((a) => a.family === 'year')).toBe(false);
    // Its own name (an exception) stays.
    const mine = {
      ...entries[1]!,
      name: 'mien.pdf',
      exceptions: markException(entries[1]!, 'rename', v),
    };
    expect(uncheck(mine).name).toBe('mien.pdf');
  });
});
