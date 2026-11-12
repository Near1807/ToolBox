// The calendar's contract, v0.34.0 (MODULES.md §5.17, ADR 0045): a source may
// give its category, all-day items spanning several days, and items to fit
// in (no time of their own, the To-do's tasks). `ctx.calendar.query` gives
// them all, with module and category; GET /api/core/calendar is unchanged.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { CalendarView, ModuleContext } from '@hub/sdk/core';

const fake = (id: string, name: string, register: (ctx: ModuleContext) => void) => ({
  folder: id,
  manifest: { id, name, description: 'x', version: '1.0.0', section: 'Outils', icon: 'x' },
  backend: { register },
});

describe('the calendar view (query)', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
  });

  it('category: the event’s, else the source’s, else the module’s name; items to fit in', async () => {
    let query: ModuleContext['calendar']['query'] | null = null;
    hub = await createTestHub({
      loadExamples: false,
      modules: [
        await loadModuleFolder(path.resolve(__dirname, '../modules/todo')),
        fake('camp', 'Scouts', (ctx) =>
          ctx.calendar.provide({
            events: () => [
              {
                id: 'w',
                title: 'Week-end',
                start: '2026-11-13',
                endDate: '2026-11-15',
                durationMin: 0,
                open: '/m/camp',
              },
              {
                id: 'r',
                title: 'Réunion',
                start: '2026-11-12T20:00',
                durationMin: 90,
                open: '/m/camp',
                category: 'Réunions',
              },
            ],
          }),
        ),
        fake('broken', 'Cassé', (ctx) =>
          ctx.calendar.provide({
            category: 'Rien',
            events: () => {
              throw new Error('panne');
            },
          }),
        ),
        fake('reader', 'Lecteur', (ctx) => {
          query = ctx.calendar.query;
        }),
      ],
    });
    await hub.request('POST', '/api/modules/todo/tasks', {
      title: 'Réviser',
      due: '2026-11-14',
      durationMin: 120,
    });
    await hub.request('POST', '/api/modules/todo/tasks', { title: 'Ranger' });
    await hub.request('POST', '/api/modules/todo/tasks', { title: 'Plus tard', due: '2026-12-20' });
    const done = (
      await hub.request<{ id: string }>('POST', '/api/modules/todo/tasks', { title: 'Fait' })
    ).body;
    await hub.request('PATCH', `/api/modules/todo/tasks/${done.id}`, { done: true });

    const view: CalendarView = await query!('2026-11-09', '2026-11-15');
    expect(view.events.map((e) => [e.title, e.moduleId, e.category, e.endDate ?? null])).toEqual([
      ['Réunion', 'camp', 'Réunions', null],
      ['Week-end', 'camp', 'Scouts', '2026-11-15'],
      ['Réviser', 'todo', 'Tâches', null],
    ]);
    // To fit in: due by the end of the period, then without a due date; never done ones.
    expect(view.items.map((i) => [i.title, i.due, i.estimateMin, i.category])).toEqual([
      ['Réviser', '2026-11-14', 120, 'Tâches'],
      ['Ranger', null, null, 'Tâches'],
    ]);

    // The hub's route answers as before (no category added, no items).
    const core = (
      await hub.request<{ events: Record<string, unknown>[] }>(
        'GET',
        '/api/core/calendar?from=2026-11-09&to=2026-11-15',
      )
    ).body;
    expect(core.events.map((e) => Object.keys(e).sort())).toContainEqual(
      ['durationMin', 'id', 'moduleId', 'open', 'start', 'status', 'title'].sort(),
    );
    expect(core.events.some((e) => 'category' in e && e.title === 'Réviser')).toBe(false);
  });
});
