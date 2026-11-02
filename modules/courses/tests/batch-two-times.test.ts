// The batch in two times (v0.29) on a real hub: rice in a session (temps 1)
// while the curry sauce is a double dose (temps 2, « riz : déjà préparé »);
// validation keeps both (a double dose left out is not kept; refused when
// the proposal changed); the planning shows the double dose on its cooking
// meal and the thaw of both times; the elements of the plan are pre-ticked.
import { afterEach, describe, expect, it } from 'vitest';
import type { TestHub } from '@hub/sdk/testing';
import type { BatchPlanDto, BatchProposalDto, BatchStateDto, StateDto } from '../shared/types';
import { openHub } from './preps.test';

const API = '/api/modules/courses';
const FROM = '2026-11-02';
const TO = '2026-11-08';

describe('batch in two times (API)', () => {
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
    const pois = await ing('Pois chiches');
    const coco = await ing('Lait de coco', 'ml');
    const prep = async (name: string, items: unknown[], keep: object) =>
      (await call<{ id: string }>('POST', '/preps', { name, items, ...keep })).id;
    const rizCuit = await prep('Riz cuit', [{ ingredientId: riz, qty: 100, unit: 'g' }], {
      fridgeDays: 4,
    });
    const sauce = await prep(
      'Sauce curry',
      [
        { ingredientId: pois, qty: 100, unit: 'g' },
        { ingredientId: coco, qty: 100, unit: 'ml' },
      ],
      { fridgeDays: 3, freezable: true, freezerDays: 60 },
    );
    const curry = (
      await call<{ id: string }>('POST', '/meals', {
        name: 'Curry',
        servings: 2,
        items: [
          { kind: 'prep', prepId: rizCuit, qty: 2 },
          { kind: 'prep', prepId: sauce, qty: 2 },
        ],
      })
    ).id;
    const gratin = (
      await call<{ id: string }>('POST', '/meals', {
        name: 'Gratin',
        servings: 2,
        fridgeDays: 2,
        items: [{ name: 'Chou-fleur', qty: 1, unit: 'pièce' }],
      })
    ).id;
    await call('PUT', '/list', { from: FROM, to: TO });
    const s = await call<StateDto>('GET', '/state');
    const m = (name: string) => s.moments.find((x) => x.name === name)!.id;
    const plan = async (date: string, moment: string, mealId: string) =>
      (
        await call<{ id: string }>('POST', '/plan', {
          date,
          momentId: m(moment),
          mealId,
          servings: 2,
        })
      ).id;
    const e = {
      curryTue: await plan('2026-11-03', 'Soir', curry),
      curryThu: await plan('2026-11-05', 'Soir', curry),
      gratinTue: await plan('2026-11-03', 'Soir', gratin),
      gratinWed: await plan('2026-11-04', 'Soir', gratin),
    };
    return { m, e, ids: { rizCuit, sauce, curry }, plan };
  }
  const form = (m: (n: string) => string, couples: unknown[], extra = {}) => ({
    from: FROM,
    to: TO,
    couples,
    slots: [{ date: '2026-11-02', momentId: m('Midi') }],
    freezer: false,
    daysBefore: 0,
    cookMoments: [m('Soir')],
    ...extra,
  });

  it('rice in a session, the curry sauce and the gratin as double doses; « riz : déjà préparé »', async () => {
    const { m, e, ids } = await setup();
    const rice = [
      { entryId: e.curryTue, prepId: ids.rizCuit },
      { entryId: e.curryThu, prepId: ids.rizCuit },
    ];
    const p = await call<BatchProposalDto>('POST', '/batch/compute', form(m, rice));
    expect(p.sessions.map((s) => s.cooks.map((c) => c.mealName))).toEqual([['Riz cuit']]);
    expect(
      p.doubles!.map((d) => [d.name, d.opener.entryId, d.also.map((a) => a.entryId), d.prepared]),
    ).toEqual([
      ['Gratin', e.gratinTue, [e.gratinWed], []],
      [
        'Sauce curry',
        e.curryTue,
        [e.curryThu],
        [{ name: 'Riz cuit', date: '2026-11-02', momentId: m('Midi') }],
      ],
    ]);
    // Cooking only in the morning: no double dose (Tuesday evening cannot open one).
    const morning = await call<BatchProposalDto>(
      'POST',
      '/batch/compute',
      form(m, rice, { cookMoments: [m('Matin')] }),
    );
    expect(morning.doubles).toEqual([]);
  });

  it('validation keeps both times; a double dose left out is not kept; refused when it changed', async () => {
    const { m, e, ids } = await setup();
    const rice = [
      { entryId: e.curryTue, prepId: ids.rizCuit },
      { entryId: e.curryThu, prepId: ids.rizCuit },
    ];
    const p = await call<BatchProposalDto>('POST', '/batch/compute', form(m, rice));
    const sauce = p.doubles!.find((d) => d.name === 'Sauce curry');
    const gratin = p.doubles!.find((d) => d.name === 'Gratin');
    const refused = await hub.request('POST', `${API}/batch/plans`, {
      ...form(m, rice),
      doubles: [sauce!.key],
      excludedDoubles: [],
    });
    expect(refused.status).toBe(409);
    const plan = await call<BatchPlanDto>('POST', '/batch/plans', {
      ...form(m, rice),
      doubles: [sauce!.key],
      excludedDoubles: [gratin!.key],
    });
    expect(plan.sessions.map((s) => s.cooks.map((c) => c.mealName))).toEqual([['Riz cuit']]);
    expect(
      plan.doubles!.map((d) => [d.name, d.opener.entryId, d.also.map((a) => a.entryId)]),
    ).toEqual([['Sauce curry', e.curryTue, [e.curryThu]]]);
    // The planning: the double dose on its cooking meal (read only); the calendar: sessions only.
    const s = await call<StateDto>('GET', '/state');
    expect(s.doubles).toEqual([
      {
        date: '2026-11-03',
        momentId: m('Soir'),
        entryId: e.curryTue,
        name: 'Sauce curry',
        also: [{ date: '2026-11-05', momentId: m('Soir') }],
      },
    ]);
    const cal = await hub.request<{ events: { id: string }[] }>(
      'GET',
      '/api/core/calendar?from=2026-11-01&to=2026-11-08',
    );
    expect(cal.body.events.filter((x) => x.id.startsWith('batch:'))).toHaveLength(1);
    // Next time: the element of this plan pre-ticked, the covered couples never proposed again.
    const b = await call<BatchStateDto>('GET', `/batch?from=${FROM}&to=${TO}`);
    expect(b.lastElements).toEqual([`prep:${ids.rizCuit}`]);
    const again = await call<BatchProposalDto>('POST', '/batch/compute', form(m, []));
    expect(again.doubles!.map((d) => d.name)).toEqual(['Gratin']);
  });

  it('with the freezer: a double dose beyond the fridge, frozen, in the thaw line', async () => {
    const { m, e, ids, plan } = await setup();
    // The second curry moved to Sunday: 5 days after Tuesday, beyond the 3 fridge days.
    await call('DELETE', `/plan/${e.curryThu}`);
    const currySun = await plan('2026-11-08', 'Soir', ids.curry);
    const body = form(m, [], { freezer: true });
    const p = await call<BatchProposalDto>('POST', '/batch/compute', body);
    const sauce = p.doubles!.find((d) => d.prepId === ids.sauce)!;
    expect(sauce.also.map((a) => [a.entryId, a.frozen])).toEqual([[currySun, true]]);
    await call('POST', '/batch/plans', {
      ...body,
      doubles: p.doubles!.map((d) => d.key),
      excludedDoubles: [],
    });
    const s = await call<StateDto>('GET', '/state');
    expect(s.thaw).toEqual([{ date: '2026-11-07', names: ['Sauce curry'] }]);
  });
});
