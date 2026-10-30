// « Prêt pour le calendrier » (MODULES.md §5.17) for the Timer and the To-do:
// the right events for a period, at local time, and nothing written when read.
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';

const MODULES = path.resolve(__dirname, '../..');
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
type Event = Record<string, unknown>;

describe('calendar sources of the To-do and the Timer', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());

  const open = async () =>
    createTestHub({
      loadExamples: false,
      modules: [
        await loadModuleFolder(path.join(MODULES, 'todo')),
        await loadModuleFolder(path.join(MODULES, 'timer')),
      ],
    });
  const events = async (from: string, to: string, moduleId: string) =>
    (
      await hub.request<{ events: Event[] }>('GET', `/api/core/calendar?from=${from}&to=${to}`)
    ).body.events.filter((e) => e.moduleId === moduleId);
  const journal = () => {
    const db = new Database(path.join(hub.dataDir, 'hub.db'), { readonly: true });
    const n = ['todo__changes', 'timer__changes'].map(
      (t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
    );
    db.close();
    return n;
  };

  it('tasks with a due date, on their day, with their state', async () => {
    hub = await open();
    const T = '/api/modules/todo/tasks';
    const late = (
      await hub.request<{ id: string }>('POST', T, { title: 'Envoyer le master', due: day(-2) })
    ).body;
    const soon = (
      await hub.request<{ id: string }>('POST', T, { title: 'Finir le mix', due: day(3) })
    ).body;
    await hub.request('POST', T, { title: 'Sans échéance' });
    const done = (
      await hub.request<{ id: string }>('POST', T, { title: 'Acheter des cordes', due: day(1) })
    ).body;
    await hub.request('PATCH', `${T}/${done.id}`, { done: true });
    const gone = (await hub.request<{ id: string }>('POST', T, { title: 'Supprimée', due: day(1) }))
      .body;
    await hub.request('DELETE', `${T}/${gone.id}`);

    const before = journal();
    const list = await events(day(-7), day(7), 'todo');
    expect(list.map((e) => [e.id, e.title, e.start, e.durationMin, e.status])).toEqual([
      [late.id, 'Envoyer le master', day(-2), 0, 'en retard'],
      [done.id, 'Acheter des cordes', day(1), 0, 'fait'],
      [soon.id, 'Finir le mix', day(3), 0, 'à faire'],
    ]);
    expect(list.every((e) => e.open === '/m/todo')).toBe(true);
    // The bounds are included; outside the period, nothing.
    expect((await events(day(3), day(3), 'todo')).map((e) => e.title)).toEqual(['Finir le mix']);
    expect(await events(day(10), day(20), 'todo')).toEqual([]);
    expect(journal()).toEqual(before);
  });

  it('sessions: the one in progress to its planned end, the past ones from start to end', async () => {
    hub = await open();
    const task = (
      await hub.request<{ id: string }>('POST', '/api/modules/todo/tasks', { title: 'Mix' })
    ).body;
    const A = '/api/modules/timer';
    expect(
      (
        await hub.request('POST', `${A}/start`, {
          config: { mode: 'simple', workMin: 25 },
          taskId: task.id,
        })
      ).status,
    ).toBe(200);
    const before = journal();
    let list = await events(day(0), day(0), 'timer');
    expect(list).toHaveLength(1);
    // Local time of the start (within a minute: the clock may turn meanwhile).
    const start = String(list[0]!.start);
    expect(start.slice(0, 11)).toBe(`${day(0)}T`);
    const [h, m] = start.slice(11).split(':').map(Number);
    const local = new Date();
    local.setHours(h!, m!, 0, 0);
    expect(Math.abs(Date.now() - local.getTime())).toBeLessThan(120_000);
    expect(list[0]).toMatchObject({
      title: 'Timer 25 min · Mix',
      durationMin: 25,
      open: '/m/timer',
      status: 'en cours',
    });
    expect(journal()).toEqual(before);
    await hub.request('POST', `${A}/stop`);
    list = await events(day(0), day(0), 'timer');
    expect(list[0]).toMatchObject({ status: 'arrêtée', durationMin: 0 });
    expect(await events(day(1), day(5), 'timer')).toEqual([]);
  });
});
