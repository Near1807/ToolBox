// « Recalculer les titres » (v0.41.0): the events of a source imported in
// v0.37.0 kept their code as title; their original text is kept, so the
// titles are computed again without the file: the import's preview (only
// the title), written only on « Appliquer » (backup, « Annuler »), the
// user's own titles unchecked, nothing else touched (« facultatif » kept).
process.env.TZ = 'Europe/Brussels';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { compareTitles, titleFromOriginal } from '../shared/importing';
import type { ImportPreview } from '../shared/importing';
import type { AgendaSourceDto } from '../shared/types';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/agenda';
const NOW = new Date(2026, 10, 15, 10, 0, 0);
const ICS = readFileSync(path.join(__dirname, 'fixtures', 'horaire-ecam.ics'), 'utf8');
const asNew = {
  format: 'ics',
  name: 'Horaire ECAM',
  mapping: { H: 'Cours', X: 'Examens' },
  defaultCategory: 'Cours',
};
type Preview = ImportPreview & { sourceId: string | null };
interface Applied {
  importId: string | null;
  backup: string | null;
  source: AgendaSourceDto;
  updated: number;
  added: number;
  removed: number;
}
type Row = Record<string, string | number | null>;

describe('« Recalculer les titres » of a source imported in v0.37.0', () => {
  let hub: TestHub;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.join(MODULES, 'agenda'))],
    });
  });
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status !== 200)
      throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const events = () =>
    (dumpTables(hub.dataDir, 'agenda').agenda__events as Row[]).filter(
      (e) => e.deleted_at === null,
    );

  /** Imported as today, then turned into what v0.37.0 left: the SUMMARY as title. */
  async function v037Base() {
    const p = await call<Preview>('POST', '/import/preview', {
      ...asNew,
      text: ICS,
      period: 'all',
    });
    const done = await call<Applied>('POST', '/import/apply', {
      ...asNew,
      text: ICS,
      period: 'all',
      accept: p.add.map((l) => l.key),
    });
    const legacy = (summary: string) => {
      const c = /^([A-Z0-9][A-Z0-9_.-]{0,15})\s*:\s*(.+)$/.exec(summary.trim());
      return c ? c[2]!.trim() : summary.trim();
    };
    const db = new Database(path.join(hub.dataDir, 'hub.db'));
    const rows = db
      .prepare('SELECT id, origin FROM agenda__events WHERE deleted_at IS NULL ORDER BY start_at')
      .all() as { id: string; origin: string }[];
    for (const r of rows) {
      const origin = JSON.parse(r.origin) as {
        original: Record<string, string>;
        imported: Record<string, unknown>;
      };
      const old = legacy(origin.original.SUMMARY ?? '');
      origin.imported.title = old;
      db.prepare('UPDATE agenda__events SET title = ?, origin = ? WHERE id = ?').run(
        old,
        JSON.stringify(origin),
        r.id,
      );
    }
    db.close();
    // After that: one title changed by the user, one event « facultatif », one place changed.
    const [mine, optional, moved] = [rows[0]!.id, rows[1]!.id, rows[2]!.id];
    await call('PATCH', `/events/${mine}`, { title: 'Mon cours à moi' });
    await call('PATCH', `/events/${optional}`, { optional: true });
    await call('PATCH', `/events/${moved}`, { location: 'Auditoire Ampère' });
    return { source: done.source, count: rows.length, mine, optional, moved };
  }

  it('the preview: only titles, the user’s own unchecked, nothing written', async () => {
    const b = await v037Base();
    const before = JSON.stringify(dumpTables(hub.dataDir, 'agenda'));
    const p = await call<Preview>('GET', `/sources/${b.source.id}/titles`);
    expect(JSON.stringify(dumpTables(hub.dataDir, 'agenda'))).toBe(before);
    expect([p.add.length, p.gone.length, p.ignored.length, p.errors.length]).toEqual([0, 0, 0, 0]);
    // The two without a code keep their title; every other is offered, the user's one flagged.
    expect(p.same).toBe(2);
    expect(p.modified.length).toBe(b.count - 2);
    for (const m of p.modified) expect(m.changes.map((c) => c.field)).toEqual(['title']);
    expect(p.modified.filter((m) => m.mine).map((m) => m.id)).toEqual([b.mine]);
    expect(p.modified.find((m) => m.id === b.mine)!.changes[0]!.before).toBe('Mon cours à moi');
    // A course gets its name (« Act: »), an exam its type.
    expect(p.modified.map((m) => m.title)).toEqual(
      expect.arrayContaining(['Non Relational Database', 'Thermo · Écrit']),
    );
    expect(p.modified.some((m) => /^(®-)?[A-Z0-9]+-[A-Z0-9-]+$/.test(m.title))).toBe(false);
    // The Agenda's banner: the source, without the user's own.
    expect(await call('GET', '/title-updates')).toEqual([
      { id: b.source.id, name: 'Horaire ECAM', count: b.count - 3 },
    ]);
  });

  it('« Appliquer »: a backup, the titles only, « modifié par toi » and « facultatif » kept; « Annuler » puts back everything', async () => {
    const b = await v037Base();
    const p = await call<Preview>('GET', `/sources/${b.source.id}/titles`);
    const before = events();
    const backups = () =>
      existsSync(path.join(hub.dataDir, 'backups'))
        ? readdirSync(path.join(hub.dataDir, 'backups'), { recursive: true }).map(String)
        : [];
    const backupsBefore = backups().length;
    const applied = await call<Applied>('POST', `/sources/${b.source.id}/titles/apply`, {
      accept: p.modified.filter((m) => !m.mine).map((m) => m.key),
    });
    expect(applied).toMatchObject({ updated: b.count - 3, added: 0, removed: 0 });
    expect(applied.backup).toMatch(/avant recalcul des titres Agenda|avant-recalcul/);
    expect(backups().length).toBe(backupsBefore + 1);
    const after = events();
    expect(after.length).toBe(before.length);
    for (const e of after) {
      const old = before.find((x) => x.id === e.id)!;
      // Nothing but the title and what the import wrote (origin) changed.
      for (const f of Object.keys(e))
        if (!['title', 'origin', 'updated_at'].includes(f)) expect(e[f], f).toEqual(old[f]);
      if (e.id === b.mine) expect(e.title).toBe('Mon cours à moi');
    }
    expect(after.find((e) => e.id === b.optional)!.optional).toBe(1);
    expect(after.find((e) => e.id === b.moved)!.location).toBe('Auditoire Ampère');
    // What the import wrote follows: a re-import of the same file sees nothing of the user's there.
    const re = await call<Preview>('POST', '/import/preview', {
      format: 'ics',
      text: ICS,
      sourceId: b.source.id,
      period: 'all',
    });
    expect(re.modified.filter((m) => m.changes.some((c) => c.field === 'title')).length).toBe(1);
    expect(await call('GET', '/title-updates')).toEqual([]);
    // « Annuler »: the titles and the origins as before, nothing else.
    await call('POST', '/import/undo', { importId: applied.importId });
    const undone = events();
    for (const e of undone) {
      const old = before.find((x) => x.id === e.id)!;
      for (const f of Object.keys(e)) if (f !== 'updated_at') expect(e[f], f).toEqual(old[f]);
    }
  });

  it('nothing checked: nothing written, no backup; a table import has nothing to compute', async () => {
    const b = await v037Base();
    const before = JSON.stringify(dumpTables(hub.dataDir, 'agenda'));
    const applied = await call<Applied>('POST', `/sources/${b.source.id}/titles/apply`, {
      accept: [],
    });
    expect(applied).toMatchObject({ importId: null, backup: null, updated: 0 });
    expect(JSON.stringify(dumpTables(hub.dataDir, 'agenda'))).toBe(before);
    expect(titleFromOriginal({ Titre: 'Réunion', Date: '2026-11-20' }, 'short')).toBeNull();
    expect(
      titleFromOriginal(
        { SUMMARY: '®-RE4L-L2-4MIN', DESCRIPTION: 'Act:Computer Network Lab' },
        'code',
      ),
    ).toBe('RE4L-L2-4MIN · Computer Network Lab');
    expect(compareTitles([], 'short')).toMatchObject({ same: 0, modified: [] });
  });
});
