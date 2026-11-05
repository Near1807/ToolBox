// Non-regression of the Sport module (step 2 of the phone version, ADR 0044):
// a realistic base built through the API on a frozen clock (Wednesday
// 2026-11-04, 10:00 local time), then the answers of every route (reads,
// writes, restores, exports, home card), the assistant's reading, the
// calendar and every stored row. The reference (fixtures/regression.json)
// was written by the v0.29.0 code, before the code was made portable: the
// same base must give exactly the same answers and the same data.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestHost,
  createTestHub,
  dumpTables,
  loadModuleFolder,
  readReference,
  referenceShape,
  type TestHub,
} from '@hub/sdk/testing';
import type { WeekDto } from '../shared/types';

const API = '/api/modules/sport';
const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
const NOW = new Date(2026, 10, 4, 10, 0, 0);

describe('non-regression of Sport (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.useRealTimers();
  });

  it('same answers of every route, same exports, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const out = mkdtempSync(path.join(os.tmpdir(), 'sport-reg-'));
    const saves: { name: string; data?: string }[] = [];
    let n = 0;
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({
        selectSaveFile: (o) => {
          saves.push({ name: path.basename(o.defaultPath ?? '') });
          return Promise.resolve(path.join(out, `export-${++n}`));
        },
      }),
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const steps: [string, unknown][] = [];
    const call = async <T>(method: string, url: string, body?: unknown) => {
      const r = await hub.request<T>(method, `${API}${url}`, body);
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
    for (const [i, s] of saves.entries())
      s.data = readFileSync(path.join(out, `export-${i + 1}`), 'utf8');
    // The assistant's reading and the calendar.
    const assistant = {
      session: await hub.hub.assistant.run('sport.today-session', {}),
      exercises: await hub.hub.assistant.run('sport.today-exercises', {}),
      week: await hub.hub.assistant.run('sport.week-summary', {}),
      done: await hub.hub.assistant.run('sport.session-done', {}),
    };
    const calendar = await hub.request('GET', '/api/core/calendar?from=2026-11-01&to=2026-11-15');

    const snapshot = referenceShape(
      {
        steps,
        saves,
        assistant,
        calendar: calendar.body,
        tables: dumpTables(hub.dataDir, 'sport'),
      },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
