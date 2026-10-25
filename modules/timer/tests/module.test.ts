// The Timer on a real hub (MODULES.md §8): sessions from real timestamps,
// phases, resume after the app was closed, the optional To-do (« Oui » ticks
// the task, absent = nothing blocked), voice commands and their switch.
import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { StateDto } from '../shared/types';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/timer';

async function open(
  options: { todo?: boolean; dataDir?: string; notes?: string[]; overlay?: boolean[] } = {},
) {
  const ids = options.todo === false ? ['timer'] : ['todo', 'timer'];
  return createTestHub({
    modules: await Promise.all(ids.map((id) => loadModuleFolder(path.join(MODULES, id)))),
    dataDir: options.dataDir,
    host: createTestHost({
      notify: (n) => options.notes?.push(n.title),
      setOverlayVisible: (visible) => options.overlay?.push(visible),
    }),
  });
}

/** Moves the session's clock back by `seconds` (as if that much real time had passed). */
function ago(dataDir: string, seconds: number) {
  const db = new Database(path.join(dataDir, 'hub.db'));
  const shift = (iso: string | null) =>
    iso === null ? null : new Date(Date.parse(iso) - seconds * 1000).toISOString();
  const rows = db.prepare('SELECT id, started_at, resumed_at FROM timer__sessions').all() as {
    id: number;
    started_at: string;
    resumed_at: string | null;
  }[];
  for (const r of rows)
    db.prepare('UPDATE timer__sessions SET started_at = ?, resumed_at = ? WHERE id = ?').run(
      shift(r.started_at),
      shift(r.resumed_at),
      r.id,
    );
  db.close();
}

describe('timer', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
  });
  const state = async () => (await hub.request<StateDto>('GET', `${API}/state`)).body;

  it('simple timer: start, pause, resume, stop → in the history', async () => {
    hub = await open();
    const started = await hub.request<{ status: string; phases: unknown[] }>(
      'POST',
      `${API}/start`,
      { config: { mode: 'simple', workMin: 27 } },
    );
    expect(started.body).toMatchObject({ status: 'running', name: 'Timer 27 min' });
    // Only one at a time.
    expect(
      (await hub.request('POST', `${API}/start`, { config: { mode: 'simple', workMin: 5 } }))
        .status,
    ).toBe(409);
    await hub.request('POST', `${API}/pause`);
    const paused = (await state()).session!;
    expect(paused.status).toBe('paused');
    // Paused: the time does not count.
    const frozen = paused.elapsed;
    await new Promise((r) => setTimeout(r, 120));
    expect((await state()).session!.elapsed).toBe(frozen);
    await hub.request('POST', `${API}/resume`);
    expect((await state()).session!.status).toBe('running');
    await hub.request('POST', `${API}/stop`);
    const after = await state();
    expect(after.session).toBeNull();
    expect(after.history[0]).toMatchObject({ name: 'Timer 27 min', completed: false });
  });

  it('announces each new phase when it starts (notification), the next work too', async () => {
    const notes: string[] = [];
    hub = await open({ notes });
    await hub.request('POST', `${API}/start`, {
      config: { mode: 'pomodoro', workMin: 1, breakMin: 1, cycles: 2 },
    });
    ago(hub.dataDir, 61);
    expect((await state()).session!.elapsed).toBeGreaterThan(60);
    expect(notes).toEqual(['Pause — 1 min']);
    await hub.request('POST', `${API}/skip`);
    await state();
    expect(notes).toEqual(['Pause — 1 min', 'Au travail — 1 min']);
    ago(hub.dataDir, 61);
    expect((await state()).session!.status).toBe('ended');
    expect(notes.at(-1)).toBe('Session terminée');
  });

  it('refuses an impossible program with the reason', async () => {
    hub = await open();
    const bad = await hub.request<{ error: string }>('POST', `${API}/start`, {
      config: { mode: 'pomodoro', workMin: 25, breakMin: 5 },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/cycles ou une durée totale/);
  });

  it('phases chain from the real time, and resume correctly after the app was closed', async () => {
    const notes: string[] = [];
    hub = await open({ notes });
    await hub.request('POST', `${API}/start`, {
      config: { mode: 'pomodoro', workMin: 25, breakMin: 5, cycles: 3 },
    });
    const dataDir = hub.dataDir;
    await hub.close({ keepData: true });
    // 31 minutes pass while ToolBox is closed: second work period, 1 min in.
    ago(dataDir, 31 * 60);
    hub = await open({ dataDir, notes });
    const s = (await state()).session!;
    expect(s.status).toBe('running');
    expect(Math.round(s.elapsed / 60)).toBe(31);
    // The transitions missed while closed are not notified afterwards.
    expect(notes).toEqual([]);
    // Skipping a break is refused during work; extending adds time to the phase.
    expect((await hub.request('POST', `${API}/skip`)).status).toBe(409);
    await hub.request('POST', `${API}/extend`, { minutes: 5 });
    expect((await state()).session!.phases[2]).toMatchObject({ kind: 'work', seconds: 30 * 60 });
    await hub.close({ keepData: true });
    // The whole session is over meanwhile: it waits for « Tâche terminée ? ».
    ago(dataDir, 3 * 3600);
    hub = await open({ dataDir, notes });
    const ended = (await state()).session!;
    expect(ended.status).toBe('ended');
    await hub.request('POST', `${API}/dismiss`);
    const done = await state();
    expect(done.session).toBeNull();
    expect(done.history[0]).toMatchObject({ completed: true, workSec: 80 * 60, taskDone: null });
  });

  it('linked to a To-do task: « Oui » ticks it (the user’s click), time per task', async () => {
    hub = await open();
    const task = (
      await hub.request<{ id: number }>('POST', '/api/modules/todo/tasks', {
        title: 'Finir le mix',
      })
    ).body;
    expect((await state()).tasks).toEqual([{ id: task.id, title: 'Finir le mix' }]);
    await hub.request('POST', `${API}/start`, {
      config: { mode: 'simple', workMin: 20 },
      taskId: task.id,
    });
    const dataDir = hub.dataDir;
    await hub.close({ keepData: true });
    ago(dataDir, 21 * 60);
    hub = await open({ dataDir });
    expect((await state()).session).toMatchObject({ status: 'ended', taskTitle: 'Finir le mix' });
    const answer = await hub.request<{ ticked: boolean }>('POST', `${API}/answer`, { done: true });
    expect(answer.body.ticked).toBe(true);
    const tasks = (
      await hub.request<{
        tasks: { id: number; done: boolean; timeSpent: number }[];
        timer: boolean;
      }>('GET', '/api/modules/todo/tasks')
    ).body;
    expect(tasks.timer).toBe(true);
    expect(tasks.tasks[0]).toMatchObject({ done: true, timeSpent: 20 * 60 });
    const s = await state();
    expect(s.perTask).toEqual([{ taskId: task.id, title: 'Finir le mix', seconds: 20 * 60 }]);
    expect(s.history[0]).toMatchObject({ taskDone: true, completed: true });
  });

  it('« Non » records the answer and leaves the task open', async () => {
    hub = await open();
    const task = (
      await hub.request<{ id: number }>('POST', '/api/modules/todo/tasks', { title: 'Bio' })
    ).body;
    await hub.request('POST', `${API}/start`, {
      config: { mode: 'simple', workMin: 5 },
      taskId: task.id,
    });
    const dataDir = hub.dataDir;
    await hub.close({ keepData: true });
    ago(dataDir, 6 * 60);
    hub = await open({ dataDir });
    await hub.request('POST', `${API}/answer`, { done: false });
    const tasks = (
      await hub.request<{ tasks: { done: boolean }[] }>('GET', '/api/modules/todo/tasks')
    ).body;
    expect(tasks.tasks[0]!.done).toBe(false);
    expect((await state()).history[0]).toMatchObject({ taskDone: false });
  });

  it('floating window: the question waits there, « Non » offers « Relancer », « Plus tard » closes', async () => {
    const overlay: boolean[] = [];
    hub = await open({ overlay });
    const task = (
      await hub.request<{ id: number }>('POST', '/api/modules/todo/tasks', { title: 'Mix' })
    ).body;
    // Mini-timer off: the window is asked for by the question only.
    await hub.request('PUT', '/api/core/settings/timer', { overlay: false });
    await hub.request('POST', `${API}/start`, {
      config: { mode: 'simple', workMin: 5 },
      taskId: task.id,
    });
    expect(overlay.at(-1) ?? false).toBe(false);
    ago(hub.dataDir, 6 * 60);
    const ended = await state();
    expect(ended.session).toMatchObject({ status: 'ended', taskTitle: 'Mix' });
    expect(ended.floating).toEqual({ timer: false, question: true, transitions: true });
    expect(overlay.at(-1)).toBe(true);
    // « Non »: nothing ticked, the session to restart waits (page and window).
    await hub.request('POST', `${API}/answer`, { done: false });
    const declined = await state();
    expect(declined.session).toBeNull();
    expect(declined.followUp).toMatchObject({ taskTitle: 'Mix' });
    expect(overlay.at(-1)).toBe(true);
    // « Relancer (même programme) » = the same /start, which clears it.
    await hub.request('POST', `${API}/start`, {
      config: declined.followUp!.config,
      name: declined.followUp!.name,
      taskId: declined.followUp!.taskId,
    });
    expect((await state()).followUp).toBeNull();
    ago(hub.dataDir, 6 * 60);
    expect((await state()).session!.status).toBe('ended');
    await hub.request('POST', `${API}/answer`, { done: false });
    // « Plus tard »: closed, the window is no longer asked for (mini-timer off).
    await hub.request('POST', `${API}/dismiss`);
    expect((await state()).followUp).toBeNull();
    expect(overlay.at(-1)).toBe(false);
    const tasks = (
      await hub.request<{ tasks: { done: boolean }[] }>('GET', '/api/modules/todo/tasks')
    ).body;
    expect(tasks.tasks[0]!.done).toBe(false);
  });

  it('floating window: off by setting, and phase changes shown briefly', async () => {
    const overlay: boolean[] = [];
    hub = await open({ overlay });
    await hub.request('PUT', '/api/core/settings/timer', {
      overlay: false,
      overlayQuestion: false,
      overlayTransitions: false,
    });
    await hub.request('POST', `${API}/start`, {
      config: { mode: 'pomodoro', workMin: 1, breakMin: 1, cycles: 2 },
    });
    ago(hub.dataDir, 61);
    await state();
    // Everything off: the window is never asked for.
    expect(overlay.filter(Boolean)).toEqual([]);
    await hub.request('PUT', '/api/core/settings/timer', { overlayTransitions: true });
    await hub.request('POST', `${API}/skip`);
    await state();
    // « Au travail — 1 min » for a few seconds: the window is asked for.
    expect(overlay.at(-1)).toBe(true);
  });

  it('works without the To-do: nothing blocked, no task to link', async () => {
    hub = await open({ todo: false });
    const s = await state();
    expect(s.todo).toBe(false);
    expect(s.presets.map((p) => p.name)).toEqual(['Pomodoro classique 25/5', 'Démarrage doux 2 h']);
    expect(
      (
        await hub.request('POST', `${API}/start`, {
          config: { mode: 'simple', workMin: 5 },
          taskId: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (await hub.request('POST', `${API}/start`, { config: { mode: 'simple', workMin: 5 } }))
        .status,
    ).toBe(200);
  });

  it('presets: saved, started by voice, deleted', async () => {
    hub = await open();
    const created = await hub.request<{ id: number }>('POST', `${API}/presets`, {
      name: 'Matin',
      config: { mode: 'incremental', startMin: 5, stepMin: 5, maxMin: 30, breakMin: 5, cycles: 4 },
    });
    expect(created.status).toBe(200);
    expect((await state()).presets.map((p) => p.name)).toContain('Matin');
    await hub.request('DELETE', `${API}/presets/${created.body.id}`);
    expect((await state()).presets.map((p) => p.name)).not.toContain('Matin');
  });

  describe('assistant', () => {
    const run = (id: string, params: object = {}) =>
      hub.hub.assistant.run(`timer.${id}`, params, { confirmed: false });

    it('reads the time left freely; driving needs its own switch, off by default', async () => {
      hub = await open();
      expect(await run('timer-status')).toMatchObject({
        status: 'done',
        message: 'Aucun timer en cours.',
      });
      expect(await run('start-timer', { minutes: 27 })).toMatchObject({
        status: 'forbidden',
        right: { id: 'timer.drive-timer' },
      });
      const right = hub.hub.assistant.rights().find((r) => r.id === 'timer.drive-timer')!;
      expect(right.granted).toBe(false);
      expect(right.actions).toEqual([
        'timer.start-timer',
        'timer.start-preset',
        'timer.pause-timer',
        'timer.resume-timer',
        'timer.stop-timer',
        'timer.skip-break',
      ]);
    });

    it('with the switch on: start on a task, pause, status, stop, undo', async () => {
      hub = await open();
      hub.hub.assistant.setRight('timer.drive-timer', true);
      await hub.request('POST', '/api/modules/todo/tasks', { title: 'Finir le mix' });
      const started = await run('start-timer', { minutes: 27, task: 'finir mix' });
      expect(started).toMatchObject({
        status: 'done',
        message: 'C’est parti : 27 min sur « Finir le mix ».',
      });
      expect(await run('pause-timer')).toMatchObject({ status: 'done' });
      expect(((await run('timer-status')) as { message: string }).message).toMatch(
        /^Il reste 27 min de travail \(en pause\)\.$/,
      );
      expect(await run('resume-timer')).toMatchObject({ status: 'done' });
      const stopped = (await run('stop-timer')) as { undoId: string };
      expect((await state()).session).toBeNull();
      await hub.hub.assistant.undo(stopped.undoId);
      expect((await state()).session).toMatchObject({ status: 'running' });
      // A task that does not exist is not guessed.
      await hub.request('POST', `${API}/stop`);
      expect(await run('start-timer', { minutes: 5, task: 'xylophone' })).toMatchObject({
        status: 'error',
      });
      expect(await run('start-preset', { preset: 'démarrage doux' })).toMatchObject({
        status: 'done',
      });
      expect((await state()).session).toMatchObject({ name: 'Démarrage doux 2 h' });
    });

    it('a preset is understood only by the name of one that exists', async () => {
      hub = await open();
      expect(
        await hub.hub.assistant.extract('timer.start-preset', 'lance mon démarrage doux'),
      ).toEqual({ preset: 'démarrage doux' });
      // Another module's command, not a preset.
      expect(
        await hub.hub.assistant.extract('timer.start-preset', 'lance la synchronisation des stats'),
      ).toBeNull();
    });

    it('ticking the task stays under the To-do’s own switch (never by the Timer’s)', async () => {
      hub = await open();
      hub.hub.assistant.setRight('timer.drive-timer', true);
      const names = hub.hub.assistant
        .list()
        .filter((a) => a.moduleId === 'timer')
        .map((a) => a.name);
      expect(names).not.toContain('complete-task');
      expect(hub.hub.assistant.rights().find((r) => r.id === 'todo.edit-tasks')?.granted).toBe(
        false,
      );
    });
  });
});
