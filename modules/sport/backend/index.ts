// Sport: a weekly template (sessions per weekday with a name, a start time
// and a duration) applied to the weeks to come; each session validated
// (« Fait » / « Pas fait »), with a mood and a comment, its time or duration
// changed, moved to another day of its week, cancelled; sessions added by
// hand (deletable); exercises (a library, and an ordered list per template
// session, copied to each session and changeable for it alone); a summary;
// export. « Prêt pour la synchro » (UUIDs, dates,
// tombstones, journal) and « Prêt pour le calendrier » (ctx.calendar).
// The assistant reads freely and changes only with its own right (off).
import {
  changesTableSql,
  defineBackendModule,
  HttpError,
  listPhrase,
  type ModuleContext,
  requestBody,
  SYNC_COLUMNS,
  newId,
  syncStamp,
  SyncStore,
} from '@hub/sdk/backend';
import {
  addDays,
  completeWeekStreak,
  endTime,
  localToday,
  monthEnd,
  monthWeeks,
  mondayOf,
  moveCheck,
  planWeek,
  reapplyTemplate,
  summary,
  validTime,
  weekDays,
  WEEKDAYS,
  MOODS,
  type Session,
  type SessionStatus,
  type TemplateItem,
  type Weekday,
} from '../shared/plan';
import {
  cleanLines,
  fold,
  linesText,
  parseLines,
  type Exercise,
  type ExerciseLine,
  type ExerciseLineDto,
} from '../shared/exercises';
import type { WeekDto } from '../shared/types';
import {
  COMMENT_EXAMPLES,
  DONE_EXAMPLES,
  extractComment,
  extractDone,
  extractMood,
  extractMove,
  MOOD_EXAMPLES,
  EXERCISES_EXAMPLES,
  MOVE_EXAMPLES,
  SUMMARY_EXAMPLES,
  TODAY_EXAMPLES,
} from './commands';

interface TemplateRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  weekday: number;
  name: string;
  start_time: string;
  duration_min: number;
  exercises: string;
}
interface ExerciseRow {
  id: string;
  deleted_at: string | null;
  name: string;
  note: string;
}
interface SessionRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  date: string;
  week: string;
  name: string;
  start_time: string;
  duration_min: number;
  status: SessionStatus;
  mood: number | null;
  comment: string;
  template_id: string | null;
  custom: number;
  exercises: string;
}

const STATUSES: SessionStatus[] = ['planned', 'done', 'missed', 'cancelled'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'weekly template, sessions, weeks on the calendar, journal',
      up: `
        CREATE TABLE sport__templates (${SYNC_COLUMNS},
          weekday INTEGER NOT NULL, name TEXT NOT NULL, start_time TEXT NOT NULL, duration_min INTEGER NOT NULL);
        CREATE TABLE sport__sessions (${SYNC_COLUMNS},
          date TEXT NOT NULL, week TEXT NOT NULL, name TEXT NOT NULL, start_time TEXT NOT NULL,
          duration_min INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'planned', mood INTEGER,
          comment TEXT NOT NULL DEFAULT '', template_id TEXT, custom INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX sport__sessions_week ON sport__sessions (week);
        CREATE TABLE sport__weeks (${SYNC_COLUMNS}, week TEXT NOT NULL UNIQUE);
        ${changesTableSql('sport__changes')}
      `,
    },
    {
      version: 2,
      description: 'exercises: a library, and a list per template session and per session',
      up: `
        CREATE TABLE sport__exercises (${SYNC_COLUMNS}, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
        ALTER TABLE sport__templates ADD COLUMN exercises TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE sport__sessions ADD COLUMN exercises TEXT NOT NULL DEFAULT '[]';
      `,
    },
    {
      version: 3,
      description:
        'exercise lines: one row per line (merged line by line by a future synchronisation)',
      up: (db) => {
        const lineColumns = `exercise_id TEXT NOT NULL, position INTEGER NOT NULL, sets INTEGER,
          reps TEXT NOT NULL DEFAULT '', load TEXT NOT NULL DEFAULT '', rest_sec INTEGER,
          note TEXT NOT NULL DEFAULT ''`;
        db.exec(`
          CREATE TABLE sport__template_exercises (${SYNC_COLUMNS}, template_id TEXT NOT NULL, ${lineColumns});
          CREATE INDEX sport__template_exercises_owner ON sport__template_exercises (template_id);
          CREATE TABLE sport__session_exercises (${SYNC_COLUMNS}, session_id TEXT NOT NULL, ${lineColumns});
          CREATE INDEX sport__session_exercises_owner ON sport__session_exercises (session_id);
        `);
        // The JSON lists become rows (the old column stays, no longer read nor written).
        const journal = db.prepare(
          'INSERT INTO sport__changes (id, at, entity, entity_id, op, data) VALUES (?, ?, ?, ?, ?, ?)',
        );
        for (const [owners, table, key] of [
          ['sport__templates', 'template_exercises', 'template_id'],
          ['sport__sessions', 'session_exercises', 'session_id'],
        ] as const) {
          const insert = db.prepare(
            `INSERT INTO sport__${table} (id, created_at, updated_at, deleted_at, ${key}, exercise_id, position, sets, reps, load, rest_sec, note) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const rows = db.prepare(`SELECT id, updated_at, exercises FROM ${owners}`).all() as {
            id: string;
            updated_at: string;
            exercises: string;
          }[];
          for (const r of rows)
            parseLines(r.exercises).forEach((l, position) => {
              const id = newId();
              const fields = [
                l.exerciseId,
                position,
                l.sets ?? null,
                l.reps ?? '',
                l.load ?? '',
                l.restSec ?? null,
                l.note ?? '',
              ];
              insert.run(id, r.updated_at, r.updated_at, r.id, ...fields);
              journal.run(
                newId(),
                syncStamp(),
                table,
                id,
                'create',
                JSON.stringify({ [key]: r.id, exercise_id: l.exerciseId, position }),
              );
            });
        }
      },
    },
  ],

  register(ctx: ModuleContext) {
    const store = new SyncStore(ctx.db);
    const t = {
      templates: ctx.db.table('templates'),
      sessions: ctx.db.table('sessions'),
      weeks: ctx.db.table('weeks'),
      exercises: ctx.db.table('exercises'),
    };
    const today = () => localToday();

    // --- Exercises ---------------------------------------------------------------

    /** Every exercise, deleted ones included (an old session still shows its names). */
    const exerciseRows = (): ExerciseRow[] =>
      ctx.db
        .prepare(`SELECT id, deleted_at, name, note FROM ${t.exercises} ORDER BY name`)
        .all() as ExerciseRow[];
    /** Lines of templates or sessions, by owner (live lines only, in their order). */
    type Owner = 'template' | 'session';
    const LINES = { template: 'template_exercises', session: 'session_exercises' } as const;
    const OWNER_KEY = { template: 'template_id', session: 'session_id' } as const;
    interface LineRow {
      id: string;
      exercise_id: string;
      position: number;
      sets: number | null;
      reps: string;
      load: string;
      rest_sec: number | null;
      note: string;
      owner: string;
    }
    const linesOf = (owner: Owner, ids: string[]): Map<string, ExerciseLineDto[]> => {
      const out = new Map<string, ExerciseLineDto[]>(ids.map((id) => [id, []]));
      if (!ids.length) return out;
      const names = new Map(exerciseRows().map((e) => [e.id, e.name]));
      const rows = ctx.db
        .prepare(
          `SELECT *, ${OWNER_KEY[owner]} AS owner FROM ${ctx.db.table(LINES[owner])} WHERE deleted_at IS NULL AND ${OWNER_KEY[owner]} IN (${ids.map(() => '?').join(',')}) ORDER BY position`,
        )
        .all(...ids) as LineRow[];
      for (const r of rows)
        out.get(r.owner)?.push({
          id: r.id,
          exerciseId: r.exercise_id,
          name: names.get(r.exercise_id) ?? 'Exercice supprimé',
          sets: r.sets,
          reps: r.reps,
          load: r.load,
          restSec: r.rest_sec,
          note: r.note,
        });
      return out;
    };
    /**
     * The lines of one template session or session, saved line by line: a
     * known line is updated only where it changed, a new one created, a
     * missing one tombstoned (so that two devices editing different lines merge).
     */
    const saveLines = (owner: Owner, ownerId: string, lines: ExerciseLine[]) => {
      const before = new Map((linesOf(owner, [ownerId]).get(ownerId) ?? []).map((l) => [l.id!, l]));
      const kept = new Set<string>();
      lines.forEach((l, position) => {
        const fields = {
          exercise_id: l.exerciseId,
          position,
          sets: l.sets,
          reps: l.reps,
          load: l.load,
          rest_sec: l.restSec,
          note: l.note,
        };
        const old = l.id ? before.get(l.id) : undefined;
        if (!old) {
          store.create(LINES[owner], { [OWNER_KEY[owner]]: ownerId, ...fields });
          return;
        }
        kept.add(old.id!);
        const was = {
          exercise_id: old.exerciseId,
          position: before.size ? [...before.keys()].indexOf(old.id!) : 0,
          sets: old.sets,
          reps: old.reps,
          load: old.load,
          rest_sec: old.restSec,
          note: old.note,
        };
        const changed = Object.fromEntries(
          Object.entries(fields).filter(([k, v]) => was[k as keyof typeof was] !== v),
        );
        if (Object.keys(changed).length) store.update(LINES[owner], old.id!, changed);
      });
      for (const id of before.keys()) if (!kept.has(id)) store.remove(LINES[owner], id);
    };
    /** The same lines as new rows of another owner (a session planned from the template). */
    const copyLines = (owner: Owner, ownerId: string, lines: ExerciseLine[]) =>
      saveLines(
        owner,
        ownerId,
        lines.map(({ id: _id, ...l }) => l),
      );
    const lineKey = (lines: ExerciseLine[]) =>
      JSON.stringify(lines.map((l) => [l.exerciseId, l.sets, l.reps, l.load, l.restSec, l.note]));
    const sameLines = (a: ExerciseLine[], b: ExerciseLine[]) => lineKey(a) === lineKey(b);
    /** The exercise of that name (accents and case ignored), created if new. */
    const exerciseNamed = (name: string): string => {
      const found = exerciseRows().find((e) => !e.deleted_at && fold(e.name) === fold(name));
      return found ? found.id : store.create('exercises', { name, note: '' }).id;
    };
    const linesFrom = (raw: unknown): ExerciseLine[] => {
      const live = new Set(
        exerciseRows()
          .filter((e) => !e.deleted_at)
          .map((e) => e.id),
      );
      try {
        return cleanLines(raw, (id) => live.has(id), exerciseNamed);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    };
    const exerciseList = (): Exercise[] => {
      const uses = new Map<string, number>();
      for (const owner of ['template', 'session'] as const) {
        const owners = owner === 'template' ? t.templates : t.sessions;
        for (const r of ctx.db
          .prepare(
            `SELECT l.exercise_id AS id, COUNT(*) AS n FROM ${ctx.db.table(LINES[owner])} l JOIN ${owners} o ON o.id = l.${OWNER_KEY[owner]} WHERE l.deleted_at IS NULL AND o.deleted_at IS NULL GROUP BY l.exercise_id`,
          )
          .all() as { id: string; n: number }[])
          uses.set(r.id, (uses.get(r.id) ?? 0) + r.n);
      }
      return exerciseRows()
        .filter((e) => !e.deleted_at)
        .map((e) => ({ id: e.id, name: e.name, note: e.note, uses: uses.get(e.id) ?? 0 }));
    };
    const exerciseName = (raw: unknown, except?: string): string => {
      const name = String(raw ?? '')
        .trim()
        .slice(0, 80);
      if (!name) throw new HttpError(400, 'Nom d’exercice vide');
      if (
        exerciseRows().some((e) => !e.deleted_at && e.id !== except && fold(e.name) === fold(name))
      )
        throw new HttpError(409, `« ${name} » existe déjà (fusionner plutôt)`);
      return name;
    };
    /** `from` becomes `into` everywhere (template and sessions, past ones included), then goes. */
    const mergeExercises = (from: string, into: string) => {
      const live = exerciseList();
      if (from === into || !live.some((e) => e.id === from) || !live.some((e) => e.id === into))
        throw new HttpError(400, 'Deux exercices différents de la bibliothèque');
      ctx.db.transaction(() => {
        for (const owner of ['template', 'session'] as const) {
          const rows = ctx.db
            .prepare(
              `SELECT id FROM ${ctx.db.table(LINES[owner])} WHERE deleted_at IS NULL AND exercise_id = ?`,
            )
            .all(from) as { id: string }[];
          for (const r of rows) store.update(LINES[owner], r.id, { exercise_id: into });
        }
        store.remove('exercises', from);
      });
    };

    const toTemplate = (r: TemplateRow): TemplateItem => ({
      id: r.id,
      weekday: r.weekday as Weekday,
      name: r.name,
      start: r.start_time,
      durationMin: r.duration_min,
      exercises: [],
    });
    const toSession = (r: SessionRow): Session => ({
      id: r.id,
      date: r.date,
      name: r.name,
      start: r.start_time,
      durationMin: r.duration_min,
      status: r.status,
      mood: r.mood,
      comment: r.comment,
      templateId: r.template_id,
      custom: r.custom === 1,
      exercises: [],
    });
    /** Rows → items with their exercise lines (one query for all of them). */
    const withLines = <T extends { id: string; exercises: ExerciseLineDto[] }>(
      owner: Owner,
      items: T[],
    ): T[] => {
      const lines = linesOf(
        owner,
        items.map((i) => i.id),
      );
      return items.map((i) => ({ ...i, exercises: lines.get(i.id) ?? [] }));
    };
    const template = (): TemplateItem[] =>
      withLines(
        'template',
        (
          ctx.db
            .prepare(
              `SELECT * FROM ${t.templates} WHERE deleted_at IS NULL ORDER BY weekday, start_time`,
            )
            .all() as TemplateRow[]
        ).map(toTemplate),
      );
    const isMaterialized = (monday: string) =>
      Boolean(
        ctx.db
          .prepare(`SELECT 1 FROM ${t.weeks} WHERE week = ? AND deleted_at IS NULL`)
          .get(monday),
      );
    const insertPlanned = (p: ReturnType<typeof planWeek>[number]) => {
      const row = store.create('sessions', {
        date: p.date,
        week: mondayOf(p.date),
        name: p.name,
        start_time: p.start,
        duration_min: p.durationMin,
        status: 'planned',
        mood: null,
        comment: '',
        template_id: p.templateId,
        custom: 0,
      });
      copyLines('session', row.id, p.exercises);
      return row;
    };
    const sessionById = (id: string): Session =>
      withLines('session', [toSession(getSession(id))])[0]!;
    /**
     * The weeks from the current one on get their sessions from the template
     * the first time they are shown; past weeks never do (nothing is invented
     * after the fact).
     */
    const ensureWeek = (monday: string) => {
      if (monday < mondayOf(today()) || isMaterialized(monday)) return;
      const plan = planWeek(template(), monday);
      // No template yet: nothing is written, the week fills when there is one.
      if (plan.length === 0) return;
      ctx.db.transaction(() => {
        for (const p of plan) insertPlanned(p);
        store.create('weeks', { week: monday });
      });
    };
    const sessionsOf = (monday: string): Session[] =>
      withLines(
        'session',
        (
          ctx.db
            .prepare(
              `SELECT * FROM ${t.sessions} WHERE week = ? AND deleted_at IS NULL ORDER BY date, start_time`,
            )
            .all(monday) as SessionRow[]
        ).map(toSession),
      );
    const sessionsBetween = (from: string, to: string): Session[] =>
      withLines(
        'session',
        (
          ctx.db
            .prepare(
              `SELECT * FROM ${t.sessions} WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date, start_time`,
            )
            .all(from, to) as SessionRow[]
        ).map(toSession),
      );
    const getSession = (id: string): SessionRow => {
      const row = store.get<SessionRow>('sessions', id);
      if (!row) throw new HttpError(404, 'Séance introuvable');
      return row;
    };
    const streak = () => {
      const byWeek = new Map<string, Session[]>();
      for (const s of sessionsBetween(
        addDays(mondayOf(today()), -7 * 104),
        addDays(mondayOf(today()), 6),
      )) {
        const m = mondayOf(s.date);
        byWeek.set(m, [...(byWeek.get(m) ?? []), s]);
      }
      return completeWeekStreak(byWeek, today());
    };
    const monthSessions = (month: string) => sessionsBetween(`${month}-01`, monthEnd(month));

    const weekDto = (monday: string): WeekDto => {
      ensureWeek(monday);
      const sessions = sessionsOf(monday);
      const day = today();
      return {
        week: monday,
        today: day,
        days: weekDays(monday).map((date) => ({
          date,
          sessions: sessions.filter((s) => s.date === date),
        })),
        summary: summary(sessions, day),
        month: summary(monthSessions(day.slice(0, 7)), day),
        streak: streak(),
        template: template(),
      };
    };

    // --- Changes ---------------------------------------------------------------

    const patchSession = (id: string, body: Record<string, unknown>): Session => {
      const row = getSession(id);
      const fields: Record<string, string | number | null> = {};
      let custom = false;
      if ('status' in body) {
        if (!STATUSES.includes(body.status as SessionStatus))
          throw new HttpError(400, 'État invalide');
        fields.status = body.status as SessionStatus;
      }
      if ('mood' in body) {
        const mood = body.mood === null ? null : Number(body.mood);
        if (mood !== null && !(Number.isInteger(mood) && mood >= 1 && mood <= 5))
          throw new HttpError(400, 'Humeur de 1 à 5');
        fields.mood = mood;
      }
      if ('comment' in body) fields.comment = String(body.comment ?? '').slice(0, 2000);
      if ('name' in body) {
        const name = String(body.name ?? '')
          .trim()
          .slice(0, 80);
        if (!name) throw new HttpError(400, 'Nom de séance vide');
        fields.name = name;
        custom = true;
      }
      if ('start' in body) {
        if (!validTime(body.start)) throw new HttpError(400, 'Heure invalide (HH:MM)');
        fields.start_time = body.start;
        custom = true;
      }
      if ('durationMin' in body) {
        const d = Number(body.durationMin);
        if (!(Number.isInteger(d) && d >= 5 && d <= 600))
          throw new HttpError(400, 'Durée de 5 à 600 min');
        fields.duration_min = d;
        custom = true;
      }
      if ('date' in body) {
        const problem = moveCheck({ date: row.date }, String(body.date));
        if (problem) throw new HttpError(400, problem);
        fields.date = String(body.date);
        custom = true;
      }
      const lines = 'exercises' in body ? linesFrom(body.exercises) : null;
      if (lines) custom = true;
      if (custom) fields.custom = 1;
      ctx.db.transaction(() => {
        if (Object.keys(fields).length) store.update<SessionRow>('sessions', id, fields);
        if (lines) saveLines('session', id, lines);
      });
      return sessionById(id);
    };

    const addSession = (body: Record<string, unknown>): Session => {
      const date = String(body.date ?? '');
      if (!DAY.test(date)) throw new HttpError(400, 'Jour invalide');
      const name = String(body.name ?? '')
        .trim()
        .slice(0, 80);
      if (!name) throw new HttpError(400, 'Nom de séance vide');
      const start = body.start ?? '18:00';
      if (!validTime(start)) throw new HttpError(400, 'Heure invalide (HH:MM)');
      const duration = Number(body.durationMin ?? 60);
      if (!(Number.isInteger(duration) && duration >= 5 && duration <= 600))
        throw new HttpError(400, 'Durée de 5 à 600 min');
      ensureWeek(mondayOf(date));
      const lines = linesFrom(body.exercises);
      const row = ctx.db.transaction(() => {
        const created = store.create<SessionRow>('sessions', {
          date,
          week: mondayOf(date),
          name,
          start_time: start,
          duration_min: duration,
          status: 'planned',
          mood: null,
          comment: '',
          template_id: null,
          custom: 1,
        });
        saveLines('session', created.id, lines);
        return created;
      });
      return sessionById(row.id);
    };

    /** Only a session added by hand is deleted (logically, it can come back). */
    const deleteSession = (id: string) => {
      const row = getSession(id);
      if (row.template_id !== null)
        throw new HttpError(
          400,
          'Une séance de la semaine type s’annule (elle ne se supprime pas).',
        );
      store.remove('sessions', id);
    };

    /** A new template: saved, then applied to the weeks already on the calendar (after today). */
    const saveTemplate = (items: unknown): TemplateItem[] => {
      if (!Array.isArray(items)) throw new HttpError(400, 'Semaine type invalide');
      const clean = items.map((raw) => {
        const i = raw as Record<string, unknown>;
        const weekday = Number(i.weekday);
        const name = String(i.name ?? '')
          .trim()
          .slice(0, 80);
        const duration = Number(i.durationMin);
        if (!(Number.isInteger(weekday) && weekday >= 1 && weekday <= 7))
          throw new HttpError(400, 'Jour invalide');
        if (!name) throw new HttpError(400, 'Chaque séance a un nom');
        if (!validTime(i.start)) throw new HttpError(400, `Heure invalide pour « ${name} »`);
        if (!(Number.isInteger(duration) && duration >= 5 && duration <= 600))
          throw new HttpError(400, `Durée invalide pour « ${name} »`);
        return {
          id: typeof i.id === 'string' ? i.id : null,
          weekday,
          name,
          start: i.start,
          durationMin: duration,
          exercises: i.exercises,
        };
      });
      ctx.db.transaction(() => {
        const before = new Map(template().map((x) => [x.id, x]));
        const keep = new Set<string>();
        for (const c of clean) {
          const fields = {
            weekday: c.weekday,
            name: c.name,
            start_time: c.start,
            duration_min: c.durationMin,
          };
          const lines = linesFrom(c.exercises);
          if (c.id && before.has(c.id)) {
            keep.add(c.id);
            const b = before.get(c.id)!;
            if (
              b.weekday !== c.weekday ||
              b.name !== c.name ||
              b.start !== c.start ||
              b.durationMin !== c.durationMin
            )
              store.update('templates', c.id, fields);
            if (!sameLines(b.exercises, lines)) saveLines('template', c.id, lines);
          } else {
            const created = store.create('templates', fields);
            keep.add(created.id);
            saveLines('template', created.id, lines);
          }
        }
        for (const id of before.keys()) if (!keep.has(id)) store.remove('templates', id);
        const next = template();
        const weeks = (
          ctx.db
            .prepare(`SELECT week FROM ${t.weeks} WHERE week >= ? AND deleted_at IS NULL`)
            .all(mondayOf(today())) as { week: string }[]
        ).map((w) => w.week);
        for (const monday of weeks) {
          const { remove, add } = reapplyTemplate(sessionsOf(monday), next, monday, today());
          for (const id of remove) store.remove('sessions', id);
          for (const p of add) insertPlanned(p);
        }
      });
      ctx.logger.info(`Semaine type enregistrée (${clean.length} séance(s))`);
      return template();
    };

    // --- Routes ------------------------------------------------------------------

    ctx.routes.get('/week', (request) => {
      const q = request.query as { start?: string };
      const day = q.start && DAY.test(q.start) ? q.start : today();
      return weekDto(mondayOf(day));
    });
    ctx.routes.get('/month', (request) => {
      const q = request.query as { month?: string };
      const month = q.month && /^\d{4}-\d{2}$/.test(q.month) ? q.month : today().slice(0, 7);
      const weeks = monthWeeks(month).map((m) => weekDto(m));
      return { month, today: today(), weeks, summary: summary(monthSessions(month), today()) };
    });
    ctx.routes.put('/template', (request) => ({
      template: saveTemplate(requestBody(request).items),
    }));
    ctx.routes.post('/sessions', (request) => addSession(requestBody(request)));
    ctx.routes.patch('/sessions/:id', (request) =>
      patchSession((request.params as { id: string }).id, requestBody(request)),
    );
    ctx.routes.delete('/sessions/:id', (request) => {
      deleteSession((request.params as { id: string }).id);
      return { ok: true };
    });
    ctx.routes.post('/sessions/:id/restore', (request) => {
      const id = (request.params as { id: string }).id;
      store.restore('sessions', id);
      return sessionById(id);
    });
    ctx.routes.get('/exercises', () => ({ exercises: exerciseList() }));
    ctx.routes.post('/exercises', (request) => {
      const body = requestBody(request);
      return store.create('exercises', {
        name: exerciseName(body.name),
        note: String(body.note ?? '')
          .trim()
          .slice(0, 500),
      });
    });
    ctx.routes.patch('/exercises/:id', (request) => {
      const id = (request.params as { id: string }).id;
      const body = requestBody(request);
      if (!exerciseList().some((e) => e.id === id))
        throw new HttpError(404, 'Exercice introuvable');
      const fields: Record<string, string> = {};
      if ('name' in body) fields.name = exerciseName(body.name, id);
      if ('note' in body)
        fields.note = String(body.note ?? '')
          .trim()
          .slice(0, 500);
      return store.update('exercises', id, fields);
    });
    ctx.routes.delete('/exercises/:id', (request) => {
      const id = (request.params as { id: string }).id;
      const e = exerciseList().find((x) => x.id === id);
      if (!e) throw new HttpError(404, 'Exercice introuvable');
      if (e.uses)
        throw new HttpError(
          400,
          `« ${e.name} » sert encore dans ${e.uses} séance(s) : fusionne-le plutôt.`,
        );
      store.remove('exercises', id);
      return { ok: true };
    });
    ctx.routes.post('/exercises/:id/restore', (request) => {
      store.restore('exercises', (request.params as { id: string }).id);
      return { exercises: exerciseList() };
    });
    ctx.routes.post('/exercises/merge', (request) => {
      const body = requestBody(request);
      mergeExercises(String(body.from), String(body.into));
      return { exercises: exerciseList() };
    });
    ctx.routes.get('/home', () => {
      const day = today();
      ensureWeek(mondayOf(day));
      return {
        today: day,
        sessions: sessionsBetween(day, day).filter((s) => s.status !== 'cancelled'),
      };
    });

    /** Export of a period (CSV or Markdown), through « Enregistrer sous ». */
    ctx.routes.post('/export', async (request) => {
      const body = requestBody(request);
      const from = DAY.test(String(body.from)) ? String(body.from) : `${today().slice(0, 7)}-01`;
      const to = DAY.test(String(body.to)) ? String(body.to) : addDays(from, 30);
      const list = sessionsBetween(from, to);
      const csv = body.format === 'csv';
      const STATUS_FR: Record<SessionStatus, string> = {
        planned: 'prévue',
        done: 'faite',
        missed: 'pas faite',
        cancelled: 'annulée',
      };
      const field = (v: string | number) => {
        const text = String(v);
        return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const data = csv
        ? `date;séance;début;durée_min;état;humeur;commentaire;exercices\n${list
            .map((s) =>
              [
                s.date,
                s.name,
                s.start,
                s.durationMin,
                STATUS_FR[s.status],
                s.mood ?? '',
                s.comment,
                linesText(s.exercises),
              ]
                .map(field)
                .join(';'),
            )
            .join('\n')}\n`
        : `# Sport — du ${from} au ${to}\n\n${list
            .map((s) => {
              const head = `- ${s.date} ${s.start} · **${s.name}** (${s.durationMin} min) — ${STATUS_FR[s.status]}${s.mood ? ` ${MOODS[s.mood - 1]}` : ''}`;
              const comment = s.comment
                ? `\n  - Commentaire : ${s.comment.replace(/\r?\n/g, '\n    ')}`
                : '';
              const exercises = s.exercises.length
                ? `\n  - Exercices :\n${s.exercises.map((l) => `    - ${linesText([l])}`).join('\n')}`
                : '';
              return head + comment + exercises;
            })
            .join('\n')}\n`;
      const saved = await ctx.files.saveAs({
        title: 'Exporter les séances',
        defaultName: `Sport ${from} - ${to}.${csv ? 'csv' : 'md'}`,
        filters: [
          csv ? { name: 'CSV', extensions: ['csv'] } : { name: 'Markdown', extensions: ['md'] },
        ],
        data,
      });
      return saved ? { path: saved, count: list.length } : { cancelled: true };
    });

    // --- « Prêt pour le calendrier » (MODULES.md §5.17), read only -----------------

    ctx.calendar.provide({
      events: (from, to) => {
        const stored = sessionsBetween(from, to).filter((s) => s.status !== 'cancelled');
        // Weeks to come not shown yet: what the template will give (nothing written).
        const virtual: Session[] = [];
        for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) {
          if (m < mondayOf(today()) || isMaterialized(m)) continue;
          for (const p of planWeek(template(), m))
            if (p.date >= from && p.date <= to)
              virtual.push({
                id: `tpl:${p.templateId}:${p.date}`,
                ...p,
                status: 'planned',
                mood: null,
                comment: '',
                custom: false,
                exercises: p.exercises,
              });
        }
        return [...stored, ...virtual].map((s) => ({
          id: s.id,
          title: s.name,
          start: `${s.date}T${s.start}`,
          durationMin: s.durationMin,
          open: `/m/sport?week=${mondayOf(s.date)}`,
          status: s.status === 'done' ? 'fait' : s.status === 'missed' ? 'pas fait' : undefined,
        }));
      },
    });

    // --- Assistant (MODULES.md §5.15) ----------------------------------------------

    const right = {
      id: 'edit-sessions',
      label: 'L’assistant peut valider et modifier les séances',
    };
    const describe = (s: Session) =>
      `${s.name} à ${s.start.replace(':', 'h')} (${s.durationMin} min)`;
    /** Today's session (the first one not validated yet, else the last one). */
    const todaySession = (): Session => {
      ensureWeek(mondayOf(today()));
      const list = sessionsBetween(today(), today()).filter((s) => s.status !== 'cancelled');
      if (!list.length) throw new HttpError(404, 'Pas de séance prévue aujourd’hui.');
      return list.find((s) => s.status === 'planned') ?? list.at(-1)!;
    };
    const undoTo = (s: Session) => () =>
      void store.update('sessions', s.id, {
        status: s.status,
        mood: s.mood,
        comment: s.comment,
        date: s.date,
        custom: s.custom ? 1 : 0,
      });

    ctx.assistant.define({
      name: 'today-session',
      examples: TODAY_EXAMPLES,
      extract: () => ({}),
      description: 'Dit la ou les séances de sport prévues aujourd’hui.',
      risk: 'read',
      run: () => {
        ensureWeek(mondayOf(today()));
        const list = sessionsBetween(today(), today()).filter((s) => s.status !== 'cancelled');
        return {
          message: list.length
            ? `Aujourd’hui : ${listPhrase(list.map((s) => `${describe(s)}${s.status === 'done' ? ', déjà faite' : ''}`))}.`
            : 'Pas de séance prévue aujourd’hui.',
          data: { sessions: list },
        };
      },
    });
    ctx.assistant.define({
      name: 'today-exercises',
      examples: EXERCISES_EXAMPLES,
      extract: () => ({}),
      description: 'Dit les exercices de la séance de sport du jour.',
      risk: 'read',
      run: () => {
        ensureWeek(mondayOf(today()));
        const list = sessionsBetween(today(), today()).filter((s) => s.status !== 'cancelled');
        if (!list.length) return { message: 'Pas de séance prévue aujourd’hui.', data: {} };
        const said = list.map((s) =>
          s.exercises.length
            ? `${s.name} : ${linesText(s.exercises, ', ')}`
            : `${s.name} : pas d’exercice noté`,
        );
        return { message: `${said.join('. ')}.`, data: { sessions: list } };
      },
    });
    ctx.assistant.define({
      name: 'week-summary',
      examples: SUMMARY_EXAMPLES,
      extract: () => ({}),
      description:
        'Bilan sport de la semaine : séances faites sur prévues, humeur moyenne, série de semaines complètes.',
      risk: 'read',
      run: () => {
        const w = weekDto(mondayOf(today()));
        return {
          message: `Cette semaine : ${w.summary.done} séance${w.summary.done > 1 ? 's' : ''} faite${w.summary.done > 1 ? 's' : ''} sur ${w.summary.planned}${w.summary.mood !== null ? `, humeur moyenne ${String(w.summary.mood).replace('.', ',')} sur 5` : ''}${w.streak ? `, ${w.streak} semaine${w.streak > 1 ? 's' : ''} complète${w.streak > 1 ? 's' : ''} d’affilée` : ''}.`,
          data: { summary: w.summary, month: w.month, streak: w.streak },
        };
      },
    });
    ctx.assistant.define({
      name: 'session-done',
      examples: DONE_EXAMPLES,
      extract: extractDone,
      right,
      description: 'Valide la séance du jour : faite (done true) ou pas faite (done false).',
      parameters: { done: { type: 'boolean', description: 'true : faite ; false : pas faite' } },
      risk: 'change',
      run: (params) => {
        const s = todaySession();
        const done = params.done !== false;
        patchSession(s.id, { status: done ? 'done' : 'missed' });
        return {
          message: `${s.name} : ${done ? 'faite' : 'pas faite'}.`,
          data: { id: s.id },
          undo: undoTo(s),
        };
      },
    });
    ctx.assistant.define({
      name: 'session-mood',
      examples: MOOD_EXAMPLES,
      extract: extractMood,
      right,
      description: 'Note l’humeur de la séance du jour, de 1 à 5.',
      parameters: { mood: { type: 'number', description: 'De 1 (très mal) à 5 (très bien)' } },
      required: ['mood'],
      risk: 'change',
      run: (params) => {
        const s = todaySession();
        patchSession(s.id, { mood: Number(params.mood) });
        return {
          message: `Humeur ${MOODS[Number(params.mood) - 1]} pour ${s.name}.`,
          data: { id: s.id },
          undo: undoTo(s),
        };
      },
    });
    ctx.assistant.define({
      name: 'session-comment',
      examples: COMMENT_EXAMPLES,
      extract: extractComment,
      right,
      description: 'Écrit le commentaire de la séance du jour.',
      parameters: { text: { type: 'string', description: 'Le commentaire' } },
      required: ['text'],
      risk: 'change',
      run: (params) => {
        const s = todaySession();
        patchSession(s.id, { comment: String(params.text) });
        return { message: `Commentaire noté pour ${s.name}.`, data: { id: s.id }, undo: undoTo(s) };
      },
    });
    ctx.assistant.define({
      name: 'move-session',
      examples: MOVE_EXAMPLES,
      extract: extractMove,
      right,
      description: 'Déplace une séance de cette semaine d’un jour à un autre (même semaine).',
      parameters: {
        from: { type: 'number', description: 'Jour de départ, 1 = lundi … 7 = dimanche' },
        to: { type: 'number', description: 'Jour d’arrivée, 1 = lundi … 7 = dimanche' },
      },
      required: ['from', 'to'],
      risk: 'change',
      run: (params) => {
        const monday = mondayOf(today());
        ensureWeek(monday);
        const fromDate = addDays(monday, Number(params.from) - 1);
        const toDate = addDays(monday, Number(params.to) - 1);
        const s = sessionsOf(monday).find((x) => x.date === fromDate && x.status !== 'cancelled');
        if (!s)
          throw new HttpError(
            404,
            `Pas de séance ${WEEKDAYS[Number(params.from) - 1]!.toLowerCase()} cette semaine.`,
          );
        patchSession(s.id, { date: toDate });
        return {
          message: `${s.name} déplacée de ${WEEKDAYS[Number(params.from) - 1]!.toLowerCase()} à ${WEEKDAYS[Number(params.to) - 1]!.toLowerCase()} (${s.start.replace(':', 'h')}–${endTime(s.start, s.durationMin).replace(':', 'h')}).`,
          data: { id: s.id },
          undo: undoTo(s),
        };
      },
    });
  },
});
