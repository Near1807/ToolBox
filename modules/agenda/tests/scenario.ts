// The scenario of the Agenda's non-regression reference (regression.test.ts),
// shared by the PC (better-sqlite3, Fastify) and the phone (sqlite-wasm,
// its mini router: regression-phone.test.ts): the same requests, in the
// same order, on the same frozen clock (Thursday 12 November 2026, 10:00),
// with the To-do present (« à caser »).
import path from 'node:path';

export const MODULES = path.resolve(__dirname, '..', '..');
export const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
export const NOW = new Date(2026, 10, 12, 10, 0, 0);
const API = '/api/modules/agenda';

export interface ScenarioEnv {
  request<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }>;
  later(minutes: number): void;
}

export async function runScenario(env: ScenarioEnv) {
  const steps: [string, unknown][] = [];
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await env.request<T>(method, url.startsWith('/api') ? url : `${API}${url}`, body);
    steps.push([`${method} ${url}`, { status: r.status, body: r.body }]);
    return r.body;
  };
  const quick = (text: string) => call<Record<string, { id: string }>>('POST', '/quick', { text });

  // The bar: every example of the request.
  const dentist = (await quick('dentiste jeudi 14h 1h')).event!;
  await quick('réunion staff mardi 20h');
  const camp = (await quick('week-end scout 13-15 février')).event!;
  await quick('examen math 18 janvier #examens');
  const badminton = (await quick('badminton tous les jeudis 19h 2h #sport')).weekly!;
  await quick('préparer la réunion ~1h avant vendredi');
  await quick('acheter du pain');
  await quick('jeudi 14h'); // No title: refused.
  await quick('stage 15-13 février'); // The end before the start: refused.
  env.later(5);

  // The detailed form (never required) and its checks.
  const lunch = await call<{ id: string }>('POST', '/events', {
    title: 'Déjeuner avec Léa',
    start: '2026-11-18T12:30',
    end: '2026-11-18T14:00',
    location: 'Chez Léon',
    note: 'réserver',
    category: 'Perso',
  });
  await call('POST', '/events', { title: 'Sans fin', start: '2026-11-18T12:30' });
  await call('POST', '/events', {
    title: 'À l’envers',
    start: '2026-11-18T12:30',
    end: '2026-11-18T11:00',
  });
  await call('POST', '/events', {
    title: 'Vacances',
    allDay: true,
    start: '2026-12-21',
    end: '2026-12-31',
  });
  env.later(5);
  // Moved by an hour (same length), then renamed.
  await call('PATCH', `/events/${dentist.id}`, { start: '2026-11-19T15:00' });
  await call('PATCH', `/events/${dentist.id}`, { title: 'Dentiste (contrôle)' });
  await call('PATCH', `/events/${camp.id}`, { location: 'Spa' });

  // The week type: one occurrence cancelled, one moved, then brought back.
  await call('PUT', `/weekly/${badminton.id}/occurrences/2026-11-19`, { action: 'cancel' });
  await call('PUT', `/weekly/${badminton.id}/occurrences/2026-11-26`, {
    action: 'move',
    start: '2026-11-27T18:00',
    durationMin: 90,
  });
  await call('PUT', `/weekly/${badminton.id}/occurrences/2026-12-03`, { action: 'cancel' });
  await call('PUT', `/weekly/${badminton.id}/occurrences/2026-12-03`, { action: 'reset' });
  await call('PUT', `/weekly/${badminton.id}/occurrences/2026-11-26`, {
    action: 'move',
    start: '2026-12-20T18:00',
  }); // Too far: refused.
  const yoga = await call<{ id: string }>('POST', '/weekly', {
    title: 'Yoga',
    weekday: 0,
    time: '07:30',
    durationMin: 45,
    category: 'Loisirs',
    from: '2026-11-16',
    until: '2026-12-14',
  });
  await call('PATCH', `/weekly/${yoga.id}`, { time: '08:00' });
  await call('POST', '/weekly', { title: 'Mauvais', weekday: 9, time: '25:00', durationMin: 0 });
  env.later(5);

  // Deleted (a tombstone), then « Annuler ».
  await call('DELETE', `/events/${lunch.id}`);
  await call('POST', `/events/${lunch.id}/restore`);
  await call('DELETE', `/weekly/${yoga.id}`);

  // What the pages read: this week, next week, the month, the home card.
  await call('GET', '/range?from=2026-11-09&to=2026-11-15');
  await call('GET', '/range?from=2026-11-16&to=2026-11-22');
  await call('GET', '/range?from=2026-11-23&to=2026-11-29');
  await call('GET', '/range?from=2027-02-01&to=2027-02-28');
  await call('GET', '/range?from=2026-11-01&to=2027-03-01'); // Too long: refused.
  await call('GET', '/today');
  const calendar = await env.request('GET', '/api/core/calendar?from=2026-11-16&to=2026-11-22');
  return { steps, calendar: calendar.body };
}
