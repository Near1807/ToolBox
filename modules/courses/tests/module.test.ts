// Courses on a real hub: ingredients (no duplicates, merge), meals, the
// planning of a period, the list generated (added up, converted, scaled to
// the portions, by aisle), extras, ticks, the calendar source, the assistant.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { addDays, localToday, mondayOf, weekdayOf } from '../shared/dates';
import type { ListDto, StateDto } from '../shared/types';

const API = '/api/modules/courses';
const open = async () =>
  createTestHub({
    loadExamples: false,
    modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
  });

describe('courses', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
  });
  const state = async () => (await hub.request<StateDto>('GET', `${API}/state`)).body;
  const items = (l: ListDto) =>
    l.groups.flatMap((g) => g.items.map((i) => `${g.aisle} | ${i.name} | ${i.amount}`));

  async function setup() {
    hub = await open();
    const riz = (
      await hub.request<{ id: string }>('POST', `${API}/ingredients`, {
        name: 'Riz arborio',
        unit: 'g',
        aisle: 'Épicerie',
      })
    ).body;
    expect((await hub.request('POST', `${API}/ingredients`, { name: 'riz ARBORIO' })).status).toBe(
      409,
    );
    await hub.request('POST', `${API}/meals`, {
      name: 'Risotto',
      servings: 4,
      tags: ['VG'],
      items: [
        { ingredientId: riz.id, qty: 320, unit: 'g' },
        { name: 'Bouillon', qty: 1, unit: 'l' },
        { name: 'Parmesan', qty: 80, unit: 'g' },
      ],
    });
    await hub.request('POST', `${API}/meals`, {
      name: 'Porridge',
      servings: 1,
      items: [
        { name: 'Flocons d’avoine', qty: 60, unit: 'g' },
        { name: 'Lait', qty: 25, unit: 'cl' },
      ],
    });
    return state();
  }

  it('meals planned over a period give the list, added up, converted and scaled', async () => {
    const s = await setup();
    const risotto = s.meals.find((m) => m.name === 'Risotto')!;
    const porridge = s.meals.find((m) => m.name === 'Porridge')!;
    const soir = s.moments.find((m) => m.name === 'Soir')!;
    const matin = s.moments.find((m) => m.name === 'Matin')!;
    expect(s.moments.map((m) => m.name)).toEqual(['Matin', 'Midi', 'Collation', 'Soir']);
    const monday = mondayOf(localToday());
    await hub.request('PUT', `${API}/list`, { from: monday, to: addDays(monday, 6) });
    await hub.request('POST', `${API}/plan`, {
      date: monday,
      momentId: soir.id,
      mealId: risotto.id,
      servings: 2,
    });
    await hub.request('POST', `${API}/plan`, {
      date: addDays(monday, 2),
      momentId: soir.id,
      mealId: risotto.id,
      servings: 3,
    });
    for (let d = 0; d < 5; d++)
      await hub.request('POST', `${API}/plan`, {
        date: addDays(monday, d),
        momentId: matin.id,
        mealId: porridge.id,
        servings: 1,
      });
    // Out of the period: not in the list.
    await hub.request('POST', `${API}/plan`, {
      date: addDays(monday, 10),
      momentId: soir.id,
      mealId: risotto.id,
      servings: 4,
    });
    const list = (await state()).list;
    expect(list.mealsPlanned).toBe(7);
    expect(items(list)).toEqual([
      'Épicerie | Riz arborio | 400 g', // 320 × (2 + 3) / 4
      'Sans rayon | Bouillon | 1,25 l',
      'Sans rayon | Flocons d’avoine | 300 g',
      'Sans rayon | Lait | 1,25 l', // 25 cl × 5
      'Sans rayon | Parmesan | 100 g',
    ]);
  });

  it('merge two ingredients; extras (usual or by hand); ticks; text to copy', async () => {
    const s = await setup();
    const riz = s.ingredients.find((i) => i.name === 'Riz arborio')!;
    const other = (
      await hub.request<{ id: string }>('POST', `${API}/ingredients`, {
        name: 'Riz rond',
        unit: 'kg',
      })
    ).body;
    await hub.request('POST', `${API}/meals`, {
      name: 'Riz au lait',
      servings: 2,
      items: [{ ingredientId: other.id, qty: 0.2, unit: 'kg' }],
    });
    await hub.request('POST', `${API}/ingredients/merge`, { from: other.id, into: riz.id });
    const after = await state();
    expect(after.ingredients.some((i) => i.name === 'Riz rond')).toBe(false);
    expect(after.meals.find((m) => m.name === 'Riz au lait')!.items[0]!.ingredientId).toBe(riz.id);
    const midi = after.moments.find((m) => m.name === 'Midi')!;
    await hub.request('POST', `${API}/plan`, {
      date: after.list.from,
      momentId: midi.id,
      mealId: after.meals.find((m) => m.name === 'Riz au lait')!.id,
      servings: 2,
    });
    await hub.request('POST', `${API}/extras`, { name: 'Café', aisle: 'Épicerie' });
    expect((await hub.request('POST', `${API}/extras`, { name: 'café' })).status).toBe(409);
    await hub.request('POST', `${API}/list/extras`, { name: 'Café', aisle: 'Épicerie' });
    const list = (
      await hub.request<ListDto>('POST', `${API}/list/extras`, { name: 'Filtres', qty: '1 boîte' })
    ).body;
    expect(items(list)).toEqual([
      'Épicerie | Riz arborio | 200 g',
      'Épicerie | Café | ',
      'Sans rayon | Filtres | 1 boîte',
    ]);
    const ticked = (
      await hub.request<ListDto>('POST', `${API}/list/check`, {
        key: `ing:${riz.id}`,
        checked: true,
      })
    ).body;
    expect(ticked.groups[0]!.items[0]!.checked).toBe(true);
    const { text } = (await hub.request<{ text: string }>('GET', `${API}/list/text`)).body;
    expect(text).toContain('- [x] Riz arborio — 200 g');
    expect(text).toContain('## Épicerie');
  });

  it('calendar source and the assistant (reading free, changes behind their right)', async () => {
    const s = await setup();
    const soir = s.moments.find((m) => m.name === 'Soir')!;
    const today = localToday();
    await hub.request('POST', `${API}/plan`, {
      date: today,
      momentId: soir.id,
      mealId: s.meals.find((m) => m.name === 'Risotto')!.id,
      servings: 2,
    });
    const cal = await hub.request<{
      events: { title: string; start: string; durationMin: number; status: string }[];
    }>('GET', `/api/core/calendar?from=${today}&to=${today}`);
    expect(cal.body.events).toEqual([
      expect.objectContaining({
        title: 'Soir : Risotto',
        start: `${today}T19:30`,
        durationMin: 45,
        status: '2 portions',
      }),
    ]);
    expect(
      await hub.hub.assistant.run('courses.what-to-eat', { day: 'today', moment: 'soir' }),
    ).toMatchObject({
      message: 'Aujourd’hui soir : Risotto (2 portions).',
    });
    expect(hub.hub.assistant.rights().find((r) => r.id === 'courses.edit-meals')).toMatchObject({
      granted: false,
    });
    expect((await hub.hub.assistant.run('courses.add-extra', { name: 'café' })).status).toBe(
      'forbidden',
    );
    hub.hub.assistant.setRight('courses.edit-meals', true);
    expect(await hub.hub.assistant.run('courses.add-extra', { name: 'café' })).toMatchObject({
      status: 'done',
      message: '« café » ajouté aux courses.',
    });
    const tuesday = String(2);
    const planned = await hub.hub.assistant.run('courses.plan-meal', {
      meal: 'risoto',
      day: tuesday,
      moment: 'soir',
    });
    const expected = addDays(today, (2 - weekdayOf(today) + 7) % 7);
    expect(planned).toMatchObject({
      status: 'done',
      message: `Risotto planifié le ${expected} au soir.`,
    });
    if (planned.status === 'done' && planned.undoId) await hub.hub.assistant.undo(planned.undoId);
    expect(
      await hub.hub.assistant.run('courses.what-to-eat', { day: tuesday, moment: 'soir' }),
    ).toMatchObject({
      message: expect.stringMatching(expected === today ? /Risotto/ : /^Rien de prévu/),
    });
  });
});
