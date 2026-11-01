// Batch cooking on a real hub: the cooking slots (period / model), the
// calculation that writes nothing, validated plans (several, never on the
// same meals), cancel, « le planning a changé », thaw reminders, calendar,
// warning when a session before the period meets another plan's session.
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { BatchPlanDto, BatchProposalDto, BatchStateDto, StateDto } from '../shared/types';

const API = '/api/modules/courses';
// Monday 2 to Sunday 8 November 2026, then the next week.
const P1 = { from: '2026-11-02', to: '2026-11-08' };
const P2 = { from: '2026-11-09', to: '2026-11-15' };

describe('batch cooking plans', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());

  const setup = async () => {
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const state = (await hub.request<StateDto>('GET', `${API}/state`)).body;
    const [matin, midi, , soir] = state.moments;
    const meal = async (name: string, keep: Record<string, unknown>, tags: string[] = []) =>
      (
        await hub.request<{ id: string }>('POST', `${API}/meals`, {
          name,
          servings: 2,
          tags,
          items: [],
          ...keep,
        })
      ).body.id;
    const curry = await meal('Curry', { fridgeDays: 2, freezable: true, freezerDays: 60 }, [
      'Bätch',
    ]);
    const dal = await meal('Dal', { fridgeDays: 1 }, ['batch']);
    const pates = await meal('Pâtes', {}, ['batch']);
    const plan = async (date: string, momentId: string, mealId: string, servings = 1) =>
      (
        await hub.request<{ id: string }>('POST', `${API}/plan`, {
          date,
          momentId,
          mealId,
          servings,
        })
      ).body.id;
    await hub.request('PUT', `${API}/list`, P1);
    const e = {
      curryMon: await plan('2026-11-02', soir!.id, curry),
      curryTue: await plan('2026-11-03', midi!.id, curry, 2),
      curryFri: await plan('2026-11-06', soir!.id, curry),
      dalWed: await plan('2026-11-04', soir!.id, dal),
      pates: await plan('2026-11-05', midi!.id, pates),
    };
    return { matin: matin!, midi: midi!, soir: soir!, curry, dal, e };
  };
  const batchState = async (p = P1) =>
    (await hub.request<BatchStateDto>('GET', `${API}/batch?from=${p.from}&to=${p.to}`)).body;
  const journal = () => {
    const db = new Database(path.join(hub.dataDir, 'hub.db'), { readonly: true });
    const n = (db.prepare('SELECT COUNT(*) AS n FROM courses__changes').get() as { n: number }).n;
    db.close();
    return n;
  };

  it('the form: tag « batch » found (accents, case), keeping shown, grid empty by default', async () => {
    const { e } = await setup();
    const s = await batchState();
    expect(s.entries.map((x) => [x.entryId, x.batchTag, x.fridgeDays, x.coveredBy])).toEqual([
      [e.curryMon, true, 2, null],
      [e.curryTue, true, 2, null],
      [e.dalWed, true, 1, null],
      [e.pates, true, null, null],
      [e.curryFri, true, 2, null],
    ]);
    expect(s).toMatchObject({ daysBefore: 0, grid: { slots: [], saved: false } });
    expect(
      (
        await hub.request('POST', `${API}/batch/compute`, {
          ...P1,
          entryIds: [e.curryMon],
          slots: [],
        })
      ).body,
    ).toMatchObject({ error: 'Coche les créneaux où tu peux cuisiner.' });
  });

  it('grid: a period changed alone, the model only through « Retenir comme habituels »', async () => {
    const { soir, midi } = await setup();
    const inP2 = async () => (await batchState(P2)).grid.slots.filter((x) => x.date >= P2.from);
    await hub.request('PUT', `${API}/batch/grid`, {
      ...P1,
      slots: [{ date: '2026-11-02', momentId: soir.id }],
    });
    expect((await batchState()).grid).toMatchObject({
      saved: true,
      slots: [{ date: '2026-11-02', momentId: soir.id }],
    });
    expect(await inP2()).toEqual([]);
    const collation = (await hub.request<StateDto>('GET', `${API}/state`)).body.moments[2]!;
    await hub.request('POST', `${API}/batch/grid/model`, {
      ...P1,
      slots: [
        { date: '2026-11-02', momentId: soir.id },
        { date: '2026-11-04', momentId: midi.id },
        { date: '2026-11-04', momentId: collation.id },
      ],
    });
    // The model is laid on the other period; the first period keeps its own grid.
    expect(await inP2()).toEqual([
      { date: '2026-11-09', momentId: soir.id },
      { date: '2026-11-11', momentId: midi.id },
      { date: '2026-11-11', momentId: collation.id },
    ]);
    expect((await batchState()).grid.slots).toEqual([{ date: '2026-11-02', momentId: soir.id }]);
    // A renamed moment keeps its slots; a deleted one is ignored.
    const moments = (await hub.request<StateDto>('GET', `${API}/state`)).body.moments;
    const put = await hub.request('PUT', `${API}/moments`, {
      moments: moments
        .filter((m) => m.id !== collation.id)
        .map((m) => ({ ...m, name: m.id === soir.id ? 'Dîner' : m.name })),
    });
    expect(put.status).toBe(200);
    expect(await inP2()).toEqual([
      { date: '2026-11-09', momentId: soir.id },
      { date: '2026-11-11', momentId: midi.id },
    ]);
  });

  it('calculates without writing; validates; a second plan never on the same meals', async () => {
    const { soir, midi, e } = await setup();
    const slots = [
      { date: '2026-11-02', momentId: soir.id },
      { date: '2026-11-05', momentId: midi.id },
    ];
    const before = journal();
    const proposal = (
      await hub.request<BatchProposalDto>('POST', `${API}/batch/compute`, {
        ...P1,
        entryIds: [e.curryMon, e.curryTue, e.dalWed, e.pates],
        slots,
      })
    ).body;
    expect(journal()).toBe(before);
    expect(proposal.missing).toEqual([e.pates]);
    expect(proposal.uncovered).toEqual([
      {
        entryId: e.dalWed,
        reason: 'se garde 1 jour au frigo, dernier créneau 2 jours avant (congélation désactivée)',
      },
    ]);
    expect(
      proposal.sessions.map((s) => [s.date, s.cooks.map((c) => [c.mealName, c.portions])]),
    ).toEqual([['2026-11-02', [['Curry', 3]]]]);
    const first = await hub.request<BatchPlanDto>('POST', `${API}/batch/plans`, {
      ...P1,
      entryIds: [e.curryMon, e.curryTue],
      slots,
    });
    expect(first.status).toBe(200);
    expect(first.body.grid.slots).toEqual(slots);
    // Already covered: refused; another plan for other meals: accepted.
    expect(
      (
        await hub.request('POST', `${API}/batch/plans`, {
          ...P1,
          entryIds: [e.curryTue, e.curryFri],
          slots,
        })
      ).status,
    ).toBe(409);
    const second = await hub.request<BatchPlanDto>('POST', `${API}/batch/plans`, {
      ...P1,
      entryIds: [e.curryFri],
      slots: [{ date: '2026-11-05', momentId: midi.id }],
    });
    expect(second.status).toBe(200);
    const s = await batchState();
    expect(s.plans).toHaveLength(2);
    expect(s.entries.find((x) => x.entryId === e.curryTue)!.coveredBy).toBe(first.body.id);
    // Nothing else changed: the planning is as it was.
    expect((await hub.request<StateDto>('GET', `${API}/state`)).body.plan).toHaveLength(5);

    // Cancel (confirmed on the page): its meals are free again.
    await hub.request('DELETE', `${API}/batch/plans/${first.body.id}`);
    expect(
      (await batchState()).entries.find((x) => x.entryId === e.curryTue)!.coveredBy,
    ).toBeNull();
  });

  it('freezer: thaw reminder the evening before, calendar, « le planning a changé »', async () => {
    const { soir, e } = await setup();
    const plan = (
      await hub.request<BatchPlanDto>('POST', `${API}/batch/plans`, {
        ...P1,
        entryIds: [e.curryMon, e.curryTue, e.curryFri],
        slots: [{ date: '2026-11-02', momentId: soir.id }],
        freezer: true,
      })
    ).body;
    expect(plan.sessions[0]!.cooks[0]).toMatchObject({ mealName: 'Curry', portions: 4 });
    expect(plan.sessions[0]!.cooks[0]!.frozen.map((u) => u.date)).toEqual(['2026-11-06']);
    const state = (await hub.request<StateDto>('GET', `${API}/state`)).body;
    expect(state.thaw).toEqual([
      { date: '2026-11-05', mealName: 'Curry', forDate: '2026-11-06', forMomentId: soir.id },
    ]);
    // Calendar: the session, without time until one is given.
    const cal = async () =>
      (
        await hub.request<{ events: Record<string, unknown>[] }>(
          'GET',
          '/api/core/calendar?from=2026-11-02&to=2026-11-02',
        )
      ).body.events.filter((x) => String(x.id).startsWith('batch:'));
    expect(await cal()).toMatchObject([
      { title: 'Batch cooking : Curry', start: '2026-11-02', durationMin: 0 },
    ]);
    await hub.request('PATCH', `${API}/batch/sessions/${plan.sessions[0]!.id}`, {
      startTime: '17:30',
      durationMin: 90,
    });
    expect(await cal()).toMatchObject([{ start: '2026-11-02T17:30', durationMin: 90 }]);
    // The planning changes: said, nothing recalculated.
    expect((await batchState()).plans[0]!.changes).toEqual([]);
    await hub.request('PATCH', `${API}/plan/${e.curryTue}`, { servings: 3 });
    expect((await batchState()).plans[0]!.changes).toEqual(['des portions ont changé']);
    expect((await batchState()).plans[0]!.sessions[0]!.cooks[0]!.portions).toBe(4);
  });

  it('sessions before the period: only with N > 0; another plan on that slot is said', async () => {
    const { soir, curry } = await setup();
    // A plan of the first week, cooked on Sunday 8 evening.
    const sunday = await hub.request<{ id: string }>('POST', `${API}/plan`, {
      date: '2026-11-08',
      momentId: soir.id,
      mealId: curry,
      servings: 1,
    });
    await hub.request('POST', `${API}/batch/plans`, {
      ...P1,
      entryIds: [sunday.body.id],
      slots: [{ date: '2026-11-08', momentId: soir.id }],
    });
    await hub.request('PUT', `${API}/list`, P2);
    const monday = await hub.request<{ id: string }>('POST', `${API}/plan`, {
      date: '2026-11-09',
      momentId: soir.id,
      mealId: curry,
      servings: 2,
    });
    const beforeSlot = { date: '2026-11-08', momentId: soir.id };
    // N = 0: a slot before the period is not used.
    const none = (
      await hub.request<BatchProposalDto>('POST', `${API}/batch/compute`, {
        ...P2,
        entryIds: [monday.body.id],
        slots: [beforeSlot],
        daysBefore: 0,
      })
    ).body;
    expect(none).toMatchObject({ error: 'Coche les créneaux où tu peux cuisiner.' });
    const two = (
      await hub.request<BatchProposalDto>('POST', `${API}/batch/compute`, {
        ...P2,
        entryIds: [monday.body.id],
        slots: [beforeSlot],
        daysBefore: 2,
      })
    ).body;
    expect(two.sessions[0]).toMatchObject({ date: '2026-11-08', beforePeriod: true });
    expect(two.sessions[0]!.warnings[0]).toMatch(
      /plan validé \(période du 02\/11\/2026 au 08\/11\/2026\).*rien n’est fusionné/,
    );
  });
});
