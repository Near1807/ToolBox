// Timer: a simple timer, pomodoro sessions and incremental pomodoros (short
// work periods first, longer later, constant breaks). The time is always
// computed from real timestamps (start, pauses), never from a counter: the
// session goes on while the page is closed and resumes correctly after the app
// was closed. The To-do is optional (task linked, « Tâche terminée ? »).
import {
  type AssistantParams,
  changesTableSql,
  defineBackendModule,
  type EventStream,
  HttpError,
  listPhrase,
  matchByName,
  type ModuleContext,
  NotFoundError,
  openEventStream,
  type MigrationDatabase,
  requestBody,
  type SettingValue,
  SYNC_COLUMNS,
  SyncStore,
  uuidParam,
} from '@hub/sdk/backend';
import type { TodoService } from '../../todo/contract';
import type { TimerService } from '../contract';
import {
  buildPlan,
  duration,
  normaliseConfig,
  PHASE_LABELS,
  phaseEnd,
  stateAt,
  workCount,
  workSeconds,
  type Phase,
  type PlanConfig,
} from '../shared/plan';
import type {
  HistoryDto,
  PresetDto,
  SessionDto,
  SessionStatus,
  StateDto,
  TransitionEvent,
  FloatingDto,
  LiveDto,
  ToastEvent,
} from '../shared/types';
import {
  extractPause,
  extractPreset,
  extractResume,
  extractSkip,
  extractStart,
  extractStatus,
  extractStop,
  PAUSE_EXAMPLES,
  PRESET_EXAMPLES,
  RESUME_EXAMPLES,
  SKIP_EXAMPLES,
  START_EXAMPLES,
  STATUS_EXAMPLES,
  STOP_EXAMPLES,
} from './commands';

interface SessionRow {
  id: string;
  mode: PlanConfig['mode'];
  name: string;
  config: string;
  phases: string;
  /** A task of the To-do (its UUID), or null. */
  task_id: string | null;
  task_title: string | null;
  /** running · paused · ended (waiting for the answer) · done · stopped */
  status: SessionStatus | 'done' | 'stopped';
  started_at: string;
  /** While running: when the time last started to count. */
  resumed_at: string | null;
  /** Active seconds counted before `resumed_at`. */
  elapsed_before: number;
  /** Index of the phase last announced (no double notification). */
  last_index: number;
  ended_at: string | null;
  work_sec: number | null;
  answer: 'yes' | 'no' | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Its number before v0.25 (migration 2), null for a session started since. */
  legacy_id: number | null;
}

interface PresetRow {
  id: string;
  name: string;
  config: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  legacy_id: number | null;
}

const ACTIVE = "('running', 'paused', 'ended')";
/** A transition announced more than this late (app closed meanwhile) is not notified. */
const LATE_NOTIFY_MS = 60_000;
/** How long a phase change stays in the floating window. */
const TOAST_MS = 5_000;
const MAX_HISTORY = 50;
const DEFAULT_PRESETS: { name: string; config: PlanConfig }[] = [
  {
    name: 'Pomodoro classique 25/5',
    config: {
      mode: 'pomodoro',
      workMin: 25,
      breakMin: 5,
      cycles: 4,
      totalMin: null,
      longBreakMin: 15,
      longBreakEvery: 4,
    },
  },
  {
    name: 'Démarrage doux 2 h',
    config: {
      mode: 'incremental',
      startMin: 5,
      stepMin: 3,
      stepPct: null,
      maxMin: 25,
      breakMin: 5,
      cycles: null,
      totalMin: 120,
    },
  },
];

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'sessions and presets',
      up: `
        CREATE TABLE timer__sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mode TEXT NOT NULL,
          name TEXT NOT NULL,
          config TEXT NOT NULL,
          phases TEXT NOT NULL,
          task_id INTEGER,
          task_title TEXT,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          resumed_at TEXT,
          elapsed_before REAL NOT NULL DEFAULT 0,
          last_index INTEGER NOT NULL DEFAULT 0,
          ended_at TEXT,
          work_sec REAL,
          answer TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX timer__sessions_task ON timer__sessions (task_id);
        CREATE TABLE timer__presets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          config TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        ${DEFAULT_PRESETS.map(
          (p) =>
            `INSERT INTO timer__presets (name, config, created_at) VALUES ('${p.name.replace(/'/g, "''")}', '${JSON.stringify(p.config)}', '2026-10-24T00:00:00.000Z');`,
        ).join('\n')}
      `,
    },
    {
      version: 2,
      description: 'ready for sync: UUIDs, dates, tombstones, journal (old tables kept)',
      up: (db) => migrateToSync(db),
    },
  ],

  register(ctx: ModuleContext) {
    const sessions = ctx.db.table('sessions');
    const presets = ctx.db.table('presets');
    const store = new SyncStore(ctx.db);
    // Optional both ways with the To-do: asked at the time of use (MODULES.md §5.8).
    const todo = () => ctx.services.optional<TodoService>('todo');
    const streams = new Set<EventStream>();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    /**
     * After « Non » to « Tâche terminée ? »: « Relancer (même programme) » or
     * « Plus tard » waits on the page and in the floating window (memory only:
     * a restart of the app counts as « Plus tard »).
     */
    let followUp: SessionDto | null = null;
    /** The last « Oui, la cocher » (for « Annuler »). */
    let lastTick: { sessionId: string; taskId: string; wasDone: boolean } | null = null;
    /** A phase change shown briefly in the floating window, until this time. */
    let toastUntil = 0;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    const setting = <T extends SettingValue>(key: string, fallback: T): T =>
      ctx.settings.get<T>(key) ?? fallback;
    const sound = () => setting<string>('sound', 'bell');
    const volume = () => setting<number>('volume', 70);

    // --- Sessions -------------------------------------------------------------

    const active = (): SessionRow | null =>
      (ctx.db
        .prepare(
          `SELECT * FROM ${sessions} WHERE status IN ${ACTIVE} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        )
        .get() as SessionRow | undefined) ?? null;
    const byId = (id: string) =>
      ctx.db.prepare(`SELECT * FROM ${sessions} WHERE id = ?`).get(id) as SessionRow | undefined;
    const phasesOf = (row: SessionRow) => JSON.parse(row.phases) as Phase[];
    const elapsedOf = (row: SessionRow, now = Date.now()) =>
      row.elapsed_before +
      (row.status === 'running' && row.resumed_at
        ? Math.max(0, (now - Date.parse(row.resumed_at)) / 1000)
        : 0);
    /** Writes (and journals) these fields of a session. */
    const set = (id: string, fields: Partial<SessionRow>) => {
      store.update('sessions', id, fields as Record<string, string | number | null>);
    };

    const sessionDto = (row: SessionRow): SessionDto => ({
      id: row.id,
      mode: row.mode,
      name: row.name,
      config: JSON.parse(row.config) as PlanConfig,
      phases: phasesOf(row),
      status: row.status as SessionStatus,
      taskId: row.task_id,
      taskTitle: row.task_title,
      startedAt: row.started_at,
      elapsed: elapsedOf(row),
      at: new Date().toISOString(),
    });

    const historyDto = (row: SessionRow): HistoryDto => ({
      id: row.id,
      name: row.name,
      mode: row.mode,
      taskId: row.task_id,
      taskTitle: row.task_title,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      workSec: row.work_sec ?? 0,
      plannedWorkSec: workSeconds(phasesOf(row)),
      completed: row.status === 'done',
      taskDone: row.answer === 'yes' ? true : row.answer === 'no' ? false : null,
    });

    const presetList = (): PresetDto[] =>
      (
        ctx.db
          .prepare(
            `SELECT * FROM ${presets} WHERE deleted_at IS NULL ORDER BY created_at, legacy_id, id`,
          )
          .all() as PresetRow[]
      ).map((p) => ({ id: p.id, name: p.name, config: JSON.parse(p.config) as PlanConfig }));

    const timeByTask = (): Record<string, number> => {
      const rows = ctx.db
        .prepare(
          `SELECT task_id, SUM(work_sec) AS seconds FROM ${sessions} WHERE task_id IS NOT NULL AND work_sec IS NOT NULL AND deleted_at IS NULL GROUP BY task_id`,
        )
        .all() as { task_id: string; seconds: number }[];
      return Object.fromEntries(rows.map((r) => [r.task_id, r.seconds]));
    };

    // --- Live updates: page, home widget, floating indicator --------------------

    const broadcast = (event: string, data: unknown) => {
      for (const stream of streams) stream.send(event, data);
    };
    /** What the floating window shows (settings of the module). */
    const floating = (): FloatingDto => ({
      timer: setting<boolean>('overlay', true),
      question: setting<boolean>('overlayQuestion', true),
      transitions: setting<boolean>('overlayTransitions', true),
    });
    const liveDto = (): LiveDto => {
      const row = active();
      return { session: row ? sessionDto(row) : null, followUp, floating: floating() };
    };
    /** The floating window is asked for while it has something to show. */
    const overlayWanted = () => {
      const row = active();
      const f = floating();
      if (Date.now() < toastUntil) return true;
      if (followUp) return f.question;
      if (!row) return false;
      return f.timer || (row.status === 'ended' && f.question);
    };
    const publish = () => {
      broadcast('session', liveDto());
      ctx.ui.setOverlay(overlayWanted());
    };
    /** A short message shown a few seconds in the floating window (and on the page). */
    const toast = (label: string, tone: ToastEvent['tone']) => {
      broadcast('toast', { label, tone } satisfies ToastEvent);
      toastUntil = Date.now() + TOAST_MS;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastTimer = null;
        publish();
      }, TOAST_MS + 100);
    };
    const announce = (kind: TransitionEvent['kind'], seconds: number | null = null) => {
      broadcast('transition', { kind, sound: sound(), volume: volume() } satisfies TransitionEvent);
      // The end has its own question; the phase changes are shown if wanted.
      if (kind !== null && floating().transitions)
        toast(
          `${kind === 'work' ? 'Au travail' : PHASE_LABELS[kind]} — ${duration(seconds ?? 0)}`,
          kind === 'work' ? 'work' : 'break',
        );
    };
    const notify = (title: string, body: string) => {
      if (setting<boolean>('notify', true)) ctx.notifications.notify({ title, body, path: '' });
    };

    /** Finishes a session: every phase ran (« ended », the question waits) or stopped early. */
    const finish = (row: SessionRow, how: 'ended' | 'stopped', now = Date.now()) => {
      const phases = phasesOf(row);
      const state = stateAt(phases, elapsedOf(row, now));
      // The real end time (the app may have been closed when it happened).
      const overrun = how === 'ended' ? Math.max(0, elapsedOf(row, now) - state.elapsed) : 0;
      set(row.id, {
        status: how,
        resumed_at: null,
        elapsed_before: state.elapsed,
        last_index: phases.length,
        ended_at: new Date(now - overrun * 1000).toISOString(),
        work_sec: state.workDone,
      });
    };

    /**
     * Brings the running session up to date: announces a new phase (sound,
     * notification), ends it when the last phase is over, and sets the next
     * wake-up. Called on every change and by its own timeout.
     */
    const tick = (announceLate = false) => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
      const row = active();
      if (!row || row.status !== 'running') return;
      const now = Date.now();
      const phases = phasesOf(row);
      const elapsed = elapsedOf(row, now);
      const state = stateAt(phases, elapsed);
      if (state.ended) {
        finish(row, 'ended', now);
        const late = (elapsed - state.elapsed) * 1000 > LATE_NOTIFY_MS;
        if (!late || announceLate) {
          announce(null);
          notify(
            'Session terminée',
            row.task_title
              ? `« ${row.task_title} » : ${duration(workSeconds(phases))} de travail. Tâche terminée ?`
              : `${duration(workSeconds(phases))} de travail.`,
          );
        }
        publish();
        return;
      }
      if (state.index !== row.last_index) {
        set(row.id, { last_index: state.index });
        const lateMs = (elapsed - (phaseEnd(phases, state.index - 1) || 0)) * 1000;
        if (lateMs <= LATE_NOTIFY_MS || announceLate) {
          announce(state.phase!.kind, state.phase!.seconds);
          const work = phases.slice(0, state.index + 1).filter((p) => p.kind === 'work').length;
          notify(
            state.phase!.kind === 'work'
              ? `Au travail — ${duration(state.phase!.seconds)}`
              : `${PHASE_LABELS[state.phase!.kind]} — ${duration(state.phase!.seconds)}`,
            state.phase!.kind === 'work'
              ? `Période ${work} sur ${workCount(phases)}${row.task_title ? ` · ${row.task_title}` : ''}`
              : `Période ${work} sur ${workCount(phases)} terminée.`,
          );
        }
        publish();
      }
      // Wakes up at the end of the phase (at most every minute, in case the clock jumps).
      const wait = Math.min(60_000, Math.max(200, state.remaining * 1000 + 50));
      timeout = setTimeout(() => tick(), wait);
    };

    const requireActive = (statuses: SessionStatus[] = ['running', 'paused']) => {
      const row = active();
      if (!row || !statuses.includes(row.status as SessionStatus))
        throw new HttpError(409, 'Aucun timer en cours.');
      return row;
    };

    /** Closes a session that ended and waits for its question (no answer). */
    const dismissEnded = () => {
      const row = active();
      if (row?.status === 'ended') set(row.id, { status: 'done' });
    };

    const taskFrom = (value: unknown): { id: string; title: string } | null => {
      if (value === null || value === undefined || value === '') return null;
      const service = todo();
      if (!service) throw new HttpError(409, 'La To-do n’est pas disponible : pas de tâche liée.');
      const task = service.getTask(String(value));
      if (!task) throw new HttpError(404, 'Tâche introuvable');
      return { id: task.id, title: task.title };
    };

    const start = (
      config: PlanConfig,
      name: string | null,
      task: { id: string; title: string } | null,
    ): SessionRow => {
      const running = active();
      if (running && running.status !== 'ended')
        throw new HttpError(409, 'Un timer est déjà en cours : arrête-le d’abord.');
      dismissEnded();
      followUp = null;
      lastTick = null;
      let normal: PlanConfig;
      let phases: Phase[];
      try {
        normal = normaliseConfig(config);
        phases = buildPlan(normal);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      if (phases.length === 0) throw new HttpError(400, 'Programme vide');
      const now = new Date().toISOString();
      const label =
        name?.trim().slice(0, 80) ||
        (normal.mode === 'simple'
          ? `Timer ${duration(phases[0]!.seconds)}`
          : normal.mode === 'pomodoro'
            ? `Pomodoro ${normal.workMin}/${normal.breakMin}`
            : `Pomodoro incrémental ${normal.startMin} → ${normal.maxMin} min`);
      const row = store.create<SessionRow>('sessions', {
        mode: normal.mode,
        name: label,
        config: JSON.stringify(normal),
        phases: JSON.stringify(phases),
        task_id: task?.id ?? null,
        task_title: task?.title ?? null,
        status: 'running',
        started_at: now,
        resumed_at: now,
        elapsed_before: 0,
        last_index: 0,
        legacy_id: null,
      });
      ctx.logger.info(`Timer lancé : ${label}${task ? ` (tâche « ${task.title} »)` : ''}`);
      tick();
      publish();
      return row;
    };

    const pause = () => {
      const row = requireActive(['running']);
      set(row.id, { status: 'paused', elapsed_before: elapsedOf(row), resumed_at: null });
      tick();
      publish();
      return row;
    };
    const resume = () => {
      const row = requireActive(['paused']);
      set(row.id, { status: 'running', resumed_at: new Date().toISOString() });
      tick();
      publish();
      return row;
    };
    const stop = () => {
      const row = requireActive();
      finish(row, 'stopped');
      tick();
      publish();
      return row;
    };
    /** Skips the break in progress: the next work period starts now. */
    const skip = () => {
      const row = requireActive();
      const phases = phasesOf(row);
      const state = stateAt(phases, elapsedOf(row));
      if (!state.phase || state.phase.kind === 'work')
        throw new HttpError(409, 'Pas de pause en cours.');
      set(row.id, {
        elapsed_before: phaseEnd(phases, state.index),
        ...(row.status === 'running' ? { resumed_at: new Date().toISOString() } : {}),
      });
      tick();
      publish();
    };
    /** Makes the phase in progress longer. */
    const extend = (minutes: number) => {
      const row = requireActive();
      const phases = phasesOf(row);
      const state = stateAt(phases, elapsedOf(row));
      if (!state.phase) throw new HttpError(409, 'Aucune phase en cours.');
      phases[state.index] = { ...state.phase, seconds: state.phase.seconds + minutes * 60 };
      set(row.id, { phases: JSON.stringify(phases) });
      tick();
      publish();
    };

    // Resume after a restart: catch up with the real time (transitions missed
    // while the app was closed are not notified).
    tick();
    if (active()) ctx.ui.setOverlay(overlayWanted());
    // A switch of the floating window changed: shown or hidden at once.
    const offSettings = ctx.settings.onChange((key) => {
      if (key.startsWith('overlay')) publish();
    });
    ctx.onShutdown(() => {
      if (timeout) clearTimeout(timeout);
      if (toastTimer) clearTimeout(toastTimer);
      offSettings();
      for (const stream of streams) stream.close();
    });

    // --- Routes ---------------------------------------------------------------

    ctx.routes.get('/state', (): StateDto => {
      tick();
      const service = todo();
      const rows = ctx.db
        .prepare(
          `SELECT * FROM ${sessions} WHERE status IN ('done', 'stopped') AND deleted_at IS NULL ORDER BY created_at DESC, legacy_id DESC LIMIT ?`,
        )
        .all(MAX_HISTORY) as SessionRow[];
      const totals = ctx.db
        .prepare(
          `SELECT task_id, MAX(task_title) AS title, SUM(work_sec) AS seconds FROM ${sessions} WHERE task_id IS NOT NULL AND work_sec IS NOT NULL AND deleted_at IS NULL GROUP BY task_id ORDER BY seconds DESC`,
        )
        .all() as { task_id: string; title: string; seconds: number }[];
      return {
        ...liveDto(),
        presets: presetList(),
        todo: Boolean(service),
        tasks: service?.listOpenTasks().map((t) => ({ id: t.id, title: t.title })) ?? [],
        history: rows.map(historyDto),
        perTask: totals.map((t) => ({
          taskId: t.task_id,
          title: service?.getTask(t.task_id)?.title ?? t.title,
          seconds: t.seconds,
        })),
        settings: { sound: sound(), volume: volume() },
      };
    });

    ctx.routes.post('/start', (request) => {
      const body = requestBody(request);
      const row = start(
        body.config as PlanConfig,
        typeof body.name === 'string' ? body.name : null,
        taskFrom(body.taskId),
      );
      return sessionDto(byId(row.id)!);
    });
    ctx.routes.post('/pause', () => (pause(), { ok: true }));
    ctx.routes.post('/resume', () => (resume(), { ok: true }));
    ctx.routes.post('/stop', () => (stop(), { ok: true }));
    ctx.routes.post('/skip', () => (skip(), { ok: true }));
    ctx.routes.post('/extend', (request) => {
      const minutes = Number(requestBody(request).minutes ?? 5);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120)
        throw new HttpError(400, 'Durée invalide');
      extend(Math.round(minutes));
      return { ok: true };
    });

    /**
     * « Tâche terminée ? » after a session (the user's click): « Oui » ticks
     * the task in the To-do; « Non » only records the answer.
     */
    ctx.routes.post('/answer', (request) => {
      const done = requestBody(request).done === true;
      const row = requireActive(['ended']);
      let ticked = false;
      lastTick = null;
      if (done && row.task_id !== null) {
        const service = todo();
        if (!service) throw new HttpError(409, 'La To-do n’est pas disponible : rien n’est coché.');
        const task = service.getTask(row.task_id);
        if (task) {
          service.completeTask(row.task_id);
          ticked = true;
          lastTick = { sessionId: row.id, taskId: row.task_id, wasDone: task.done };
        }
      }
      set(row.id, { status: 'done', answer: done ? 'yes' : 'no' });
      // « Non »: the task is not finished, « Relancer » is offered.
      followUp = !done && row.task_id !== null ? sessionDto(row) : null;
      if (ticked) toast(`Tâche cochée dans la To-do : ${row.task_title ?? ''}`, 'done');
      publish();
      return { ok: true, ticked };
    });
    /**
     * « Annuler » after « Oui, la cocher »: the task is unticked (unless it
     * was already done before) and the question comes back. Only for the
     * last answer, before another session starts.
     */
    ctx.routes.post('/answer/undo', () => {
      const tick = lastTick;
      if (!tick) throw new HttpError(409, 'Plus rien à annuler.');
      if (active()) throw new HttpError(409, 'Une autre session a commencé : rien n’est annulé.');
      const service = todo();
      if (!service) throw new HttpError(409, 'La To-do n’est pas disponible : rien n’est décoché.');
      if (!tick.wasDone && service.getTask(tick.taskId)) service.uncompleteTask(tick.taskId);
      lastTick = null;
      set(tick.sessionId, { status: 'ended', answer: null });
      followUp = null;
      publish();
      return { ok: true };
    });
    /** « Plus tard » / « Fermer »: the ended session goes to the history without answer. */
    ctx.routes.post('/dismiss', () => {
      dismissEnded();
      followUp = null;
      publish();
      return { ok: true };
    });

    ctx.routes.post('/presets', (request) => {
      const body = requestBody(request);
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      if (!name) throw new HttpError(400, 'Donne un nom au préréglage');
      let config: PlanConfig;
      try {
        config = normaliseConfig(body.config as PlanConfig);
        buildPlan(config);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      const row = store.create<PresetRow>('presets', {
        name,
        config: JSON.stringify(config),
        legacy_id: null,
      });
      return { id: row.id };
    });
    // Deleted only from the page, after the user's confirmation (a tombstone).
    ctx.routes.delete('/presets/:id', (request) => {
      const id = uuidParam(request.params);
      if (store.get('presets', id)) store.remove('presets', id);
      return { ok: true };
    });

    ctx.routes.get(
      '/events',
      (request, reply) => {
        const stream = openEventStream(request, reply);
        streams.add(stream);
        stream.onClose(() => streams.delete(stream));
        stream.send('session', liveDto());
      },
      { streamTicket: true },
    );

    // --- Service for the To-do --------------------------------------------------

    ctx.services.provide<TimerService>('timer', {
      timeByTask,
      current: () => {
        const row = active();
        if (!row) return null;
        const state = stateAt(phasesOf(row), elapsedOf(row));
        return { taskId: row.task_id, phase: state.phase?.kind ?? null };
      },
    });

    // --- Assistant actions (MODULES.md §5.15) ------------------------------------

    const RIGHT = { id: 'drive-timer', label: 'L’assistant peut piloter le timer' };

    const findTask = (name: string) => {
      const service = todo();
      if (!service)
        throw new HttpError(409, 'La To-do n’est pas disponible : je ne peux pas lier de tâche.');
      const match = matchByName(service.listOpenTasks(), name, (t) => t.title);
      if (match.kind === 'none')
        throw new NotFoundError(
          'task',
          'de tâche à faire qui ressemble à',
          name,
          match.suggestions.map((t) => t.title),
        );
      if (match.kind === 'ambiguous')
        throw new HttpError(
          409,
          `Plusieurs tâches correspondent : ${listPhrase(match.items.slice(0, 4).map((t) => `« ${t.title} »`))}. Laquelle ?`,
        );
      return { id: match.item.id, title: match.item.title };
    };

    /** « Annuler » of a start by the assistant: the session goes (a tombstone). */
    const removeSession = (id: string) => {
      store.remove('sessions', id);
      tick();
      publish();
    };

    const describe = (): string => {
      const row = active();
      if (!row) return 'Aucun timer en cours.';
      if (row.status === 'ended')
        return `La session « ${row.name} » est terminée${row.task_title ? ` : la tâche « ${row.task_title} » est-elle terminée ? Réponds sur la page du timer` : ''}.`;
      const phases = phasesOf(row);
      const state = stateAt(phases, elapsedOf(row));
      const what = state.phase ? PHASE_LABELS[state.phase.kind].toLowerCase() : 'session';
      const paused = row.status === 'paused' ? ' (en pause)' : '';
      const total =
        phases.length > 1 ? ` ; ${duration(state.remainingTotal)} pour toute la session` : '';
      return `Il reste ${duration(state.remaining)} de ${what}${paused}${total}.`;
    };

    ctx.assistant.define({
      name: 'timer-status',
      label: 'Temps restant du timer',
      examples: STATUS_EXAMPLES,
      extract: extractStatus,
      description: 'Dit le temps restant du timer en cours (phase et session).',
      risk: 'read',
      run: () => ({ message: describe() }),
    });

    ctx.assistant.define({
      name: 'start-timer',
      label: 'Lancer un timer',
      examples: START_EXAMPLES,
      extract: extractStart,
      right: RIGHT,
      description:
        'Lance un timer simple de N minutes, lié si demandé à une tâche de la To-do (par son titre approximatif).',
      parameters: {
        minutes: { type: 'number', description: 'Durée en minutes, ex. 27' },
        task: {
          type: 'string',
          description: 'Tâche de la To-do, ex. « finir le mix ». Absent si aucune.',
        },
      },
      required: ['minutes'],
      risk: 'change',
      run: (params: AssistantParams) => {
        const task = params.task ? findTask(String(params.task)) : null;
        const row = start({ mode: 'simple', workMin: Number(params.minutes) }, null, task);
        return {
          message: `C’est parti : ${duration(workSeconds(phasesOf(row)))}${task ? ` sur « ${task.title} »` : ''}.`,
          data: { id: row.id },
          undo: () => removeSession(row.id),
        };
      },
    });

    ctx.assistant.define({
      name: 'start-preset',
      label: 'Lancer un préréglage du timer',
      examples: PRESET_EXAMPLES,
      // Only the name of a preset that exists (« lance la synchronisation des
      // stats » is another module's command, not a preset).
      extract: (utterance) => {
        const params = extractPreset(utterance);
        if (!params) return null;
        const match = matchByName(presetList(), String(params.preset), (p) => p.name);
        return match.kind === 'match' ? params : null;
      },
      right: RIGHT,
      description:
        'Lance une session enregistrée (préréglage) par son nom, ex. « démarrage doux ».',
      parameters: { preset: { type: 'string', description: 'Nom du préréglage' } },
      required: ['preset'],
      risk: 'change',
      run: (params) => {
        const match = matchByName(presetList(), String(params.preset), (p) => p.name);
        if (match.kind === 'none')
          throw new NotFoundError(
            'preset',
            'le préréglage',
            String(params.preset),
            match.suggestions.map((p) => p.name),
          );
        if (match.kind === 'ambiguous')
          throw new HttpError(
            409,
            `Plusieurs préréglages correspondent : ${listPhrase(match.items.map((p) => `« ${p.name} »`))}. Lequel ?`,
          );
        const row = start(match.item.config, match.item.name, null);
        const phases = phasesOf(row);
        return {
          message: `C’est parti : « ${match.item.name} », ${workCount(phases)} période${workCount(phases) > 1 ? 's' : ''} de travail, ${duration(phases.reduce((s, p) => s + p.seconds, 0))} en tout.`,
          data: { id: row.id },
          undo: () => removeSession(row.id),
        };
      },
    });

    ctx.assistant.define({
      name: 'pause-timer',
      label: 'Mettre le timer en pause',
      examples: PAUSE_EXAMPLES,
      extract: extractPause,
      right: RIGHT,
      description: 'Met le timer en cours en pause.',
      risk: 'change',
      run: () => {
        pause();
        return { message: 'Timer en pause.', undo: () => void resume() };
      },
    });

    ctx.assistant.define({
      name: 'resume-timer',
      label: 'Reprendre le timer',
      examples: RESUME_EXAMPLES,
      extract: extractResume,
      right: RIGHT,
      description: 'Reprend le timer mis en pause.',
      risk: 'change',
      run: () => {
        resume();
        return { message: 'C’est reparti.', undo: () => void pause() };
      },
    });

    ctx.assistant.define({
      name: 'stop-timer',
      label: 'Arrêter le timer',
      examples: STOP_EXAMPLES,
      extract: extractStop,
      right: RIGHT,
      description: 'Arrête le timer en cours (la session va dans l’historique).',
      risk: 'change',
      run: () => {
        const before = requireActive();
        stop();
        return {
          message: `Timer arrêté : ${duration(byId(before.id)?.work_sec ?? 0)} de travail enregistrées.`,
          // « Annuler » brings the session back exactly as it was.
          undo: () => {
            const sync = ['id', 'created_at', 'updated_at', 'deleted_at', 'legacy_id'];
            set(
              before.id,
              Object.fromEntries(Object.entries(before).filter(([key]) => !sync.includes(key))),
            );
            tick();
            publish();
          },
        };
      },
    });

    ctx.assistant.define({
      name: 'skip-break',
      label: 'Passer la pause',
      examples: SKIP_EXAMPLES,
      extract: extractSkip,
      right: RIGHT,
      description: 'Passe la pause en cours : la période de travail suivante commence.',
      risk: 'change',
      run: () => {
        skip();
        return { message: 'Pause passée, au travail.' };
      },
    });
  },
});

/**
 * Migration 2 (v0.25): sessions and presets get a UUID, a tombstone and a
 * journal (« Prêt pour la synchro », MODULES.md §6 bis). The old tables stay
 * as `sessions_v1` and `presets_v1`, untouched. Each row is copied with the
 * same values; its new id is `legacyId('timer:session' | 'timer:preset', n)`,
 * and the task it worked on becomes `legacyId('todo:task', n)`: the To-do
 * gives that same UUID to its task n (todo/backend, migration 2), so the
 * time per task and « Tâche terminée ? » stay on the right task. Old → new
 * pairs in `legacy_ids`.
 */
export function migrateToSync(db: MigrationDatabase): void {
  const sessions = db.table('sessions');
  const presets = db.table('presets');
  const legacy = db.table('legacy_ids');
  const journal = db.table('changes');
  db.exec(`
    ALTER TABLE ${sessions} RENAME TO ${sessions}_v1;
    ALTER TABLE ${presets} RENAME TO ${presets}_v1;
    DROP INDEX IF EXISTS ${sessions}_task;
    CREATE INDEX ${sessions}_v1_task ON ${sessions}_v1 (task_id);
    CREATE TABLE ${sessions} (
      ${SYNC_COLUMNS},
      mode TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      phases TEXT NOT NULL,
      task_id TEXT,
      task_title TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      resumed_at TEXT,
      elapsed_before REAL NOT NULL DEFAULT 0,
      last_index INTEGER NOT NULL DEFAULT 0,
      ended_at TEXT,
      work_sec REAL,
      answer TEXT,
      legacy_id INTEGER
    );
    CREATE INDEX ${sessions}_task ON ${sessions} (task_id);
    CREATE INDEX ${sessions}_status ON ${sessions} (status);
    CREATE TABLE ${presets} (
      ${SYNC_COLUMNS},
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      legacy_id INTEGER
    );
    ${changesTableSql(journal)}
    CREATE TABLE ${legacy} (
      entity TEXT NOT NULL,
      old_id INTEGER NOT NULL,
      new_id TEXT NOT NULL,
      PRIMARY KEY (entity, old_id)
    );
  `);
  const pair = db.prepare(`INSERT INTO ${legacy} (entity, old_id, new_id) VALUES (?, ?, ?)`);
  const log = db.prepare(
    `INSERT INTO ${journal} (id, at, entity, entity_id, op, data) VALUES (?, ?, ?, ?, 'create', ?)`,
  );
  type OldSession = Omit<
    SessionRow,
    'id' | 'task_id' | 'updated_at' | 'deleted_at' | 'legacy_id'
  > & {
    id: number;
    task_id: number | null;
  };
  const insertSession = db.prepare(
    `INSERT INTO ${sessions} (id, created_at, updated_at, deleted_at, mode, name, config, phases, task_id, task_title, status, started_at, resumed_at, elapsed_before, last_index, ended_at, work_sec, answer, legacy_id) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of db.prepare(`SELECT * FROM ${sessions}_v1 ORDER BY id`).all() as OldSession[]) {
    const id = db.legacyId('timer:session', r.id);
    const taskId = r.task_id === null ? null : db.legacyId('todo:task', r.task_id);
    const updated = r.ended_at ?? r.resumed_at ?? r.created_at;
    const fields = {
      mode: r.mode,
      name: r.name,
      config: r.config,
      phases: r.phases,
      task_id: taskId,
      task_title: r.task_title,
      status: r.status,
      started_at: r.started_at,
      resumed_at: r.resumed_at,
      elapsed_before: r.elapsed_before,
      last_index: r.last_index,
      ended_at: r.ended_at,
      work_sec: r.work_sec,
      answer: r.answer,
    };
    insertSession.run(id, r.created_at, updated, ...Object.values(fields), r.id);
    pair.run('sessions', r.id, id);
    log.run(
      db.legacyId('timer:journal:session', r.id),
      updated,
      'sessions',
      id,
      JSON.stringify(fields),
    );
  }
  const insertPreset = db.prepare(
    `INSERT INTO ${presets} (id, created_at, updated_at, deleted_at, name, config, legacy_id) VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  );
  for (const r of db.prepare(`SELECT * FROM ${presets}_v1 ORDER BY id`).all() as {
    id: number;
    name: string;
    config: string;
    created_at: string;
  }[]) {
    const id = db.legacyId('timer:preset', r.id);
    insertPreset.run(id, r.created_at, r.created_at, r.name, r.config, r.id);
    pair.run('presets', r.id, id);
    log.run(
      db.legacyId('timer:journal:preset', r.id),
      r.created_at,
      'presets',
      id,
      JSON.stringify({ name: r.name, config: r.config }),
    );
  }
}
