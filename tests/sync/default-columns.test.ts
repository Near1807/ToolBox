// A field still at its default value has no clock of its own (v0.40.1): a
// column added by a migration (`optional`, `timer_pref`, the import's
// columns…), or one a module does not write when it creates a row. It was
// lent the HLC of the row's LAST local change, and a real change of that
// field on the other device, made before it, was lost on one side only.
// It is now lent the HLC of the row's creation (its oldest clock); a row
// without any clock (data from before the synchronisation) is unchanged.
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleDatabase } from '@hub/sdk/core';
import { SyncStore } from '@hub/sdk/sync';
import type { SqlDatabase } from '../../packages/phone/database';
import { compareVersions, SYNC_RULES, SYNC_RULES_KEY } from '../../backend/core/sync/engine';
import {
  beginExchange,
  serveExchange,
  serveFirst,
  VersionMismatch,
  versionVerdict,
} from '../../backend/core/sync/protocol';
import { devices, type Devices } from './harness';

const AGENDA = '/api/modules/agenda';
const TODO = '/api/modules/todo';

/** A SyncStore on one device's base, as a module gets it (journal, field clocks). */
function storeOn(d: Devices, side: 'pc' | 'phone', module: string): SyncStore {
  const raw: Pick<SqlDatabase, 'prepare' | 'transaction'> =
    side === 'pc'
      ? ((d.pc.hub as unknown as { handle: { db: unknown } }).handle.db as SqlDatabase)
      : d.phoneDb;
  const db: ModuleDatabase = {
    prefix: `${module}__`,
    table: (name) => `${module}__${name}`,
    prepare: (sql) => raw.prepare(sql) as never,
    transaction: (fn) => raw.transaction(fn)(),
    syncClock: (side === 'pc' ? d.pcEngine : d.phoneEngine).clockFor(module),
    backup: () => '',
  };
  return new SyncStore(db);
}
const exec = (d: Devices, side: 'pc' | 'phone', sql: string) =>
  side === 'pc'
    ? (d.pc.hub as unknown as { handle: { db: { exec(s: string): void } } }).handle.db.exec(sql)
    : d.phoneDb.exec(sql);
const clocks = (d: Devices, side: 'pc' | 'phone', module: string, id: string) =>
  (side === 'pc'
    ? (d.pc.hub as unknown as { handle: { db: import('better-sqlite3').Database } }).handle.db
    : d.phoneDb
  )
    .prepare(`SELECT field FROM ${module}__field_clock WHERE row_id = ? ORDER BY field`)
    .all(id)
    .map((r) => (r as { field: string }).field);
const event = (d: Devices, side: 'pc' | 'phone', id: string) =>
  d.rows(side, 'agenda').events!.find((e) => e.id === id)!;

describe('a field still at its default value, over the synchronisation (v0.40.1)', () => {
  let d: Devices;
  afterEach(async () => {
    await d?.close();
  });

  async function oneEvent() {
    d = await devices();
    d.first('replace');
    const made = await d.onPc<{ id: string }>('POST', `${AGENDA}/events`, {
      title: 'Cours de thermo',
      start: '2026-12-01T08:15',
      end: '2026-12-01T10:00',
    });
    d.exchange();
    // The creation does not write `optional`: no clock of its own, on both devices.
    for (const side of ['pc', 'phone'] as const) {
      expect(clocks(d, side, 'agenda', made.id)).toContain('title');
      expect(clocks(d, side, 'agenda', made.id)).not.toContain('optional');
    }
    return made.id;
  }

  it('« Facultatif » on the phone, the note changed on the PC after it: both kept, on both', async () => {
    const id = await oneEvent();
    await d.onPhone('PATCH', `${AGENDA}/events/${id}`, { optional: true });
    await d.onPc('PATCH', `${AGENDA}/events/${id}`, { note: 'Salle 2F51' });
    const r = d.exchange();
    expect(r.conflicts).toBe(0);
    for (const side of ['pc', 'phone'] as const)
      expect(event(d, side, id), side).toMatchObject({ optional: 1, note: 'Salle 2F51' });
    expect(d.rows('phone', 'agenda').events).toEqual(d.rows('pc', 'agenda').events);
    expect(d.pcEngine.conflicts()).toEqual([]);
  });

  it('the other way: « Facultatif » on the PC, another field on the phone after it', async () => {
    const id = await oneEvent();
    await d.onPc('PATCH', `${AGENDA}/events/${id}`, { optional: true });
    await d.onPhone('PATCH', `${AGENDA}/events/${id}`, { location: '2F51' });
    expect(d.exchange().conflicts).toBe(0);
    for (const side of ['pc', 'phone'] as const)
      expect(event(d, side, id), side).toMatchObject({ optional: 1, location: '2F51' });
    expect(d.rows('phone', 'agenda').events).toEqual(d.rows('pc', 'agenda').events);
  });

  it('« Facultatif » changed on both: the most recent wins, the other in « Conflits »', async () => {
    const id = await oneEvent();
    // The PC sets it, then unsets it; the phone sets it after: the phone's is the most recent.
    await d.onPc('PATCH', `${AGENDA}/events/${id}`, { optional: true });
    await d.onPc('PATCH', `${AGENDA}/events/${id}`, { optional: false });
    await d.onPhone('PATCH', `${AGENDA}/events/${id}`, { optional: true });
    expect(d.exchange().conflicts).toBeGreaterThan(0);
    for (const side of ['pc', 'phone'] as const) expect(event(d, side, id).optional).toBe(1);
    for (const engine of [d.pcEngine, d.phoneEngine]) {
      const c = engine.conflicts().find((x) => x.field === 'optional')!;
      expect(c).toMatchObject({ kind: 'field', kept: '1', discarded: '0' });
    }
  });

  it('the To-do’s associated timer (timer_pref): set on the phone, the title changed on the PC', async () => {
    d = await devices();
    d.first('replace');
    const task = await d.onPc<{ id: string }>('POST', `${TODO}/tasks`, { title: 'Mixer' });
    d.exchange();
    expect(clocks(d, 'pc', 'todo', task.id)).not.toContain('timer_pref');
    await d.onPhone('PATCH', `${TODO}/tasks/${task.id}`, { timerPref: { kind: 'pomodoro' } });
    await d.onPc('PATCH', `${TODO}/tasks/${task.id}`, { title: 'Mixer le morceau' });
    expect(d.exchange().conflicts).toBe(0);
    for (const side of ['pc', 'phone'] as const) {
      const t = d.rows(side, 'todo').tasks!.find((x) => x.id === task.id)!;
      expect(t.title, side).toBe('Mixer le morceau');
      expect(JSON.parse(String(t.timer_pref)), side).toEqual({ kind: 'pomodoro' });
    }
    expect(d.rows('phone', 'todo').tasks).toEqual(d.rows('pc', 'todo').tasks);
  });

  it('the import’s columns (source_id, origin_key, origin) on an event made by hand: written on the PC, the note on the phone', async () => {
    const id = await oneEvent();
    for (const f of ['source_id', 'origin_key', 'origin'])
      expect(clocks(d, 'pc', 'agenda', id)).not.toContain(f);
    // No route writes them on an event made by hand today: as an import would, by the SyncStore.
    const source = '0b6f3c1e-7d2a-4c55-9a7e-2f1d8e9c4b10';
    storeOn(d, 'pc', 'agenda').update('events', id, {
      source_id: source,
      origin_key: 'cle-1',
      origin: '{"original":{},"raw":"H","imported":{}}',
    });
    await d.onPhone('PATCH', `${AGENDA}/events/${id}`, { note: 'Apporter la calculatrice' });
    expect(d.exchange().conflicts).toBe(0);
    for (const side of ['pc', 'phone'] as const)
      expect(event(d, side, id), side).toMatchObject({
        source_id: source,
        origin_key: 'cle-1',
        note: 'Apporter la calculatrice',
      });
    expect(d.rows('phone', 'agenda').events).toEqual(d.rows('pc', 'agenda').events);
  });

  it('a row without any clock (data from before the synchronisation): unchanged, the row’s last change decides', async () => {
    const id = await oneEvent();
    const dropClocks = () => {
      for (const side of ['pc', 'phone'] as const)
        exec(d, side, `DELETE FROM agenda__field_clock WHERE row_id = '${id}'`);
    };
    // The PC's row changed (locally) after the phone's change: the phone's loses on the PC.
    dropClocks();
    await d.onPhone('PATCH', `${AGENDA}/events/${id}`, { optional: true });
    exec(d, 'pc', `DELETE FROM agenda__field_clock WHERE row_id = '${id}'`);
    exec(
      d,
      'pc',
      `UPDATE agenda__events SET updated_at = '2099-01-01T00:00:00.000Z' WHERE id = '${id}'`,
    );
    d.exchange();
    expect(event(d, 'pc', id).optional).toBe(0);
    expect(event(d, 'phone', id).optional).toBe(1);
    // The PC's row older than the phone's change: it wins.
    dropClocks();
    exec(
      d,
      'pc',
      `UPDATE agenda__events SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = '${id}'`,
    );
    await d.onPhone('PATCH', `${AGENDA}/events/${id}`, { location: '2F51' });
    exec(d, 'pc', `DELETE FROM agenda__field_clock WHERE row_id = '${id}'`);
    d.exchange();
    expect(event(d, 'pc', id).location).toBe('2F51');
  });

  // Any column a future migration adds with a default: the same, whatever its type.
  for (const column of [
    { name: 'flag_x', sql: 'INTEGER NOT NULL DEFAULT 0', value: 1 },
    { name: 'label_x', sql: "TEXT NOT NULL DEFAULT 'aucun'", value: 'un' },
    { name: 'json_x', sql: 'TEXT', value: '{"a":1}' },
  ])
    it(`any column added by a migration (${column.sql}): both ways, by exchange and by a « Fusionner »`, async () => {
      d = await devices();
      for (const side of ['pc', 'phone'] as const)
        exec(d, side, `ALTER TABLE agenda__events ADD COLUMN ${column.name} ${column.sql}`);
      d.first('replace');
      const ids: string[] = [];
      for (const title of ['A', 'B', 'C'])
        ids.push(
          (
            await d.onPc<{ id: string }>('POST', `${AGENDA}/events`, {
              title,
              start: '2026-12-01T08:00',
              end: '2026-12-01T09:00',
            })
          ).id,
        );
      d.exchange();
      const [a, b, c] = ids as [string, string, string];
      // A: the new column on the phone, the note on the PC after it.
      storeOn(d, 'phone', 'agenda').update('events', a, { [column.name]: column.value });
      await d.onPc('PATCH', `${AGENDA}/events/${a}`, { note: 'n' });
      // B: the new column on the PC, the place on the phone after it.
      storeOn(d, 'pc', 'agenda').update('events', b, { [column.name]: column.value });
      await d.onPhone('PATCH', `${AGENDA}/events/${b}`, { location: 'l' });
      expect(d.exchange().conflicts).toBe(0);
      for (const side of ['pc', 'phone'] as const) {
        expect(event(d, side, a), `${side} A`).toMatchObject({
          [column.name]: column.value,
          note: 'n',
        });
        expect(event(d, side, b), `${side} B`).toMatchObject({
          [column.name]: column.value,
          location: 'l',
        });
      }
      // C, by a first synchronisation « Fusionner » (snapshots, not journals).
      storeOn(d, 'phone', 'agenda').update('events', c, { [column.name]: column.value });
      await d.onPc('PATCH', `${AGENDA}/events/${c}`, { note: 'm' });
      d.first('merge');
      for (const side of ['pc', 'phone'] as const)
        expect(event(d, side, c), `${side} C`).toMatchObject({
          [column.name]: column.value,
          note: 'm',
        });
      expect(d.rows('phone', 'agenda').events).toEqual(d.rows('pc', 'agenda').events);
    });
});

describe('a device of v0.40.0 (the old rule) and one of v0.40.1: never exchanged', () => {
  let d: Devices;
  afterEach(async () => {
    await d?.close();
  });

  it('the PC refuses, both ways; the phone too; the first synchronisation too; the waiting changes kept', async () => {
    d = await devices();
    d.first('replace');
    await d.onPhone('POST', `${TODO}/tasks`, { title: 'En attente' });
    expect(d.pcEngine.versions()[SYNC_RULES_KEY]).toBe(SYNC_RULES);
    // A v0.40.0 base: the same migrations, without the engine's rules.
    const old = (v: Record<string, number>) => {
      const out = { ...v };
      delete out[SYNC_RULES_KEY];
      return out;
    };
    const request = beginExchange(d.phoneEngine, d.pcEngine.device);
    // Phone v0.40.0 → PC v0.40.1: the phone has to update.
    const fromOld = { ...request, versions: old(request.versions) };
    expect(() => serveExchange(d.pcEngine, d.phoneEngine.device, fromOld)).toThrow(
      /téléphone a une version plus ancienne/,
    );
    expect(compareVersions(old(d.phoneEngine.versions()), d.pcEngine.versions())).toBe(
      'mine-older',
    );
    expect(() =>
      serveFirst(d.pcEngine, d.phoneEngine.device, {
        versions: old(d.phoneEngine.versions()),
        mode: 'merge',
        snapshot: d.phoneEngine.snapshot(),
      }),
    ).toThrow(VersionMismatch);
    // PC v0.40.0 ← phone v0.40.1: the PC has to update (as the PC and the phone each see it).
    expect(versionVerdict(old(d.pcEngine.versions()), request.versions)).toBe('pc-older');
    expect(compareVersions(d.phoneEngine.versions(), old(d.pcEngine.versions()))).toBe(
      'theirs-older',
    );
    // Nothing reached the PC; once both are 0.40.1, the change goes.
    expect(d.rows('pc', 'todo').tasks!.filter((t) => t.title === 'En attente')).toHaveLength(0);
    d.exchange();
    expect(d.rows('pc', 'todo').tasks!.filter((t) => t.title === 'En attente')).toHaveLength(1);
  });
});
