// « Prêt pour le calendrier » (ctx.calendar, GET /api/core/calendar) and
// « Prêt pour la synchro » (SyncStore: UUIDs, dates, tombstones, journal).
import { afterEach, describe, expect, it } from 'vitest';
import { changesTableSql, SYNC_COLUMNS, SyncStore, type ModuleContext } from '@hub/sdk/backend';
import { createTestHub, type TestHub } from '@hub/sdk/testing';
import { fakeModule } from '../helpers/fake-modules';

describe('calendar and sync helpers', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
  });

  it('gathers the events of every module for a period', async () => {
    hub = await createTestHub({
      loadExamples: false,
      modules: [
        fakeModule('a', {
          backend: {
            register: (ctx) =>
              ctx.calendar.provide({
                events: (from, to) =>
                  [
                    {
                      id: '1',
                      title: 'Séance',
                      start: '2026-10-28T18:00',
                      durationMin: 60,
                      open: '/m/a',
                    },
                    {
                      id: '2',
                      title: 'Plus tard',
                      start: '2026-11-30T18:00',
                      durationMin: 60,
                      open: '/m/a',
                    },
                  ].filter((e) => e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= to),
              }),
          },
        }),
        fakeModule('b', {
          backend: {
            register: (ctx) =>
              ctx.calendar.provide({
                events: () => [
                  {
                    id: 'x',
                    title: 'Dîner',
                    start: '2026-10-28T12:30',
                    durationMin: 45,
                    open: '/m/b',
                  },
                ],
              }),
          },
        }),
      ],
    });
    const r = await hub.request<{
      sources: string[];
      events: { title: string; moduleId: string }[];
    }>('GET', '/api/core/calendar?from=2026-10-26&to=2026-11-01');
    expect(r.body.sources.sort()).toEqual(['a', 'b']);
    expect(r.body.events.map((e) => [e.title, e.moduleId])).toEqual([
      ['Dîner', 'b'],
      ['Séance', 'a'],
    ]);
    expect(
      (await hub.request('GET', '/api/core/calendar?from=2026-11-02&to=2026-11-01')).status,
    ).toBe(400);
  });

  it('SyncStore: UUIDs, dates, tombstones and the journal', async () => {
    let ctx: ModuleContext | null = null;
    hub = await createTestHub({
      loadExamples: false,
      modules: [
        fakeModule('notes', {
          backend: {
            migrations: [
              {
                version: 1,
                description: 'notes',
                up: `CREATE TABLE notes__items (${SYNC_COLUMNS}, text TEXT NOT NULL); ${changesTableSql('notes__changes')}`,
              },
            ],
            register: (c) => void (ctx = c),
          },
        }),
      ],
    });
    const store = new SyncStore(ctx!.db);
    const row = store.create<{
      id: string;
      text: string;
      created_at: string;
      updated_at: string;
      deleted_at: null;
    }>('items', { text: 'a' });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.created_at).toBe(row.updated_at);
    store.update('items', row.id, { text: 'b' });
    store.remove('items', row.id);
    expect(store.get('items', row.id)).toBeNull();
    expect(store.get('items', row.id, true)).toMatchObject({
      text: 'b',
      deleted_at: expect.any(String),
    });
    store.restore('items', row.id);
    expect(store.get('items', row.id)).toMatchObject({ text: 'b', deleted_at: null });
    expect(store.changesSince().map((c) => c.op)).toEqual([
      'create',
      'update',
      'delete',
      'restore',
    ]);
  });
});
