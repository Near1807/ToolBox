// v0.42.0: the « deadline » shape: a moment (date, optional time, no end),
// never in the load nor in a conflict; « faite » with « Annuler »; the
// « Deadlines » row (not done, late ones included, up to 7 days after).
process.env.TZ = 'Europe/Brussels';

import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { isLate, untilText } from '../shared/deadline';
import { eventWhen } from '../shared/time';
import { isDeadlineItem, rememberCategories, timedBlocks } from '../frontend/common';
import type { CategoryDto } from '../shared/categories';
import type { AgendaEventDto, RangeDto } from '../shared/types';

const API = '/api/modules/agenda';

describe('the time left (pure)', () => {
  const now = '2026-11-17T14:00';
  it.each([
    ['2026-11-19T23:59', 'dans 2 jours'],
    ['2026-11-18T09:00', 'demain 09:00'],
    ['2026-11-18', 'demain'],
    ['2026-11-17T23:59', 'aujourd’hui 23:59'],
    ['2026-11-17', 'aujourd’hui 23:59'],
    ['2026-11-17T14:40', 'dans 40 min'],
    ['2026-11-17T13:30', 'en retard de 30 min'],
    ['2026-11-17T09:00', 'en retard de 5 h'],
    ['2026-11-16T23:59', 'en retard de 1 jour'],
    ['2026-11-14', 'en retard de 3 jours'],
  ])('%s → %s', (start, text) => {
    expect(untilText(start, now)).toBe(text);
  });
  it('late: past its time, or past its day without a time', () => {
    expect(isLate('2026-11-17T13:59', now)).toBe(true);
    expect(isLate('2026-11-17', now)).toBe(false);
    expect(isLate('2026-11-16', now)).toBe(true);
  });
  it('a moment is said with its day and its time only', () => {
    const at = '2026-11-19T23:59';
    expect(eventWhen({ start: at, end: at, allDay: false }, '2026-11-17')).toBe(
      'jeu. 19 nov. 23:59',
    );
  });
});

describe('never counted, never a block', () => {
  it('the load leaves the deadlines out', () => {
    rememberCategories([
      { key: 'deadline', name: 'Deadline', shape: 'deadline', counted: true } as CategoryDto,
      { key: 'cours', name: 'Cours', shape: 'normal', counted: true } as CategoryDto,
    ]);
    const ev = (id: string, category: string, end: string): AgendaEventDto => ({
      id,
      title: id,
      start: '2026-11-18T10:00',
      end,
      allDay: false,
      location: null,
      note: null,
      category,
      weekly: null,
      timerPref: null,
      ...(category === 'Deadline' ? { deadline: true as const } : {}),
    });
    const data = {
      events: [
        ev('rendu', 'Deadline', '2026-11-18T10:00'),
        ev('cours', 'Cours', '2026-11-18T12:00'),
      ],
      foreign: [],
      tasks: [],
    } as unknown as RangeDto;
    expect(timedBlocks(data).map((b) => b.id)).toEqual(['cours']);
    expect(isDeadlineItem({ source: 'own', event: data.events[0]! })).toBe(true);
    expect(isDeadlineItem({ source: 'own', event: data.events[1]! })).toBe(false);
    rememberCategories([]);
  });
});

describe('deadlines through the routes', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });
  const open = async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 17, 14) });
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
  };
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await hub.request<T>(method, `${API}${url}`, body);
    if (r.status !== 200)
      throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const week = () => call<RangeDto>('GET', '/range?from=2026-11-16&to=2026-11-22');

  it('with a time: end = start; without: a day; in the row, sorted; never a block of time', async () => {
    await open();
    const rendu = await call<AgendaEventDto>('POST', '/events', {
      title: 'Rendu rapport',
      start: '2026-11-19T23:59',
      end: '2026-11-20T01:00',
      category: 'Deadline',
    });
    expect(rendu).toMatchObject({
      start: '2026-11-19T23:59',
      end: '2026-11-19T23:59',
      deadline: true,
    });
    const day = await call<AgendaEventDto>('POST', '/events', {
      title: 'Inscription',
      allDay: true,
      start: '2026-11-18',
      end: '2026-11-20',
      category: 'Deadline',
    });
    expect(day).toMatchObject({ start: '2026-11-18', end: '2026-11-18', allDay: true });
    // From the bar: « #deadline ».
    const quick = await call<{ event: AgendaEventDto }>('POST', '/quick', {
      text: 'payer la caution lundi 10h #deadline',
    });
    expect(quick.event.start).toBe(quick.event.end);
    const guide = await call<{ event: AgendaEventDto }>('POST', '/quick', {
      text: 'rendu labo jeudi 23h59 #deadline',
    });
    expect(guide.event).toMatchObject({ start: '2026-11-19T23:59', end: '2026-11-19T23:59' });
    await call('DELETE', `/events/${guide.event.id}`);
    // Or the list's choice.
    const chosen = await call<{ event: AgendaEventDto }>('POST', '/quick', {
      text: 'dossier bourse 26 novembre 12h',
      category: 'Deadline',
    });
    expect(chosen.event).toMatchObject({ start: '2026-11-26T12:00', end: '2026-11-26T12:00' });
    // Late, more than 7 days after the week: not listed when beyond, listed when late.
    await call('POST', '/events', {
      title: 'Trop loin',
      start: '2026-12-05T10:00',
      category: 'Deadline',
    });
    await call('POST', '/events', {
      title: 'Oubliée',
      start: '2026-11-10T10:00',
      category: 'Deadline',
    });
    const w = await week();
    expect(w.deadlines.map((d) => d.title)).toEqual([
      'Oubliée',
      'Inscription',
      'Rendu rapport',
      'Payer la caution',
      'Dossier bourse',
    ]);
    // In the week as events (a line / a band), flagged.
    expect(w.events.find((e) => e.id === rendu.id)).toMatchObject({ deadline: true });
    // An ordinary event still refuses an end before its start.
    expect(
      (
        await hub.request('POST', `${API}/events`, {
          title: 'X',
          start: '2026-11-18T10:00',
          end: '2026-11-18T10:00',
        })
      ).status,
    ).toBe(400);
  });

  it('« faite », then « Annuler »; out of the row while done; moved to a block: one hour', async () => {
    await open();
    const rendu = await call<AgendaEventDto>('POST', '/events', {
      title: 'Rendu rapport',
      start: '2026-11-19T23:59',
      category: 'Deadline',
    });
    const done = await call<AgendaEventDto>('PATCH', `/events/${rendu.id}`, { done: true });
    expect(done.done).toBe(true);
    expect((await week()).deadlines).toEqual([]);
    expect((await week()).events.find((e) => e.id === rendu.id)!.done).toBe(true);
    await call('PATCH', `/events/${rendu.id}`, { done: false });
    expect((await week()).deadlines.map((d) => d.id)).toEqual([rendu.id]);
    expect((await hub.request('PATCH', `${API}/events/${rendu.id}`, { done: 'oui' })).status).toBe(
      400,
    );
    // Its colour changes, its shape stays.
    await call('PATCH', '/categories/Deadline', { color: 'p:orange' });
    const again = await week();
    expect(again.categoryInfo.find((c) => c.key === 'deadline')).toMatchObject({
      css: 'var(--hue-orange)',
      shape: 'deadline',
    });
    // Back to an ordinary category: a block of one hour; and back to a moment.
    const block = await call<AgendaEventDto>('PATCH', `/events/${rendu.id}`, { category: 'Cours' });
    expect(block).toMatchObject({ start: '2026-11-19T23:59', end: '2026-11-20T00:59' });
    expect(block.deadline).toBeUndefined();
    const moment = await call<AgendaEventDto>('PATCH', `/events/${rendu.id}`, {
      category: 'Deadline',
    });
    expect(moment.end).toBe(moment.start);
    const row = (
      dumpTables(hub.dataDir, 'agenda').agenda__events as { done_at: string | null }[]
    )[0]!;
    expect(row.done_at).toBeNull();
  });

  it('one of Thomas’s categories can take the shape « deadline »', async () => {
    await open();
    await call('POST', '/categories', { name: 'Rendus', shape: 'deadline' });
    const e = await call<AgendaEventDto>('POST', '/events', {
      title: 'Labo 3',
      start: '2026-11-20T18:00',
      end: '2026-11-20T20:00',
      category: 'Rendus',
    });
    expect(e).toMatchObject({ end: '2026-11-20T18:00', deadline: true });
    expect((await week()).deadlines.map((d) => d.title)).toEqual(['Labo 3']);
  });
});
