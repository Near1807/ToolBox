// The scenario of the Sport module's non-regression reference
// (regression.test.ts), shared by the PC (better-sqlite3, Fastify) and the
// phone (sqlite-wasm, its mini router: regression-phone.test.ts) — the same
// requests, in the same order, on the same frozen clock.
import path from 'node:path';
import type { WeekDto } from '../shared/types';

export const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
export const NOW = new Date(2026, 10, 4, 10, 0, 0);
const API = '/api/modules/sport';

export interface ScenarioEnv {
  request<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }>;
}

/** Every request of the reference (the exports go through the platform's « Enregistrer sous »). */
export async function runScenario(env: ScenarioEnv) {
  const steps: [string, unknown][] = [];
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await env.request<T>(method, `${API}${url}`, body);
    // The export's path is in a temporary folder: only its name is compared.
    const answer = r.body as { path?: unknown } | null;
    const shown =
      answer && typeof answer.path === 'string'
        ? { ...answer, path: path.basename(answer.path) }
        : answer;
    steps.push([`${method} ${url}`, { status: r.status, body: shown }]);
    return r.body;
  };

  await call('GET', '/home');
  await call('PUT', '/template', {
    items: [
      {
        weekday: 1,
        name: 'Haut du corps',
        start: '18:30',
        durationMin: 75,
        exercises: [
          { name: 'Développé couché', sets: 4, reps: '8', load: '60 kg', restSec: 120 },
          { name: 'Tractions', sets: 3, reps: '6-8', load: '', restSec: 90 },
        ],
      },
      { weekday: 3, name: 'Course', start: '07:30', durationMin: 40, exercises: [] },
      {
        weekday: 5,
        name: 'Jambes',
        start: '18:00',
        durationMin: 60,
        exercises: [
          { name: 'Squat', sets: 5, reps: '5', load: '80 kg', restSec: 180 },
          { name: 'Fentes', sets: 3, reps: '10', load: '2 × 12 kg', restSec: 90 },
        ],
      },
    ],
  });
  const week = await call<WeekDto>('GET', '/week');
  const session = (weekday: number, i = 0) => week.days[weekday - 1]!.sessions[i]!;
  const monday = session(1);
  const wednesday = session(3);
  const friday = session(5);
  await call('GET', '/home');
  // Monday done, with the performance; Wednesday cancelled then back; Friday moved.
  await call('PATCH', `/sessions/${monday.id}`, {
    status: 'done',
    mood: 4,
    comment: 'Bonne séance ; un peu fatigué',
  });
  await call('PATCH', `/sessions/${monday.id}`, {
    exercises: monday.exercises.map((e, i) => ({ ...e, load: i === 0 ? '62,5 kg' : e.load })),
  });
  await call('PATCH', `/sessions/${wednesday.id}`, { status: 'cancelled' });
  await call('GET', '/home');
  await call('PATCH', `/sessions/${wednesday.id}`, { status: 'planned' });
  await call('PATCH', `/sessions/${friday.id}`, { date: '2026-11-07', start: '10:00' });
  // A one-off session, deleted then restored; one with a « " » in its name.
  const extra = await call<{ id: string }>('POST', '/sessions', {
    date: '2026-11-08',
    name: 'Vélo "long"',
    start: '09:00',
    durationMin: 120,
  });
  await call('DELETE', `/sessions/${extra.id}`);
  await call('POST', `/sessions/${extra.id}/restore`);
  // Exercises: one added, renamed, an unused one deleted and restored, two merged.
  const gainage = await call<{ id: string }>('POST', '/exercises', {
    name: 'Gainage',
    note: 'planche',
  });
  await call('PATCH', `/exercises/${gainage.id}`, { name: 'Gainage ventral', note: '3 × 1 min' });
  await call('DELETE', `/exercises/${gainage.id}`);
  await call('POST', `/exercises/${gainage.id}/restore`);
  const list = await call<{ exercises: { id: string; name: string }[] }>('GET', '/exercises');
  const id = (name: string) => list.exercises.find((e) => e.name === name)!.id;
  await call('DELETE', `/exercises/${id('Squat')}`); // used: refused (400)
  await call('POST', '/exercises/merge', { from: id('Fentes'), into: id('Squat') });
  // Errors keep their messages.
  await call('PATCH', '/sessions/00000000-0000-4000-8000-000000000000', { status: 'done' });
  await call('POST', '/sessions', { date: 'demain', name: '' });
  // Reads.
  await call('GET', '/week');
  await call('GET', '/week?start=2026-11-09');
  await call('GET', '/week?start=2026-10-26');
  await call('GET', '/month');
  await call('GET', '/month?month=2026-12');
  await call('GET', '/exercises');
  await call('GET', '/home');
  // Exports (CSV and Markdown), their contents.
  await call('POST', '/export', { format: 'csv', from: '2026-11-01', to: '2026-11-30' });
  await call('POST', '/export', { format: 'md', from: '2026-11-02', to: '2026-11-08' });
  const calendar = await env.request('GET', '/api/core/calendar?from=2026-11-01&to=2026-11-15');
  return { steps, calendar: calendar.body };
}
