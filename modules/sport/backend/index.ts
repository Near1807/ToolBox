// Sport: a weekly template (sessions per weekday with a name, a start time
// and a duration) applied to the weeks to come; each session validated
// (« Fait » / « Pas fait »), with a mood and a comment, its time or duration
// changed, moved to another day of its week, cancelled; sessions added by
// hand; a summary; export. « Prêt pour la synchro » (UUIDs, dates,
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
import type { WeekDto } from '../shared/types';
import {
  COMMENT_EXAMPLES,
  DONE_EXAMPLES,
  extractComment,
  extractDone,
  extractMood,
  extractMove,
  MOOD_EXAMPLES,
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
  ],

  register(ctx: ModuleContext) {
    const store = new SyncStore(ctx.db);
    const t = {
      templates: ctx.db.table('templates'),
      sessions: ctx.db.table('sessions'),
      weeks: ctx.db.table('weeks'),
    };
    const today = () => localToday();

    const toTemplate = (r: TemplateRow): TemplateItem => ({
      id: r.id,
      weekday: r.weekday as Weekday,
      name: r.name,
      start: r.start_time,
      durationMin: r.duration_min,
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
    });
    const template = (): TemplateItem[] =>
      (
        ctx.db
          .prepare(
            `SELECT * FROM ${t.templates} WHERE deleted_at IS NULL ORDER BY weekday, start_time`,
          )
          .all() as TemplateRow[]
      ).map(toTemplate);
    const isMaterialized = (monday: string) =>
      Boolean(
        ctx.db
          .prepare(`SELECT 1 FROM ${t.weeks} WHERE week = ? AND deleted_at IS NULL`)
          .get(monday),
      );
    const insertPlanned = (p: ReturnType<typeof planWeek>[number]) =>
      store.create('sessions', {
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
      (
        ctx.db
          .prepare(
            `SELECT * FROM ${t.sessions} WHERE week = ? AND deleted_at IS NULL ORDER BY date, start_time`,
          )
          .all(monday) as SessionRow[]
      ).map(toSession);
    const sessionsBetween = (from: string, to: string): Session[] =>
      (
        ctx.db
          .prepare(
            `SELECT * FROM ${t.sessions} WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date, start_time`,
          )
          .all(from, to) as SessionRow[]
      ).map(toSession);
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
      if (custom) fields.custom = 1;
      return toSession(store.update<SessionRow>('sessions', id, fields));
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
      return toSession(
        store.create<SessionRow>('sessions', {
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
        }),
      );
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
          } else keep.add(store.create('templates', fields).id);
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
      const data = csv
        ? `date;séance;début;durée_min;état;humeur;commentaire\n${list
            .map((s) =>
              [
                s.date,
                s.name,
                s.start,
                s.durationMin,
                STATUS_FR[s.status],
                s.mood ?? '',
                s.comment.replace(/[\r\n;]+/g, ' '),
              ].join(';'),
            )
            .join('\n')}\n`
        : `# Sport — du ${from} au ${to}\n\n${list
            .map(
              (s) =>
                `- ${s.date} ${s.start} · **${s.name}** (${s.durationMin} min) — ${STATUS_FR[s.status]}${s.mood ? ` ${MOODS[s.mood - 1]}` : ''}${s.comment ? ` — ${s.comment}` : ''}`,
            )
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
