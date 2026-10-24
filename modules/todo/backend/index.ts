// To-do: tasks with tags, an optional due date (natural French accepted), a
// « Fait » box and an optional track of the library. The assistant drives it
// through the actions declared at the end (docs/MODULES.md §5.15).
import {
  type AssistantParams,
  defineBackendModule,
  HttpError,
  idParam,
  listPhrase,
  matchByName,
  type ModuleContext,
  NotFoundError,
  requestBody,
} from '@hub/sdk/backend';
import type { MusicLibraryService } from '../../music-library/contract';
import type { TimerService } from '../../timer/contract';
import type { TodoService, TodoTask } from '../contract';
import { formatDue, localToday, parseDue, spokenDue, daysBetween, addDays } from '../dates';
import { cleanTags, type TaskDto, type TasksResponse } from '../shared';
import {
  ADD_EXAMPLES,
  COMPLETE_EXAMPLES,
  DELETE_EXAMPLES,
  extractAdd,
  extractComplete,
  extractDelete,
  extractList,
  LIST_EXAMPLES,
} from './commands';

interface TaskRow {
  id: number;
  title: string;
  tags: string;
  due_date: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  subject: string | null;
}

const TRACK_SUBJECT = (id: number) => `music-library:track:${id}`;
const MAX_TITLE = 200;

/** « avec le tag mix » / « avec les tags mix et studio ». */
function tagsPhrase(tags: string[]): string {
  if (tags.length === 0) return '';
  if (tags.length === 1) return ` avec le tag ${tags[0]}`;
  return ` avec les tags ${tags.slice(0, -1).join(', ')} et ${tags.at(-1)}`;
}

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'tasks',
      up: `
        CREATE TABLE todo__tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          due_date TEXT,
          done_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          subject TEXT
        );
        CREATE INDEX todo__tasks_subject ON todo__tasks (subject);
      `,
    },
  ],

  register(ctx: ModuleContext) {
    const tasks = ctx.db.table('tasks');
    const library = () => ctx.services.optional<MusicLibraryService>('musicLibrary');
    // Optional both ways with the Timer: asked at the time of use (MODULES.md §5.8).
    const timer = () => ctx.services.optional<TimerService>('timer');
    /** Deleted rows kept a while for « Annuler » (in memory only). */
    const deleted = new Map<number, { row: TaskRow; at: number }>();

    const trackOf = (row: TaskRow): TaskDto['track'] => {
      const service = library();
      if (!service || !row.subject) return null;
      const trackId = service.trackIdOf(row.subject);
      const track = trackId === null ? null : service.getTrack(trackId);
      return track ? { id: track.id, title: track.title } : null;
    };

    const dto = (row: TaskRow, times = timer()?.timeByTask() ?? {}): TaskDto => ({
      id: row.id,
      title: row.title,
      tags: JSON.parse(row.tags) as string[],
      due: row.due_date,
      done: row.done_at !== null,
      doneAt: row.done_at,
      createdAt: row.created_at,
      track: trackOf(row),
      timeSpent: Math.round(times[row.id] ?? 0),
    });

    const get = (id: number): TaskRow => {
      const row = ctx.db.prepare(`SELECT * FROM ${tasks} WHERE id = ?`).get(id) as
        TaskRow | undefined;
      if (!row) throw new HttpError(404, 'Tâche introuvable');
      return row;
    };
    const all = () => ctx.db.prepare(`SELECT * FROM ${tasks} ORDER BY id`).all() as TaskRow[];

    /** Open tasks first by due date (none last), then done ones, latest first. */
    const sorted = (rows: TaskRow[]) =>
      [...rows].sort((a, b) => {
        if ((a.done_at === null) !== (b.done_at === null)) return a.done_at === null ? -1 : 1;
        if (a.done_at && b.done_at) return b.done_at.localeCompare(a.done_at);
        if (a.due_date !== b.due_date) {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        }
        return a.id - b.id;
      });

    const tagCounts = () => {
      const counts = new Map<string, number>();
      for (const row of all()) {
        for (const tag of JSON.parse(row.tags) as string[])
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      return [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    };

    /** ISO date, natural French, or null/"" for none. */
    const dueFrom = (value: unknown): string | null => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value !== 'string') throw new HttpError(400, 'Échéance invalide');
      const due = parseDue(value, localToday());
      if (!due)
        throw new HttpError(
          400,
          `Échéance pas comprise : « ${value} » (ex. « demain », « vendredi », « le 12 novembre »).`,
        );
      return due;
    };

    const titleFrom = (value: unknown): string => {
      const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
      if (!title) throw new HttpError(400, 'Le titre de la tâche est obligatoire');
      return title.slice(0, MAX_TITLE);
    };

    const tagsFrom = (value: unknown): string[] => {
      if (value === undefined || value === null) return [];
      const list = typeof value === 'string' ? value.split(',') : value;
      if (!Array.isArray(list) || list.some((t) => typeof t !== 'string')) {
        throw new HttpError(400, 'Tags invalides');
      }
      return cleanTags(list as string[]);
    };

    const subjectFromTrackId = (value: unknown): string | null => {
      if (value === null || value === undefined || value === '') return null;
      const id = Number(value);
      if (!Number.isInteger(id) || !library()?.getTrack(id))
        throw new HttpError(400, 'Morceau introuvable');
      return TRACK_SUBJECT(id);
    };

    const insert = (fields: {
      title: string;
      tags: string[];
      due: string | null;
      subject: string | null;
    }): TaskRow => {
      const now = new Date().toISOString();
      const result = ctx.db
        .prepare(
          `INSERT INTO ${tasks} (title, tags, due_date, created_at, updated_at, subject) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(fields.title, JSON.stringify(fields.tags), fields.due, now, now, fields.subject);
      return get(Number(result.lastInsertRowid));
    };

    const update = (id: number, patch: Record<string, unknown>): TaskRow => {
      const row = get(id);
      const next = { ...row };
      if ('title' in patch) next.title = titleFrom(patch.title);
      if ('tags' in patch) next.tags = JSON.stringify(tagsFrom(patch.tags));
      if ('due' in patch) next.due_date = dueFrom(patch.due);
      if ('done' in patch)
        next.done_at = patch.done ? (row.done_at ?? new Date().toISOString()) : null;
      if ('trackId' in patch) next.subject = subjectFromTrackId(patch.trackId);
      ctx.db
        .prepare(
          `UPDATE ${tasks} SET title = ?, tags = ?, due_date = ?, done_at = ?, subject = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          next.title,
          next.tags,
          next.due_date,
          next.done_at,
          next.subject,
          new Date().toISOString(),
          id,
        );
      return get(id);
    };

    const remove = (id: number): TaskRow => {
      const row = get(id);
      ctx.db.prepare(`DELETE FROM ${tasks} WHERE id = ?`).run(id);
      deleted.set(id, { row, at: Date.now() });
      for (const [key, entry] of deleted) if (Date.now() - entry.at > 3600_000) deleted.delete(key);
      return row;
    };

    const restore = (id: number): TaskRow => {
      const entry = deleted.get(id);
      if (!entry) throw new HttpError(404, 'Plus rien à restaurer pour cette tâche');
      const r = entry.row;
      ctx.db
        .prepare(
          `INSERT INTO ${tasks} (id, title, tags, due_date, done_at, created_at, updated_at, subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          r.id,
          r.title,
          r.tags,
          r.due_date,
          r.done_at,
          r.created_at,
          new Date().toISOString(),
          r.subject,
        );
      deleted.delete(id);
      return get(id);
    };

    // --- Routes ---------------------------------------------------------------

    ctx.routes.get('/tasks', (): TasksResponse => {
      const service = library();
      const times = timer()?.timeByTask() ?? {};
      return {
        today: localToday(),
        tasks: sorted(all()).map((row) => dto(row, times)),
        tags: tagCounts(),
        library: Boolean(service),
        tracks: service ? service.listTracks().map((t) => ({ id: t.id, title: t.title })) : [],
        timer: Boolean(timer()),
      };
    });

    ctx.routes.post('/tasks', (request) => {
      const body = requestBody(request);
      return dto(
        insert({
          title: titleFrom(body.title),
          tags: tagsFrom(body.tags),
          due: dueFrom(body.due),
          subject: subjectFromTrackId(body.trackId),
        }),
      );
    });

    ctx.routes.patch('/tasks/:id', (request) =>
      dto(update(idParam(request.params), requestBody(request))),
    );

    ctx.routes.delete('/tasks/:id', (request) => {
      remove(idParam(request.params));
      return { ok: true };
    });

    ctx.routes.post('/tasks/:id/restore', (request) => dto(restore(idParam(request.params))));

    // Home widget: what is due today or late.
    ctx.routes.get('/today', () => {
      const today = localToday();
      const open = sorted(all()).filter((r) => r.done_at === null);
      return {
        today,
        open: open.length,
        due: open.filter((r) => r.due_date !== null && r.due_date <= today).map((r) => dto(r)),
      };
    });

    // --- Service for the other modules (the Timer) ------------------------------

    const summary = (row: TaskRow): TodoTask => ({
      id: row.id,
      title: row.title,
      tags: JSON.parse(row.tags) as string[],
      due: row.due_date,
      done: row.done_at !== null,
    });
    ctx.services.provide<TodoService>('todo', {
      listOpenTasks: () =>
        sorted(all())
          .filter((r) => r.done_at === null)
          .map(summary),
      getTask: (id) => {
        const row = ctx.db.prepare(`SELECT * FROM ${tasks} WHERE id = ?`).get(id) as
          TaskRow | undefined;
        return row ? summary(row) : null;
      },
      completeTask: (id) => summary(update(id, { done: true })),
    });

    // --- Track page of the library -------------------------------------------

    const service = library();
    if (service) {
      const remover = service.registerTrackInfo({
        moduleId: ctx.id,
        label: 'To-do',
        get: (trackId) => {
          const open = sorted(
            ctx.db
              .prepare(`SELECT * FROM ${tasks} WHERE subject = ? AND done_at IS NULL`)
              .all(TRACK_SUBJECT(trackId)) as TaskRow[],
          );
          if (open.length === 0) return null;
          const today = localToday();
          const shown = open
            .slice(0, 3)
            .map((r) => (r.due_date ? `${r.title} (${formatDue(r.due_date, today)})` : r.title));
          return `${open.length} à faire : ${shown.join(' · ')}${open.length > 3 ? ' · …' : ''}`;
        },
      });
      ctx.onShutdown(remover);
    }

    // --- Assistant actions (MODULES.md §5.15) ----------------------------------

    const findTrack = (name: string) => {
      const service = library();
      if (!service)
        throw new HttpError(
          409,
          'La Bibliothèque n’est pas disponible : impossible de rattacher un morceau.',
        );
      const match = matchByName(service.listTracks(), name, (t) => [
        t.title,
        ...(t.nicknames ?? []),
      ]);
      if (match.kind === 'none')
        throw new NotFoundError(
          'track',
          'le morceau',
          name,
          match.suggestions.map((t) => t.title),
        );
      if (match.kind === 'ambiguous') {
        throw new HttpError(
          409,
          `Plusieurs morceaux correspondent à « ${name} » : ${listPhrase(match.items.slice(0, 4).map((t) => t.title))}. Lequel ?`,
        );
      }
      return match.item;
    };

    /** A task from its number or its title (open tasks first). */
    const findTask = (wanted: string, scope: 'open' | 'done' | 'any' = 'open'): TaskRow => {
      if (/^\d+$/.test(wanted.trim())) return get(Number(wanted));
      const rows = all().filter((r) =>
        scope === 'any' ? true : scope === 'open' ? r.done_at === null : r.done_at !== null,
      );
      const match = matchByName(rows, wanted, (r) => r.title);
      if (match.kind === 'none') {
        throw new NotFoundError(
          'task',
          `de tâche ${scope === 'done' ? 'faite ' : scope === 'open' ? 'à faire ' : ''}qui ressemble à`,
          wanted,
          match.suggestions.map((r) => r.title),
        );
      }
      if (match.kind === 'ambiguous') {
        throw new HttpError(
          409,
          `Plusieurs tâches correspondent : ${listPhrase(match.items.slice(0, 4).map((r) => `« ${r.title} »`))}. Laquelle ?`,
        );
      }
      return match.item;
    };

    const describeTask = (row: TaskRow, today: string) => {
      const task = dto(row);
      return {
        id: task.id,
        title: task.title,
        tags: task.tags,
        due: task.due ? spokenDue(task.due, today) : null,
        lateDays: task.due && !task.done && task.due < today ? daysBetween(task.due, today) : 0,
        done: task.done,
        track: task.track?.title ?? null,
      };
    };

    ctx.assistant.define({
      name: 'add-task',
      examples: ADD_EXAMPLES,
      extract: (utterance) => extractAdd(utterance, localToday()),
      right: { id: 'edit-tasks', label: 'L’assistant peut ajouter et cocher des tâches' },
      description:
        'Ajoute une tâche à la To-do. L’échéance se donne en français tel que dit (« demain », « vendredi », « dans 3 jours », « le 12 novembre ») : ne la convertis pas toi-même.',
      parameters: {
        title: { type: 'string', description: 'Titre court de la tâche, ex. « finir le mix »' },
        tags: { type: 'string[]', description: 'Tags, ex. ["mix"]. Seulement ceux demandés.' },
        due: {
          type: 'string',
          description: 'Échéance telle que dite, ex. « vendredi ». Absent si aucune.',
        },
        track: {
          type: 'string',
          description: 'Morceau de la Bibliothèque concerné, ex. « boumboum ». Absent si aucun.',
        },
      },
      required: ['title'],
      risk: 'change',
      run: (params: AssistantParams) => {
        const today = localToday();
        const known = new Set(tagCounts().map((t) => t.name));
        const tags = cleanTags((params.tags as string[] | undefined) ?? []);
        const due = params.due ? parseDue(String(params.due), today) : null;
        if (params.due && !due) {
          throw new HttpError(
            400,
            `Je n’ai pas compris l’échéance « ${String(params.due)} ». Pour quand ?`,
          );
        }
        const track = params.track ? findTrack(String(params.track)) : null;
        const row = insert({
          title: titleFrom(params.title),
          tags,
          due,
          subject: track ? TRACK_SUBJECT(track.id) : null,
        });
        const newTags = tags.filter((t) => !known.has(t));
        return {
          message: `J’ai ajouté « ${row.title} »${tagsPhrase(tags)}${due ? ` pour ${spokenDue(due, today)}` : ''}${track ? `, sur le morceau ${track.title}` : ''}.`,
          data: { task: describeTask(row, today), newTags },
          undo: () => {
            ctx.db.prepare(`DELETE FROM ${tasks} WHERE id = ?`).run(row.id);
          },
        };
      },
    });

    ctx.assistant.define({
      name: 'list-tasks',
      examples: LIST_EXAMPLES,
      extract: extractList,
      description:
        'Liste les tâches de la To-do. filter : « open » (à faire, défaut), « today » (à faire aujourd’hui, retards compris), « overdue » (en retard), « week » (7 prochains jours), « done » (faites), « all ».',
      parameters: {
        filter: {
          type: 'string',
          description: 'Quelles tâches',
          enum: ['open', 'today', 'overdue', 'week', 'done', 'all'],
        },
        tag: { type: 'string', description: 'Seulement ce tag, ex. « mix »' },
        track: { type: 'string', description: 'Seulement ce morceau, ex. « boumboum »' },
      },
      risk: 'read',
      run: (params) => {
        const today = localToday();
        const filter = String(params.filter ?? 'open');
        const tag = params.tag ? cleanTags([String(params.tag)])[0] : null;
        const track = params.track ? findTrack(String(params.track)) : null;
        const rows = sorted(all()).filter((r) => {
          const open = r.done_at === null;
          if (filter === 'open' && !open) return false;
          if (filter === 'done' && open) return false;
          if (filter === 'today' && !(open && r.due_date !== null && r.due_date <= today))
            return false;
          if (filter === 'overdue' && !(open && r.due_date !== null && r.due_date < today))
            return false;
          if (
            filter === 'week' &&
            !(open && r.due_date !== null && r.due_date <= addDays(today, 7))
          )
            return false;
          if (tag && !(JSON.parse(r.tags) as string[]).includes(tag)) return false;
          if (track && r.subject !== TRACK_SUBJECT(track.id)) return false;
          return true;
        });
        const list = rows.map((r) => describeTask(r, today));
        const what =
          {
            open: 'à faire',
            today: 'pour aujourd’hui',
            overdue: 'en retard',
            week: 'pour les 7 prochains jours',
            done: 'faites',
            all: 'en tout',
          }[filter] ?? 'à faire';
        const scope = `${tag ? ` avec le tag ${tag}` : ''}${track ? ` sur ${track.title}` : ''}`;
        let message: string;
        if (list.length === 0) message = `Aucune tâche ${what}${scope}.`;
        else {
          const names = list
            .slice(0, 5)
            .map((t) => (t.lateDays > 0 ? `${t.title} (en retard)` : t.title));
          message = `${list.length} tâche${list.length > 1 ? 's' : ''} ${what}${scope} : ${listPhrase(names)}${list.length > 5 ? ', etc.' : ''}.`;
        }
        return {
          message,
          data: {
            tasks: list.slice(0, 20),
            count: list.length,
            tags: tagCounts().map((t) => t.name),
          },
        };
      },
    });

    ctx.assistant.define({
      name: 'complete-task',
      examples: COMPLETE_EXAMPLES,
      extract: extractComplete,
      right: { id: 'edit-tasks', label: 'L’assistant peut ajouter et cocher des tâches' },
      description: 'Coche une tâche comme faite (par son titre approximatif ou son numéro).',
      parameters: {
        task: { type: 'string', description: 'Titre (même approximatif) ou numéro de la tâche' },
      },
      required: ['task'],
      risk: 'change',
      run: (params) => {
        const row = findTask(String(params.task), 'open');
        update(row.id, { done: true });
        return {
          message: `C’est coché : « ${row.title} ».`,
          data: { id: row.id },
          undo: () => void update(row.id, { done: false }),
        };
      },
    });

    ctx.assistant.define({
      name: 'delete-task',
      examples: DELETE_EXAMPLES,
      extract: extractDelete,
      right: {
        id: 'delete-tasks',
        label: 'L’assistant peut supprimer des tâches (toujours après un « oui »)',
      },
      description: 'Supprime une tâche (demande confirmation avant).',
      parameters: {
        task: { type: 'string', description: 'Titre (même approximatif) ou numéro de la tâche' },
      },
      required: ['task'],
      risk: 'destructive',
      confirmation: (params) =>
        `Je supprime la tâche « ${findTask(String(params.task), 'any').title} » ?`,
      run: (params) => {
        const row = remove(findTask(String(params.task), 'any').id);
        return {
          message: `J’ai supprimé la tâche « ${row.title} ».`,
          data: { id: row.id },
          undo: () => void restore(row.id),
        };
      },
    });

    ctx.assistant.define({
      name: 'list-tags',
      description: 'Donne les tags existants de la To-do (pour réutiliser le bon).',
      risk: 'read',
      run: () => {
        const tags = tagCounts();
        return {
          message: tags.length
            ? `Tags : ${listPhrase(tags.map((t) => t.name))}.`
            : 'Aucun tag pour l’instant.',
          data: { tags },
        };
      },
    });
  },
});
