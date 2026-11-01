// « Pourrait aussi servir » on a real hub (v0.28): suggestions in the
// proposal, matched by preparation only (never a raw ingredient), never a
// meal already covered, a whole recipe suggesting its other meals; the
// partial inclusion of a meal (one preparation); validation with the
// additions (and refusal when the proposal changed); meals before the period.
import { afterEach, describe, expect, it } from 'vitest';
import type { TestHub } from '@hub/sdk/testing';
import type { BatchPlanDto, BatchProposalDto, BatchStateDto, StateDto } from '../shared/types';
import { openHub } from './preps.test';

const API = '/api/modules/courses';
const FROM = '2026-11-02';
const TO = '2026-11-08';

describe('« Pourrait aussi servir » (API)', () => {
  let hub: TestHub;
  afterEach(async () => hub?.close());
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status >= 400)
      throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  async function setup() {
    hub = await openHub();
    const ing = async (name: string, unit = 'g') =>
      (await call<{ id: string }>('POST', '/ingredients', { name, unit })).id;
    const riz = await ing('Riz');
    const haricots = await ing('Haricots');
    const oeuf = await ing('Œuf', 'pièce');
    const rizCuit = (
      await call<{ id: string }>('POST', '/preps', {
        name: 'Riz cuit',
        items: [{ ingredientId: riz, qty: 100, unit: 'g' }],
        fridgeDays: 3,
        freezable: true,
        freezerDays: 30,
      })
    ).id;
    const oeufs = (
      await call<{ id: string }>('POST', '/preps', {
        name: 'Œufs durs',
        items: [{ ingredientId: oeuf, qty: 3, unit: 'pièce' }],
        fridgeDays: 5,
      })
    ).id;
    const meal = async (name: string, servings: number, items: unknown[], extra = {}) =>
      (await call<{ id: string }>('POST', '/meals', { name, servings, items, ...extra })).id;
    const chili = await meal('Chili', 2, [
      { kind: 'prep', prepId: rizCuit, qty: 2 },
      { ingredientId: haricots, qty: 250, unit: 'g' },
    ]);
    const boite = await meal('Boîte riz-œufs', 1, [
      { kind: 'prep', prepId: rizCuit, qty: 0.8 },
      { kind: 'prep', prepId: oeufs, qty: 1 },
    ]);
    // Raw rice in a direct line: never « Riz cuit ».
    const rizNature = await meal('Riz nature', 1, [{ ingredientId: riz, qty: 100, unit: 'g' }], {
      fridgeDays: 3,
    });
    const curry = await meal('Curry', 2, [{ name: 'Pois chiches', qty: 300, unit: 'g' }], {
      fridgeDays: 3,
    });
    await call('PUT', '/list', { from: FROM, to: TO });
    const s = await call<StateDto>('GET', '/state');
    const m = (name: string) => s.moments.find((x) => x.name === name)!.id;
    const plan = async (date: string, moment: string, mealId: string, servings: number) =>
      (
        await call<{ id: string }>('POST', '/plan', {
          date,
          momentId: m(moment),
          mealId,
          servings,
        })
      ).id;
    const e = {
      chiliMon: await plan('2026-11-02', 'Soir', chili, 2),
      boiteTue: await plan('2026-11-03', 'Midi', boite, 1),
      rizWed: await plan('2026-11-04', 'Midi', rizNature, 1),
      boiteSat: await plan('2026-11-07', 'Midi', boite, 1),
      curryMon: await plan('2026-11-02', 'Soir', curry, 2),
      curryWed: await plan('2026-11-04', 'Soir', curry, 2),
    };
    return { m, e, ids: { rizCuit, oeufs, chili, boite, curry }, plan };
  }
  const form = (m: (n: string) => string, extra: object) => ({
    from: FROM,
    to: TO,
    slots: [{ date: '2026-11-02', momentId: m('Midi') }],
    freezer: false,
    daysBefore: 0,
    ...extra,
  });

  it('suggests a meal not ticked that shares the preparation; never the raw ingredient; never a new cooking', async () => {
    const { m, e, ids } = await setup();
    const p = await call<BatchProposalDto>(
      'POST',
      '/batch/compute',
      form(m, { entryIds: [e.chiliMon] }),
    );
    expect(p.sessions).toHaveLength(1);
    const cook = p.sessions[0]!.cooks[0]!;
    expect(cook.mealName).toBe('Riz cuit');
    // The box of Tuesday (rice part only); not « Riz nature » (raw rice); not the eggs (no such cooking).
    expect(cook.suggestions).toEqual([
      {
        entryId: e.boiteTue,
        date: '2026-11-03',
        momentId: m('Midi'),
        servings: 0.8,
        mealName: 'Boîte riz-œufs',
        frozen: false,
      },
    ]);
    expect(JSON.stringify(p)).not.toContain(e.rizWed);
    expect(p.sessions[0]!.cooks.map((c) => c.prepId)).toEqual([ids.rizCuit]);
    // With the freezer (rice freezable 30 days): Saturday's box too, frozen.
    const f = await call<BatchProposalDto>(
      'POST',
      '/batch/compute',
      form(m, { entryIds: [e.chiliMon], freezer: true }),
    );
    expect(f.sessions[0]!.cooks[0]!.suggestions!.map((x) => [x.entryId, x.frozen])).toEqual([
      [e.boiteTue, false],
      [e.boiteSat, true],
    ]);
  });

  it('a recipe cooked whole: its other meals', async () => {
    const { m, e } = await setup();
    const p = await call<BatchProposalDto>(
      'POST',
      '/batch/compute',
      form(m, { entryIds: [e.curryMon] }),
    );
    expect(p.sessions[0]!.cooks[0]).toMatchObject({ mealName: 'Curry', prepId: null });
    expect(p.sessions[0]!.cooks[0]!.suggestions!.map((x) => x.entryId)).toEqual([e.curryWed]);
  });

  it('validated with the additions; a meal covered is no longer suggested; partial inclusion shown', async () => {
    const { m, e, ids } = await setup();
    const body = form(m, { entryIds: [e.chiliMon] });
    const base = await call<BatchProposalDto>('POST', '/batch/compute', body);
    const addition = {
      date: '2026-11-02',
      momentId: m('Midi'),
      cook: `prep:${ids.rizCuit}`,
      entryId: e.boiteTue,
    };
    // Not a suggestion of this proposal: refused, nothing written.
    const refused = await hub.request('POST', `${API}/batch/plans`, {
      ...body,
      additions: [{ ...addition, entryId: e.rizWed }],
    });
    expect(refused.status).toBe(409);
    const plan = await call<BatchPlanDto>('POST', '/batch/plans', {
      ...body,
      additions: [addition],
    });
    const cook = plan.sessions[0]!.cooks[0]!;
    expect(cook.portions).toBe(2.8);
    expect(cook.fridge.map((u) => [u.entryId, u.mealName])).toEqual([
      [e.chiliMon, 'Chili'],
      [e.boiteTue, 'Boîte riz-œufs'],
    ]);
    expect(cook.ingredients).toEqual([{ name: 'Riz', amount: '280 g' }]);
    expect(base.sessions[0]!.cooks[0]!.portions).toBe(2);
    // Step 1: Tuesday's box covered for the rice only, its eggs still tickable.
    const b = await call<BatchStateDto>('GET', `/batch?from=${FROM}&to=${TO}`);
    const box = b.entries.find((x) => x.entryId === e.boiteTue)!;
    expect(box.coveredBy).toBeNull();
    expect(box.parts.map((x) => [x.name, x.coveredBy !== null])).toEqual([
      ['Riz cuit', true],
      ['Œufs durs', false],
    ]);
    // A second calculation: the covered couple is not suggested any more; the eggs can be computed.
    const again = await call<BatchProposalDto>(
      'POST',
      '/batch/compute',
      form(m, { couples: [{ entryId: e.boiteTue, prepId: ids.oeufs }], freezer: true }),
    );
    expect(again.sessions[0]!.cooks.map((c) => c.mealName)).toEqual(['Œufs durs']);
    expect(JSON.stringify(again.sessions[0]!.cooks[0]!.suggestions)).not.toContain(e.boiteTue);
    // Ticking the covered rice part of that box: refused.
    const covered = await hub.request('POST', `${API}/batch/compute`, {
      ...form(m, { couples: [{ entryId: e.boiteTue, prepId: ids.rizCuit }] }),
    });
    expect(covered.status).toBe(409);
  });

  it('meals of the days before the period: listed, and suggested when sessions may be there', async () => {
    const { m, e, plan, ids } = await setup();
    const sunday = await plan('2026-11-01', 'Soir', ids.chili, 2);
    const b = await call<BatchStateDto>('GET', `/batch?from=${FROM}&to=${TO}`);
    expect(b.entries[0]).toMatchObject({ entryId: sunday, beforePeriod: true });
    expect(b.entries.filter((x) => !x.beforePeriod).map((x) => x.entryId)).toContain(e.chiliMon);
    const p = await call<BatchProposalDto>('POST', '/batch/compute', {
      ...form(m, { entryIds: [e.boiteTue], daysBefore: 1 }),
      slots: [{ date: '2026-11-01', momentId: m('Midi') }],
    });
    const riz = p.sessions[0]!.cooks.find((c) => c.prepId === ids.rizCuit)!;
    expect(riz.suggestions!.map((x) => x.entryId)).toEqual([sunday, e.chiliMon]);
    // N = 0: the meal of Sunday is outside, not suggested.
    const p0 = await call<BatchProposalDto>(
      'POST',
      '/batch/compute',
      form(m, { entryIds: [e.boiteTue] }),
    );
    expect(JSON.stringify(p0)).not.toContain(sunday);
  });
});
