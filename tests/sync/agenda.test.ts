// The Agenda over the synchronisation (v0.34.0): events, the week type and
// its exceptions travel like the other modules' rows; the same on both.
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
});
