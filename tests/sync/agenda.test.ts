// The Agenda over the synchronisation (v0.34.0): events, the week type and
// its exceptions travel like the other modules' rows; the same on both.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { devices, type Devices } from './harness';

const API = '/api/modules/agenda';

describe('the Agenda over the synchronisation', () => {
  let d: Devices;
  afterEach(async () => {
    await d?.close();
  });

  it('events, week type, a cancelled occurrence, a deletion: the same on both devices', async () => {
    d = await devices();
    d.first('replace');
    const camp = await d.onPhone<{ event: { id: string } }>('POST', `${API}/quick`, {
      text: 'week-end scout 13-15 février',
    });
    const weekly = await d.onPc<{ weekly: { id: string } }>('POST', `${API}/quick`, {
      text: 'badminton tous les jeudis 19h 2h',
    });
    d.exchange();
    expect(d.rows('pc', 'agenda').events!.map((e) => e.title)).toEqual(['Week-end scout']);
    expect(d.rows('phone', 'agenda').weekly!.map((e) => e.title)).toEqual(['Badminton']);
    // One occurrence cancelled on the phone, the camp moved on the PC, a lunch deleted on the phone.
    const thursday = '2026-12-03';
    await d.onPhone('PUT', `${API}/weekly/${weekly.weekly.id}/occurrences/${thursday}`, {
      action: 'cancel',
    });
    await d.onPc('PATCH', `${API}/events/${camp.event.id}`, { location: 'Spa' });
    const lunch = await d.onPhone<{ id: string }>('POST', `${API}/events`, {
      title: 'Déjeuner',
      start: '2026-12-02T12:30',
      end: '2026-12-02T13:30',
    });
    d.exchange();
    await d.onPhone('DELETE', `${API}/events/${lunch.id}`);
    d.exchange();
    for (const table of ['events', 'weekly', 'exceptions'])
      expect(d.rows('phone', 'agenda')[table], table).toEqual(d.rows('pc', 'agenda')[table]);
    const onPc = d.rows('pc', 'agenda');
    expect(onPc.exceptions!.map((x) => [x.occurrence_date, x.kind])).toEqual([
      [thursday, 'cancel'],
    ]);
    expect(onPc.events!.find((e) => e.id === lunch.id)!.deleted_at).not.toBeNull();
    expect(onPc.events!.find((e) => e.id === camp.event.id)!.location).toBe('Spa');
  });

  it('v0.37.0: a calendar imported on the PC arrives on the phone, with its source', async () => {
    d = await devices();
    d.first('replace');
    const text = readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        'modules',
        'agenda',
        'tests',
        'fixtures',
        'horaire-ecam.ics',
      ),
      'utf8',
    );
    const choice = {
      format: 'ics',
      text,
      name: 'Horaire ECAM',
      mapping: { H: 'Cours', X: 'Examens' },
      period: 'all',
    };
    const p = await d.onPc<{ add: { key: string }[] }>('POST', `${API}/import/preview`, choice);
    await d.onPc('POST', `${API}/import/apply`, { ...choice, accept: p.add.map((l) => l.key) });
    d.exchange();
    const phone = d.rows('phone', 'agenda');
    expect(phone.sources!.map((s) => s.name)).toEqual(['Horaire ECAM']);
    expect(phone.events!.length).toBe(p.add.length);
    for (const table of ['events', 'sources'])
      expect(phone[table], table).toEqual(d.rows('pc', 'agenda')[table]);
    const first = phone.events!.find((e) => e.category === 'Examens')!;
    const day = String(first.start_at).slice(0, 10);
    const range = await d.onPhone<{ events: { id: string; source?: { name: string } }[] }>(
      'GET',
      `${API}/range?from=${day}&to=${day}`,
    );
    expect(range.events.find((e) => e.id === first.id)!.source!.name).toBe('Horaire ECAM');
  });

  it('v0.40.0: « facultatif » travels both ways', async () => {
    d = await devices();
    d.first('replace');
    const made = await d.onPc<{ id: string }>('POST', `${API}/events`, {
      title: 'Cours de thermo',
      start: '2026-12-01T08:15',
      end: '2026-12-01T10:00',
    });
    d.exchange();
    expect(d.rows('phone', 'agenda').events![0]!.optional).toBe(0);
    // Set on the PC → on the phone; the phone changes the room after: both kept.
    await d.onPc('PATCH', `${API}/events/${made.id}`, { optional: true });
    d.exchange();
    expect(d.rows('phone', 'agenda').events![0]!.optional).toBe(1);
    await d.onPhone('PATCH', `${API}/events/${made.id}`, { location: '2F51' });
    d.exchange();
    for (const side of ['pc', 'phone'] as const)
      expect(d.rows(side, 'agenda').events![0]).toMatchObject({ optional: 1, location: '2F51' });
    // Unset on the phone → on the PC.
    await d.onPhone('PATCH', `${API}/events/${made.id}`, { optional: false });
    d.exchange();
    expect(d.rows('pc', 'agenda').events![0]!.optional).toBe(0);
  });

  it('v0.42.0: a category created on the PC and a colour changed on the phone: on both', async () => {
    d = await devices();
    d.first('replace');
    await d.onPc('POST', `${API}/categories`, { name: 'Soirée', color: 'p:violet' });
    await d.onPc('POST', `${API}/events`, {
      title: 'Ciné',
      start: '2026-12-04T20:00',
      end: '2026-12-04T22:00',
      category: 'Soirée',
    });
    d.exchange();
    const onPhone = await d.onPhone<{ name: string; css: string; events: number }[]>(
      'GET',
      `${API}/categories`,
    );
    expect(onPhone.find((c) => c.name === 'Soirée')).toMatchObject({
      css: 'var(--hue-violet)',
      events: 1,
    });
    await d.onPhone('PATCH', `${API}/categories/Cours`, { color: 'p:bleu' });
    d.exchange();
    const onPc = await d.onPc<{ name: string; css: string }[]>('GET', `${API}/categories`);
    expect(onPc.find((c) => c.name === 'Cours')!.css).toBe('var(--hue-bleu)');
    expect(d.rows('phone', 'agenda').categories).toEqual(d.rows('pc', 'agenda').categories);
  });

  it('v0.42.0: a deadline made on the phone, ticked « faite » on the PC: on both', async () => {
    d = await devices();
    d.first('replace');
    const made = await d.onPhone<{ id: string; end: string; start: string }>(
      'POST',
      `${API}/events`,
      {
        title: 'Rendu rapport',
        start: '2026-12-03T23:59',
        category: 'Deadline',
      },
    );
    expect(made.end).toBe(made.start);
    d.exchange();
    await d.onPc('PATCH', `${API}/events/${made.id}`, { done: true });
    d.exchange();
    const onPhone = d.rows('phone', 'agenda').events!.find((e) => e.id === made.id)!;
    expect(onPhone.done_at).not.toBeNull();
    expect(d.rows('phone', 'agenda').events).toEqual(d.rows('pc', 'agenda').events);
  });
});
