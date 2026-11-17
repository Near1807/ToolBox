// Agenda: events at a time or over whole days (several days possible), the
// week type (entries that come back every week, one occurrence can be
// cancelled or moved), and what the other tools have dated (read through
// ctx.calendar.query): Sport, Courses, Planning, Timer… The To-do's tasks
// are not events: they are shown « à caser » (CalendarSource.unscheduled),
// and something to fit in written in the bar becomes a To-do task (service
// `todo`, optional). Portable (phone), « Prêt pour la synchro » (UUIDs,
// journal, tombstones, `sync`), « Prêt pour le calendrier » (its own events).
import {
  changesTableSql,
  defineBackendModule,
  HttpError,
  type ModuleContext,
  requestBody,
  SYNC_COLUMNS,
  SyncStore,
  syncJournalSql,
  uuidParam,
} from '@hub/sdk/core';
import { localToday, parseDue } from '@hub/sdk/dates';
import type { TodoService } from '../../todo/contract';
import type { TimerService } from '../../timer/contract';
import {
  categoryKey,
  categoryList,
  type CategoryDto,
  DEFAULT_CATEGORY,
  DEFAULT_OFF,
} from '../shared/categories';
import { AHEAD_DAYS, dueMoment, OVERDUE_DAYS } from '../shared/deadline';
import { MIN_BLOCK_MIN } from '../shared/drag';
import { parseQuick, type Parsed } from '../shared/parse';
import { occurrences, type OccurrenceException } from '../shared/recurrence';
import { addDays, addMinutes, daysBetween, minutesBetween } from '../shared/time';
import { readOrigin } from '../shared/importing';
import { registerImports } from './imports';
import { registerCategories } from './categories';
import type {
  AgendaEventDto,
  ForeignEventDto,
  PlannedTaskDto,
  RangeDto,
  ToPlaceDto,
  WeeklyDto,
} from '../shared/types';

interface EventRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: number;
  location: string | null;
  note: string | null;
  category: string;
  /** v0.36.0: the associated timer (the Timer's TimerChoice, as JSON), or null. */
  timer_pref: string | null;
  /** v0.37.0: the source it was imported from (agenda__sources), or null. */
  source_id: string | null;
  /** v0.37.0: its key in the source (UID, « UID#AAAAMMJJ », identifier or titre|début). */
  origin_key: string | null;
  /** v0.37.0: JSON { original, raw, imported } (shared/importing.ts), or null. */
  origin: string | null;
  /** v0.40.0: 1 = « facultatif »: shown, but no conflict and no load. Thomas's, never a file's. */
  optional: number;
  /** v0.42.0: a deadline ticked « faite » (ISO date), or null. */
  done_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface WeeklyRow {
  id: string;
  title: string;
  weekday: number;
  time: string;
  duration_min: number;
  category: string;
  location: string | null;
  valid_from: string | null;
  valid_until: string | null;
  /** v0.36.0: the associated timer, as JSON, or null. */
  timer_pref: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ExceptionRow {
  id: string;
  weekly_id: string;
  occurrence_date: string;
  kind: 'cancel' | 'move';
  start_at: string | null;
  duration_min: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A period asked at once: a month view and a bit around. */
/** The associated timer as the page gets it (null when none or unreadable). */
function prefOf(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const MAX_RANGE_DAYS = 62;
const MAX_TEXT = 200;

const isDay = (s: string) => DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isDateTime = (s: string) =>
  DATE_TIME.test(s) && isDay(s.slice(0, 10)) && TIME.test(s.slice(11));

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'events, week type and its exceptions, journal (ready for sync)',
      up: `
        CREATE TABLE agenda__events (${SYNC_COLUMNS},
          title TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
          all_day INTEGER NOT NULL DEFAULT 0, location TEXT, note TEXT, category TEXT NOT NULL);
        CREATE INDEX agenda__events_start ON agenda__events (start_at);
        CREATE TABLE agenda__weekly (${SYNC_COLUMNS},
          title TEXT NOT NULL, weekday INTEGER NOT NULL, time TEXT NOT NULL,
          duration_min INTEGER NOT NULL, category TEXT NOT NULL, location TEXT,
          valid_from TEXT, valid_until TEXT);
        CREATE TABLE agenda__exceptions (${SYNC_COLUMNS},
          weekly_id TEXT NOT NULL, occurrence_date TEXT NOT NULL, kind TEXT NOT NULL,
          start_at TEXT, duration_min INTEGER);
        CREATE INDEX agenda__exceptions_weekly ON agenda__exceptions (weekly_id);
        ${changesTableSql('agenda__changes')}
      `,
    },
    {
      version: 2,
      description:
        'synchronisation (ADR 0044): HLC, origin and order of the journal, clock of each field',
      up: syncJournalSql('agenda__'),
    },
    {
      version: 3,
      description:
        'the timer associated with an event or an entry of the week type (empty by default)',
      up: `
        ALTER TABLE agenda__events ADD COLUMN timer_pref TEXT;
        ALTER TABLE agenda__weekly ADD COLUMN timer_pref TEXT;
      `,
    },
    {
      version: 4,
      description:
        'imported calendars (v0.37.0): the sources, and the source and origin of an event (empty by default)',
      up: `
        CREATE TABLE agenda__sources (${SYNC_COLUMNS},
          name TEXT NOT NULL, format TEXT NOT NULL, calendar_name TEXT,
          mapping TEXT NOT NULL DEFAULT '{}', default_category TEXT NOT NULL,
          title_style TEXT NOT NULL DEFAULT 'short', columns TEXT, last_import_at TEXT);
        ALTER TABLE agenda__events ADD COLUMN source_id TEXT;
        ALTER TABLE agenda__events ADD COLUMN origin_key TEXT;
        ALTER TABLE agenda__events ADD COLUMN origin TEXT;
        CREATE INDEX agenda__events_source ON agenda__events (source_id, origin_key);
      `,
    },
    {
      version: 5,
      description:
        '« facultatif » (v0.40.0): an event shown but neither in the conflicts nor in the load (off by default)',
      up: `ALTER TABLE agenda__events ADD COLUMN optional INTEGER NOT NULL DEFAULT 0;`,
    },
    {
      version: 6,
      description:
        'categories managed by Thomas (v0.42.0): only his changes and his own ones (empty: every category as before), and « faite » for a deadline (empty by default)',
      up: `
        CREATE TABLE agenda__categories (${SYNC_COLUMNS},
          key TEXT NOT NULL, name TEXT NOT NULL, color TEXT,
          shape TEXT NOT NULL DEFAULT 'normal', counted INTEGER NOT NULL DEFAULT 1,
          shown INTEGER NOT NULL DEFAULT 1, sort INTEGER, mine INTEGER NOT NULL DEFAULT 0);
        CREATE UNIQUE INDEX agenda__categories_key ON agenda__categories (key) WHERE deleted_at IS NULL;
        ALTER TABLE agenda__events ADD COLUMN done_at TEXT;
      `,
    },
  ],
  sync: {},

  register(ctx: ModuleContext) {
    const store = new SyncStore(ctx.db);
    const events = ctx.db.table('events');
    const weeklyTable = ctx.db.table('weekly');
    const exceptions = ctx.db.table('exceptions');
    const todo = () => ctx.services.optional<TodoService>('todo');
    const timer = () => ctx.services.optional<TimerService>('timer');
    const setting = (key: string, fallback: number) => ctx.settings.get<number>(key) ?? fallback;

    // --- Reading ----------------------------------------------------------------

    registerImports(ctx, store);
    const categories = registerCategories(ctx, store);
    /** v0.37.0: the name of each source, for the detail of its events. */
    const sourceNames = () =>
      new Map(
        (
          ctx.db
            .prepare(`SELECT id, name FROM ${ctx.db.table('sources')} WHERE deleted_at IS NULL`)
            .all() as { id: string; name: string }[]
        ).map((s) => [s.id, s.name]),
      );
    /** An event as the pages get it; an imported one with its source (v0.37.0). */
    /** v0.42.0: the keys of the categories of the « deadline » shape. */
    const deadlineKeys = () =>
      new Set(
        categories
          .list()
          .filter((c) => c.shape === 'deadline')
          .map((c) => c.key),
      );
    const eventDto = (
      row: EventRow,
      names = row.source_id ? sourceNames() : null,
      deadlines = deadlineKeys(),
    ): AgendaEventDto => ({
      id: row.id,
      title: row.title,
      start: row.start_at,
      end: row.end_at,
      allDay: row.all_day === 1,
      location: row.location,
      note: row.note,
      category: row.category,
      weekly: null,
      timerPref: prefOf(row.timer_pref),
      ...(row.optional ? { optional: true as const } : {}),
      ...(deadlines.has(categoryKey(row.category)) ? { deadline: true as const } : {}),
      ...(row.done_at ? { done: true as const } : {}),
      ...(row.source_id && names?.has(row.source_id)
        ? {
            source: {
              id: row.source_id,
              name: names.get(row.source_id)!,
              original: readOrigin(row.origin)?.original ?? {},
            },
          }
        : {}),
    });
    const weeklyDto = (row: WeeklyRow): WeeklyDto => ({
      id: row.id,
      title: row.title,
      weekday: row.weekday,
      time: row.time,
      durationMin: row.duration_min,
      category: row.category,
      location: row.location,
      from: row.valid_from,
      until: row.valid_until,
      timerPref: prefOf(row.timer_pref),
    });
    const weeklyList = () =>
      (
        ctx.db
          .prepare(
            `SELECT * FROM ${weeklyTable} WHERE deleted_at IS NULL ORDER BY weekday, time, title`,
          )
          .all() as WeeklyRow[]
      ).map(weeklyDto);
    /** The live exception of each occurrence (the latest one if two were written on two devices). */
    const exceptionList = (): OccurrenceException[] => {
      const rows = ctx.db
        .prepare(`SELECT * FROM ${exceptions} WHERE deleted_at IS NULL ORDER BY updated_at, id`)
        .all() as ExceptionRow[];
      const latest = new Map<string, ExceptionRow>();
      for (const r of rows) latest.set(`${r.weekly_id}:${r.occurrence_date}`, r);
      return [...latest.values()].map((r) => ({
        weeklyId: r.weekly_id,
        date: r.occurrence_date,
        kind: r.kind,
        start: r.start_at,
        durationMin: r.duration_min,
      }));
    };

    /** The Agenda's own events touching [from, to], occurrences of the week type included. */
    const ownEvents = (from: string, to: string): AgendaEventDto[] => {
      const rows = ctx.db
        .prepare(
          `SELECT * FROM ${events} WHERE deleted_at IS NULL AND substr(start_at, 1, 10) <= ? AND substr(end_at, 1, 10) >= ? ORDER BY start_at, title`,
        )
        .all(to, from) as EventRow[];
      const names = rows.some((r) => r.source_id) ? sourceNames() : null;
      const deadlines = deadlineKeys();
      return [
        ...rows.map((r) => eventDto(r, names, deadlines)),
        ...occurrences(weeklyList(), exceptionList(), from, to),
      ].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
    };

    /**
     * v0.42.0: the « Deadlines » row: the deadlines not done, late ones
     * included (up to OVERDUE_DAYS back), up to `to` + AHEAD_DAYS; sorted.
     */
    const deadlineList = (list: CategoryDto[], today: string, to: string): AgendaEventDto[] => {
      const keys = list.filter((c) => c.shape === 'deadline').map((c) => c.key);
      if (!keys.length) return [];
      const rows = ctx.db
        .prepare(
          `SELECT * FROM ${events} WHERE deleted_at IS NULL AND done_at IS NULL AND lower(trim(category)) IN (${keys.map(() => '?').join(', ')}) AND substr(start_at, 1, 10) >= ? AND substr(start_at, 1, 10) <= ? ORDER BY start_at, title`,
        )
        .all(...keys, addDays(today, -OVERDUE_DAYS), addDays(to, AHEAD_DAYS)) as EventRow[];
      const set = new Set(keys);
      const names = rows.some((r) => r.source_id) ? sourceNames() : null;
      return rows
        .map((r) => eventDto(r, names, set))
        .sort((a, b) => dueMoment(a.start).localeCompare(dueMoment(b.start)));
    };

    const period = (query: unknown): { from: string; to: string } => {
      const q = (query ?? {}) as { from?: string; to?: string };
      const from = String(q.from ?? '');
      const to = String(q.to ?? '');
      if (!isDay(from) || !isDay(to) || to < from)
        throw new HttpError(400, 'Période invalide (from et to : AAAA-MM-JJ)');
      if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new HttpError(400, 'Période trop longue');
      return { from, to };
    };

    const range = async (from: string, to: string): Promise<RangeDto> => {
      const today = localToday();
      const own = ownEvents(from, to);
      const view = await ctx.calendar.query(from, to);
      const skip = new Set([ctx.id, ...view.itemSources]);
      const service = todo();
      // v0.35.0: the planned tasks (events of a source of items, with `itemId`).
      const tasks: PlannedTaskDto[] = [];
      for (const e of view.events) {
        if (
          !e.itemId ||
          !view.itemSources.includes(e.moduleId!) ||
          !service ||
          e.start.length === 10
        )
          continue;
        const task = service.getTask(e.itemId);
        if (!task) continue;
        tasks.push({
          id: task.id,
          title: e.title,
          start: e.start,
          end: addMinutes(e.start, e.durationMin),
          allDay: false,
          category: e.category,
          done: task.done,
          due: task.due,
          afterDue: task.due !== null && e.start.slice(0, 10) > task.due,
          open: e.open,
        });
      }
      const foreign: ForeignEventDto[] = view.events
        .filter((e) => !skip.has(e.moduleId))
        .map((e) => {
          const allDay = e.start.length === 10;
          return {
            id: `${e.moduleId}:${e.id}`,
            moduleId: e.moduleId,
            title: e.title,
            start: e.start,
            end: allDay ? (e.endDate ?? e.start) : addMinutes(e.start, e.durationMin),
            allDay,
            category: e.category,
            open: e.open,
            status: e.status ?? null,
          };
        });
      const toPlace: ToPlaceDto[] = service
        ? view.items.map((i) => ({
            id: i.id,
            title: i.title,
            due: i.due,
            estimateMin: i.estimateMin,
            open: i.open,
            late: i.due !== null && i.due < today,
          }))
        : [];
      // v0.42.0: the list managed by Thomas (colours, shapes, counted), and his own ones get a switch.
      const categoryInfo = categories.list();
      const deadlines = deadlineList(categoryInfo, today, to);
      const mine = categoryInfo.filter((c) => c.origin === 'mine').map((c) => c.name);
      const seen = [
        ...new Set([
          ...own.map((e) => e.category),
          ...foreign.map((e) => e.category),
          ...tasks.map((e) => e.category),
          ...mine,
        ]),
      ];
      const switchNames = seen
        .filter((c, i) => seen.findIndex((x) => categoryKey(x) === categoryKey(c)) === i)
        .sort((a, b) => a.localeCompare(b));
      return {
        today,
        from,
        to,
        events: own,
        foreign,
        toPlace,
        tasks,
        // v0.36.0: the timer running now (its task or what it was started for), to show it.
        timer: (() => {
          const now = timer()?.current();
          return now ? { taskId: now.taskId, subject: now.subject } : null;
        })(),
        todo: Boolean(service),
        weekly: weeklyList(),
        dayStartHour: setting('dayStartHour', 7),
        dayEndHour: setting('dayEndHour', 23),
        categories: switchNames,
        categoryInfo,
        deadlines,
        categoriesOff: categoryList(
          ctx.settings.get<string>('categoriesOff') ?? DEFAULT_OFF.join(', '),
        ),
      };
    };

    // --- Writing ----------------------------------------------------------------

    /** The associated timer (v0.36.0): a small object the Timer gave, kept as is; null clears. */
    const prefFrom = (value: unknown): string | null => {
      if (value === null || value === undefined || value === '') return null;
      const json = JSON.stringify(value);
      if (
        typeof value !== 'object' ||
        typeof (value as { kind?: unknown }).kind !== 'string' ||
        json.length > 500
      )
        throw new HttpError(400, 'Timer associé invalide');
      return json;
    };

    const text = (value: unknown, label: string, required = false): string | null => {
      const t =
        typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT) : '';
      if (!t && required) throw new HttpError(400, `${label} : obligatoire`);
      return t || null;
    };
    const category = (value: unknown) => text(value, 'Catégorie') ?? DEFAULT_CATEGORY;

    /** Start and end of an event, checked (all day: dates, last day inclusive; else date-times). */
    const when = (body: Record<string, unknown>, moment = false) => {
      const allDay = body.allDay === true;
      const start = String(body.start ?? '');
      // v0.42.0: a deadline is a moment: no end of its own (end = start).
      let end = moment ? start : String(body.end ?? '');
      if (allDay) {
        if (!isDay(start)) throw new HttpError(400, 'Début invalide (AAAA-MM-JJ)');
        if (!end) end = start;
        if (!isDay(end)) throw new HttpError(400, 'Fin invalide (AAAA-MM-JJ)');
        if (end < start) throw new HttpError(400, 'La fin est avant le début.');
        if (daysBetween(start, end) > 366) throw new HttpError(400, 'Un an au plus');
      } else {
        if (!isDateTime(start)) throw new HttpError(400, 'Début invalide (AAAA-MM-JJTHH:MM)');
        if (!end && typeof body.durationMin === 'number') end = addMinutes(start, body.durationMin);
        if (!isDateTime(end)) throw new HttpError(400, 'Fin invalide (AAAA-MM-JJTHH:MM)');
        if (!moment && minutesBetween(start, end) <= 0)
          throw new HttpError(400, 'La fin est avant le début.');
        if (minutesBetween(start, end) > 14 * 24 * 60)
          throw new HttpError(400, 'Deux semaines au plus');
      }
      return { start_at: start, end_at: end, all_day: allDay ? 1 : 0 };
    };

    const getEvent = (id: string) => {
      const row = store.get<EventRow>('events', id);
      if (!row) throw new HttpError(404, 'Événement introuvable');
      return row;
    };
    const getWeekly = (id: string) => {
      const row = store.get<WeeklyRow>('weekly', id);
      if (!row) throw new HttpError(404, 'Élément de la semaine type introuvable');
      return row;
    };

    const createEvent = (body: Record<string, unknown>): AgendaEventDto => {
      const cat = category(body.category);
      return eventDto(
        store.create<EventRow>('events', {
          title: text(body.title, 'Titre', true)!,
          ...when(body, categories.shapeOf(cat) === 'deadline'),
          location: text(body.location, 'Lieu'),
          note: text(body.note, 'Note'),
          category: cat,
        }),
      );
    };

    const weeklyFields = (body: Record<string, unknown>, partial = false) => {
      const out: Record<string, string | number | null> = {};
      if (!partial || 'title' in body) out.title = text(body.title, 'Titre', true);
      if (!partial || 'weekday' in body) {
        const day = Number(body.weekday);
        if (!(Number.isInteger(day) && day >= 0 && day <= 6))
          throw new HttpError(400, 'Jour invalide (0 = lundi … 6 = dimanche)');
        out.weekday = day;
      }
      if (!partial || 'time' in body) {
        if (!TIME.test(String(body.time ?? ''))) throw new HttpError(400, 'Heure invalide (HH:MM)');
        out.time = String(body.time);
      }
      if (!partial || 'durationMin' in body) {
        const d = Number(body.durationMin);
        if (!(Number.isInteger(d) && d > 0 && d <= 24 * 60))
          throw new HttpError(400, 'Durée invalide (en minutes)');
        out.duration_min = d;
      }
      if (!partial || 'category' in body) out.category = category(body.category);
      if (partial && 'timerPref' in body) out.timer_pref = prefFrom(body.timerPref);
      if (!partial || 'location' in body) out.location = text(body.location, 'Lieu');
      for (const [key, column] of [
        ['from', 'valid_from'],
        ['until', 'valid_until'],
      ] as const) {
        if (partial && !(key in body)) continue;
        const v = body[key];
        if (v === null || v === undefined || v === '') out[column] = null;
        else {
          const day = typeof v === 'string' ? (isDay(v) ? v : parseDue(v, localToday())) : null;
          if (!day) throw new HttpError(400, `Date invalide : « ${String(v)} »`);
          out[column] = day;
        }
      }
      if (out.valid_from && out.valid_until && String(out.valid_until) < String(out.valid_from))
        throw new HttpError(400, 'La fin de la période est avant son début.');
      return out;
    };

    /** The bar: an event, an entry of the week type, or a task of the To-do (« à caser »). */
    const quickAdd = (input: unknown, chosen?: unknown) => {
      const parsed: Parsed = parseQuick(typeof input === 'string' ? input : '', localToday());
      // v0.42.0: a category chosen in the list wins over the text's (« #cours »).
      const override = typeof chosen === 'string' && chosen.trim() ? category(chosen) : null;
      if (override && (parsed.kind === 'event' || parsed.kind === 'weekly'))
        parsed.category = override;
      switch (parsed.kind) {
        case 'empty':
          throw new HttpError(400, 'Rien à ajouter');
        case 'error':
          throw new HttpError(400, parsed.message);
        case 'event':
          return { kind: 'event' as const, event: createEvent(parsed) };
        case 'weekly':
          return {
            kind: 'weekly' as const,
            weekly: weeklyDto(
              store.create<WeeklyRow>('weekly', {
                ...weeklyFields(parsed),
                valid_from: localToday(),
              }),
            ),
          };
        case 'task': {
          const service = todo();
          if (!service)
            throw new HttpError(
              409,
              'La To-do n’est pas là : une chose à caser devient une tâche de la To-do. Ajoute une heure ou une date pour en faire un événement.',
            );
          return {
            kind: 'task' as const,
            task: service.createTask({
              title: parsed.title,
              due: parsed.due,
              durationMin: parsed.durationMin,
              plannedAt: parsed.start,
            }),
          };
        }
      }
    };

    // --- Routes ---------------------------------------------------------------

    ctx.routes.get('/range', (request) => {
      const { from, to } = period(request.query);
      return range(from, to);
    });

    ctx.routes.post('/quick', (request) => {
      const body = requestBody(request);
      return quickAdd(body.text, body.category);
    });

    ctx.routes.post('/events', (request) => createEvent(requestBody(request)));

    /**
     * v0.35.0: plan a task of the To-do at a time, move or stretch it, or take
     * it out of the agenda (`plannedAt: null`) — on a drop or a click of the
     * user, with « Annuler » after. The task stays the To-do's (its service).
     */
    const todoOrFail = () => {
      const service = todo();
      if (!service) throw new HttpError(409, 'La To-do n’est pas là.');
      return service;
    };

    /** v0.36.0: tick or untick a task from the Agenda (a click, with « Annuler »). */
    ctx.routes.put('/tasks/:id/done', (request) => {
      const service = todoOrFail();
      const id = uuidParam(request.params);
      if (!service.getTask(id)) throw new HttpError(404, 'Tâche introuvable');
      return requestBody(request).done === true
        ? service.completeTask(id)
        : service.uncompleteTask(id);
    });

    /**
     * v0.36.0: « Tâche » in an empty slot of the week: a task of the To-do,
     * planned at that moment for the length of the slot (on « Tâche » or
     * Entrée; « Annuler » deletes it again).
     */
    ctx.routes.post('/tasks', (request) => {
      const service = todoOrFail();
      const body = requestBody(request);
      const start = String(body.plannedAt ?? '');
      if (!isDateTime(start)) throw new HttpError(400, 'Heure prévue invalide (AAAA-MM-JJTHH:MM)');
      const minutes = Number(body.durationMin);
      if (!(Number.isInteger(minutes) && minutes >= MIN_BLOCK_MIN))
        throw new HttpError(400, `Durée invalide (${MIN_BLOCK_MIN} min au moins)`);
      return service.createTask({
        title: text(body.title, 'Titre', true)!,
        plannedAt: start,
        durationMin: minutes,
      });
    });
    ctx.routes.delete('/tasks/:id', (request) => {
      const service = todoOrFail();
      const id = uuidParam(request.params);
      if (!service.getTask(id)) throw new HttpError(404, 'Tâche introuvable');
      service.deleteTask(id);
      return { ok: true };
    });

    ctx.routes.put('/tasks/:id/plan', (request) => {
      const service = todo();
      if (!service) throw new HttpError(409, 'La To-do n’est pas là.');
      const id = uuidParam(request.params);
      if (!service.getTask(id)) throw new HttpError(404, 'Tâche introuvable');
      const body = requestBody(request);
      const fields: { plannedAt?: string | null; durationMin?: number | null } = {};
      if ('plannedAt' in body) {
        const v = body.plannedAt;
        if (v !== null && !isDateTime(String(v)))
          throw new HttpError(400, 'Heure prévue invalide (AAAA-MM-JJTHH:MM)');
        fields.plannedAt = v === null ? null : String(v);
      }
      if ('durationMin' in body) {
        const d = body.durationMin;
        if (d !== null && !(Number.isInteger(d) && (d as number) >= MIN_BLOCK_MIN))
          throw new HttpError(400, `Durée invalide (${MIN_BLOCK_MIN} min au moins)`);
        fields.durationMin = d as number | null;
      }
      return service.planTask(id, fields);
    });
    ctx.routes.patch('/events/:id', (request) => {
      const id = uuidParam(request.params);
      const row = getEvent(id);
      const body = requestBody(request);
      const fields: Record<string, string | number | null> = {};
      if ('title' in body) fields.title = text(body.title, 'Titre', true);
      if ('location' in body) fields.location = text(body.location, 'Lieu');
      if ('note' in body) fields.note = text(body.note, 'Note');
      if ('category' in body) fields.category = category(body.category);
      if ('timerPref' in body) fields.timer_pref = prefFrom(body.timerPref);
      if ('optional' in body) {
        if (typeof body.optional !== 'boolean')
          throw new HttpError(400, 'Facultatif : oui ou non (true / false)');
        fields.optional = body.optional ? 1 : 0;
      }
      if ('done' in body) {
        if (typeof body.done !== 'boolean')
          throw new HttpError(400, 'Faite : oui ou non (true / false)');
        fields.done_at = body.done ? (row.done_at ?? new Date().toISOString()) : null;
      }
      // v0.42.0: a deadline (its category's shape) is a moment; back to a block: one hour.
      const nextCategory = (fields.category as string | undefined) ?? row.category;
      const moment = categories.shapeOf(nextCategory) === 'deadline';
      const wasMoment =
        categories.shapeOf(row.category) === 'deadline' ||
        (row.all_day === 0 && row.end_at === row.start_at);
      if ('start' in body || 'end' in body || 'allDay' in body || moment !== wasMoment)
        Object.assign(
          fields,
          when(
            {
              allDay: 'allDay' in body ? body.allDay : row.all_day === 1,
              start: body.start ?? row.start_at,
              end:
                body.end ??
                ('start' in body || 'allDay' in body || (wasMoment && !moment) ? '' : row.end_at),
              durationMin:
                wasMoment && !moment && !('end' in body)
                  ? 60
                  : 'start' in body && !('end' in body) && row.all_day === 0
                    ? minutesBetween(row.start_at, row.end_at)
                    : body.durationMin,
            },
            moment,
          ),
        );
      const changed = Object.fromEntries(
        Object.entries(fields).filter(([k, v]) => row[k as keyof EventRow] !== v),
      );
      return eventDto(
        Object.keys(changed).length ? store.update<EventRow>('events', id, changed) : row,
      );
    });
    // A tombstone (« Annuler » brings it back), after the page's confirmation.
    ctx.routes.delete('/events/:id', (request) => {
      store.remove('events', getEvent(uuidParam(request.params)).id);
      return { ok: true };
    });
    ctx.routes.post('/events/:id/restore', (request) => {
      const id = uuidParam(request.params);
      const row = store.get<EventRow>('events', id, true);
      if (!row || row.deleted_at === null) throw new HttpError(404, 'Plus rien à restaurer');
      store.restore('events', id);
      return eventDto(getEvent(id));
    });

    ctx.routes.post('/weekly', (request) =>
      weeklyDto(store.create<WeeklyRow>('weekly', weeklyFields(requestBody(request)))),
    );
    ctx.routes.patch('/weekly/:id', (request) => {
      const id = uuidParam(request.params);
      const row = getWeekly(id);
      const fields = weeklyFields(requestBody(request), true);
      const changed = Object.fromEntries(
        Object.entries(fields).filter(([k, v]) => row[k as keyof WeeklyRow] !== v),
      );
      return weeklyDto(
        Object.keys(changed).length ? store.update<WeeklyRow>('weekly', id, changed) : row,
      );
    });
    ctx.routes.delete('/weekly/:id', (request) => {
      store.remove('weekly', getWeekly(uuidParam(request.params)).id);
      return { ok: true };
    });
    ctx.routes.post('/weekly/:id/restore', (request) => {
      const id = uuidParam(request.params);
      const row = store.get<WeeklyRow>('weekly', id, true);
      if (!row || row.deleted_at === null) throw new HttpError(404, 'Plus rien à restaurer');
      store.restore('weekly', id);
      return weeklyDto(getWeekly(id));
    });

    /** One occurrence of the week type: cancel it, move it, or bring it back as usual. */
    ctx.routes.put('/weekly/:id/occurrences/:date', (request) => {
      const id = uuidParam(request.params);
      const weekly = getWeekly(id);
      const date = String((request.params as { date?: string }).date ?? '');
      if (!isDay(date)) throw new HttpError(400, 'Date invalide');
      const body = requestBody(request);
      const action = body.action;
      const current = ctx.db
        .prepare(
          `SELECT * FROM ${exceptions} WHERE deleted_at IS NULL AND weekly_id = ? AND occurrence_date = ?`,
        )
        .all(id, date) as ExceptionRow[];
      // One live exception per occurrence: the previous ones become tombstones.
      for (const r of current) store.remove('exceptions', r.id);
      if (action === 'reset') return { ok: true };
      if (action === 'cancel') {
        store.create('exceptions', {
          weekly_id: id,
          occurrence_date: date,
          kind: 'cancel',
          start_at: null,
          duration_min: null,
        });
        return { ok: true };
      }
      if (action === 'move') {
        const start = String(body.start ?? '');
        if (!isDateTime(start)) throw new HttpError(400, 'Nouveau début invalide');
        const duration =
          body.durationMin === undefined || body.durationMin === null
            ? weekly.duration_min
            : Number(body.durationMin);
        if (!(Number.isInteger(duration) && duration > 0 && duration <= 24 * 60))
          throw new HttpError(400, 'Durée invalide');
        if (Math.abs(daysBetween(date, start.slice(0, 10))) > 6)
          throw new HttpError(400, 'Une occurrence se déplace d’une semaine au plus.');
        store.create('exceptions', {
          weekly_id: id,
          occurrence_date: date,
          kind: 'move',
          start_at: start,
          duration_min: duration,
        });
        return { ok: true };
      }
      throw new HttpError(400, 'Action inconnue (cancel, move ou reset)');
    });

    // --- « Prêt pour le calendrier » (MODULES.md §5.17) --------------------------
    // Its own events and the occurrences of the week type. Read only.
    ctx.calendar.provide({
      category: 'Agenda',
      events: (from, to) =>
        ownEvents(from, to).map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start,
          durationMin: e.allDay ? 0 : minutesBetween(e.start, e.end),
          open: `/m/agenda?date=${e.start.slice(0, 10)}`,
          category: e.category,
          ...(e.allDay && e.end !== e.start ? { endDate: e.end } : {}),
          ...(e.location ? { status: e.location } : {}),
        })),
    });

    // Home card: today and tomorrow.
    ctx.routes.get('/today', async () => {
      const today = localToday();
      return range(today, addDays(today, 1));
    });
  },
});
