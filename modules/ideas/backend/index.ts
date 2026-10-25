// Boîte à idées: ideas noted quickly (title, optional free text with simple
// formatting, tags, optional track of the library), searched without accents,
// one at random, archived, deleted with « Annuler », and turned into a task of
// the To-do on a click when the To-do is there. Everything works without the
// other modules. The assistant adds ideas only with its own right (off by
// default) and reads them freely (MODULES.md §5.15).
import {
  defineBackendModule,
  HttpError,
  idParam,
  listPhrase,
  type ModuleContext,
  requestBody,
} from '@hub/sdk/backend';
import type { MusicLibraryService } from '../../music-library/contract';
import type { TodoService } from '../../todo/contract';
import {
  cleanTag,
  cleanTags,
  matchesSearch,
  matchesTags,
  type IdeaDto,
  type IdeaSort,
  type IdeasResponse,
  type TagDto,
} from '../shared';
import {
  ADD_EXAMPLES,
  extractAdd,
  extractTagParam,
  LIST_EXAMPLES,
  RANDOM_EXAMPLES,
} from './commands';

interface IdeaRow {
  id: number;
  title: string;
  body: string;
  tags: string;
  subject: string | null;
  archived_at: string | null;
  task_id: number | null;
  task_title: string | null;
  created_at: string;
  updated_at: string;
}

const TRACK_SUBJECT = (id: number) => `music-library:track:${id}`;
const MAX_TITLE = 160;
const MAX_BODY = 20_000;
/** Deleted ideas kept this long in memory for « Annuler ». */
const UNDO_MS = 3600_000;

/** A spoken or typed idea: a short one is its title; a long one keeps the whole text below. */
export function splitIdea(text: string): { title: string; body: string } {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= 90) return { title: clean, body: '' };
  const cut = clean.slice(0, 80);
  const space = cut.lastIndexOf(' ');
  return { title: `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`, body: clean };
}

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'ideas and tag colours',
      up: `
        CREATE TABLE ideas__ideas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          subject TEXT,
          archived_at TEXT,
          task_id INTEGER,
          task_title TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX ideas__ideas_subject ON ideas__ideas (subject);
        CREATE TABLE ideas__tags (
          name TEXT PRIMARY KEY,
          color INTEGER NOT NULL DEFAULT 0
        );
      `,
    },
  ],

  register(ctx: ModuleContext) {
    const ideas = ctx.db.table('ideas');
    const tagTable = ctx.db.table('tags');
    const library = () => ctx.services.optional<MusicLibraryService>('musicLibrary');
    const todo = () => ctx.services.optional<TodoService>('todo');
    const deleted = new Map<number, { row: IdeaRow; at: number }>();

    const tagsOf = (row: IdeaRow) => JSON.parse(row.tags) as string[];
    const trackOf = (row: IdeaRow): IdeaDto['track'] => {
      const service = library();
      if (!service || !row.subject) return null;
      const trackId = service.trackIdOf(row.subject);
      const track = trackId === null ? null : service.getTrack(trackId);
      return track ? { id: track.id, title: track.title } : null;
    };
    const dto = (row: IdeaRow): IdeaDto => ({
      id: row.id,
      title: row.title,
      body: row.body,
      tags: tagsOf(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archived: row.archived_at !== null,
      track: trackOf(row),
      task: row.task_id !== null ? { id: row.task_id, title: row.task_title ?? '' } : null,
    });

    const get = (id: number): IdeaRow => {
      const row = ctx.db.prepare(`SELECT * FROM ${ideas} WHERE id = ?`).get(id) as
        IdeaRow | undefined;
      if (!row) throw new HttpError(404, 'Idée introuvable');
      return row;
    };
    const all = () => ctx.db.prepare(`SELECT * FROM ${ideas} ORDER BY id`).all() as IdeaRow[];

    const colors = () =>
      new Map(
        (
          ctx.db.prepare(`SELECT name, color FROM ${tagTable}`).all() as {
            name: string;
            color: number;
          }[]
        ).map((t) => [t.name, t.color]),
      );
    const tagList = (): TagDto[] => {
      const counts = new Map<string, number>();
      for (const row of all()) for (const t of tagsOf(row)) counts.set(t, (counts.get(t) ?? 0) + 1);
      const color = colors();
      return [...counts]
        .map(([name, count]) => ({ name, count, color: color.get(name) ?? 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    };

    const titleFrom = (value: unknown): string => {
      const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
      if (!title) throw new HttpError(400, 'Le titre de l’idée est obligatoire');
      return title.slice(0, MAX_TITLE);
    };
    const bodyFrom = (value: unknown): string => {
      if (value === undefined || value === null) return '';
      if (typeof value !== 'string') throw new HttpError(400, 'Texte invalide');
      return value.replace(/\r\n/g, '\n').trimEnd().slice(0, MAX_BODY);
    };
    const tagsFrom = (value: unknown): string[] => {
      if (value === undefined || value === null) return [];
      const list = typeof value === 'string' ? value.split(',') : value;
      if (!Array.isArray(list) || list.some((t) => typeof t !== 'string'))
        throw new HttpError(400, 'Tags invalides');
      return cleanTags(list as string[]);
    };
    const subjectFrom = (value: unknown): string | null => {
      if (value === null || value === undefined || value === '') return null;
      const id = Number(value);
      if (!Number.isInteger(id) || !library()?.getTrack(id))
        throw new HttpError(400, 'Morceau introuvable');
      return TRACK_SUBJECT(id);
    };

    const insert = (fields: {
      title: string;
      body: string;
      tags: string[];
      subject: string | null;
    }): IdeaRow => {
      const now = new Date().toISOString();
      const result = ctx.db
        .prepare(
          `INSERT INTO ${ideas} (title, body, tags, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(fields.title, fields.body, JSON.stringify(fields.tags), fields.subject, now, now);
      return get(Number(result.lastInsertRowid));
    };

    const update = (id: number, patch: Record<string, unknown>): IdeaRow => {
      const row = get(id);
      const next = { ...row };
      if ('title' in patch) next.title = titleFrom(patch.title);
      if ('body' in patch) next.body = bodyFrom(patch.body);
      if ('tags' in patch) next.tags = JSON.stringify(tagsFrom(patch.tags));
      if ('trackId' in patch) next.subject = subjectFrom(patch.trackId);
      if ('archived' in patch)
        next.archived_at = patch.archived ? (row.archived_at ?? new Date().toISOString()) : null;
      // Archiving is not a change of the idea itself: « modifiée » keeps its date.
      const edited = ['title', 'body', 'tags', 'trackId'].some((k) => k in patch);
      ctx.db
        .prepare(
          `UPDATE ${ideas} SET title = ?, body = ?, tags = ?, subject = ?, archived_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          next.title,
          next.body,
          next.tags,
          next.subject,
          next.archived_at,
          edited ? new Date().toISOString() : row.updated_at,
          id,
        );
      return get(id);
    };

    const remove = (id: number): IdeaRow => {
      const row = get(id);
      ctx.db.prepare(`DELETE FROM ${ideas} WHERE id = ?`).run(id);
      deleted.set(id, { row, at: Date.now() });
      for (const [key, entry] of deleted) if (Date.now() - entry.at > UNDO_MS) deleted.delete(key);
      return row;
    };
    const restore = (id: number): IdeaRow => {
      const entry = deleted.get(id);
      if (!entry) throw new HttpError(404, 'Plus rien à restaurer pour cette idée');
      const r = entry.row;
      ctx.db
        .prepare(
          `INSERT INTO ${ideas} (id, title, body, tags, subject, archived_at, task_id, task_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          r.id,
          r.title,
          r.body,
          r.tags,
          r.subject,
          r.archived_at,
          r.task_id,
          r.task_title,
          r.created_at,
          r.updated_at,
        );
      deleted.delete(id);
      return get(id);
    };

    /** The list of the page: archives or not, tags (all of them), search, sort. */
    const filtered = (options: {
      archived?: boolean;
      tags?: string[];
      q?: string;
      sort?: IdeaSort;
    }): IdeaRow[] => {
      const rows = all().filter((row) => {
        if ((row.archived_at !== null) !== (options.archived === true)) return false;
        const idea = { title: row.title, body: row.body, tags: tagsOf(row) };
        return matchesTags(idea, options.tags ?? []) && matchesSearch(idea, options.q ?? '');
      });
      const sort = options.sort ?? 'recent';
      return rows.sort((a, b) =>
        sort === 'old'
          ? a.created_at.localeCompare(b.created_at) || a.id - b.id
          : sort === 'modified'
            ? b.updated_at.localeCompare(a.updated_at) || b.id - a.id
            : b.created_at.localeCompare(a.created_at) || b.id - a.id,
      );
    };
    const listQuery = (query: unknown) => {
      const q = query as { q?: string; tags?: string; sort?: string; archived?: string };
      return {
        q: q.q ?? '',
        tags: cleanTags((q.tags ?? '').split(',')),
        sort: (['recent', 'old', 'modified'].includes(q.sort ?? '')
          ? q.sort
          : 'recent') as IdeaSort,
        archived: q.archived === '1' || q.archived === 'true',
      };
    };
    /** One idea at random among those not archived with these tags (null if none). */
    const random = (tags: string[]): IdeaRow | null => {
      const rows = filtered({ tags });
      return rows.length ? rows[Math.floor(Math.random() * rows.length)]! : null;
    };

    // --- Routes ----------------------------------------------------------------

    ctx.routes.get('/ideas', (request): IdeasResponse => {
      const service = library();
      const rows = all();
      return {
        ideas: filtered(listQuery(request.query)).map(dto),
        tags: tagList(),
        counts: {
          active: rows.filter((r) => r.archived_at === null).length,
          archived: rows.filter((r) => r.archived_at !== null).length,
        },
        library: Boolean(service),
        tracks: service ? service.listTracks().map((t) => ({ id: t.id, title: t.title })) : [],
        todo: Boolean(todo()),
      };
    });

    ctx.routes.post('/ideas', (request) => {
      const body = requestBody(request);
      return dto(
        insert({
          title: titleFrom(body.title),
          body: bodyFrom(body.body),
          tags: tagsFrom(body.tags),
          subject: subjectFrom(body.trackId),
        }),
      );
    });
    ctx.routes.patch('/ideas/:id', (request) =>
      dto(update(idParam(request.params), requestBody(request))),
    );
    // The page asks for a confirmation first, then offers « Annuler ».
    ctx.routes.delete('/ideas/:id', (request) => {
      remove(idParam(request.params));
      return { ok: true };
    });
    ctx.routes.post('/ideas/:id/restore', (request) => dto(restore(idParam(request.params))));

    ctx.routes.get('/random', (request) => {
      const row = random(listQuery(request.query).tags);
      return { idea: row ? dto(row) : null };
    });

    /** « Transformer en tâche » (a click): a task of the To-do; the idea stays, marked. */
    ctx.routes.post('/ideas/:id/to-task', (request) => {
      const row = get(idParam(request.params));
      const service = todo();
      if (!service) throw new HttpError(409, 'La To-do n’est pas disponible.');
      if (row.task_id !== null && service.getTask(row.task_id))
        throw new HttpError(409, 'Cette idée est déjà devenue une tâche.');
      const track = trackOf(row);
      const task = service.createTask({ title: row.title, tags: tagsOf(row), trackId: track?.id });
      ctx.db
        .prepare(`UPDATE ${ideas} SET task_id = ?, task_title = ? WHERE id = ?`)
        .run(task.id, task.title, row.id);
      ctx.logger.info(`Idée « ${row.title} » transformée en tâche ${task.id}`);
      return { idea: dto(get(row.id)), task };
    });

    /**
     * A tag renamed (into an existing one: the two are merged) or coloured.
     * Renaming touches every idea that has it, archives included.
     */
    ctx.routes.put('/tags/:name', (request) => {
      const from = cleanTag(decodeURIComponent((request.params as { name: string }).name));
      const body = requestBody(request);
      if (!tagList().some((t) => t.name === from)) throw new HttpError(404, 'Tag introuvable');
      let name = from;
      if (typeof body.name === 'string' && cleanTag(body.name) !== from) {
        name = cleanTag(body.name);
        if (!name) throw new HttpError(400, 'Nom de tag vide');
        const merged = tagList().some((t) => t.name === name);
        ctx.db.transaction(() => {
          for (const row of all()) {
            const tags = tagsOf(row);
            if (!tags.includes(from)) continue;
            const next = cleanTags(tags.map((t) => (t === from ? name : t)));
            ctx.db
              .prepare(`UPDATE ${ideas} SET tags = ? WHERE id = ?`)
              .run(JSON.stringify(next), row.id);
          }
          // The colour goes with the name, unless merged into a tag that has one.
          const old = colors().get(from) ?? 0;
          ctx.db.prepare(`DELETE FROM ${tagTable} WHERE name = ?`).run(from);
          if (!merged || !(colors().get(name) ?? 0))
            ctx.db
              .prepare(`INSERT OR REPLACE INTO ${tagTable} (name, color) VALUES (?, ?)`)
              .run(name, old);
        });
        ctx.logger.info(`Tag « ${from} » ${merged ? 'fusionné dans' : 'renommé en'} « ${name} »`);
      }
      if (body.color !== undefined) {
        const color = Number(body.color);
        if (!Number.isInteger(color) || color < 0 || color > 8)
          throw new HttpError(400, 'Couleur invalide');
        ctx.db
          .prepare(`INSERT OR REPLACE INTO ${tagTable} (name, color) VALUES (?, ?)`)
          .run(name, color);
      }
      return { tags: tagList() };
    });

    /** Export in Markdown, through « Enregistrer sous » (a file of the user, not of a project). */
    ctx.routes.post('/export', async (request) => {
      const withArchives = requestBody(request).archives === true;
      const rows = filtered({ sort: 'old' }).concat(
        withArchives ? filtered({ sort: 'old', archived: true }) : [],
      );
      const saved = await ctx.files.saveAs({
        title: 'Exporter les idées',
        defaultName: `Boîte à idées - ${new Date().toISOString().slice(0, 10)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        data: markdownOf(rows.map(dto)),
      });
      return saved ? { path: saved, count: rows.length } : { cancelled: true };
    });

    ctx.routes.get('/home', () => {
      const rows = filtered({});
      return {
        show: ctx.settings.get<boolean>('homeWidget') !== false,
        count: rows.length,
        latest: rows.slice(0, 3).map((r) => ({ id: r.id, title: r.title })),
      };
    });

    // --- Track page of the library -------------------------------------------

    const service = library();
    if (service) {
      const remover = service.registerTrackInfo({
        moduleId: ctx.id,
        label: 'Boîte à idées',
        get: (trackId) => {
          const rows = ctx.db
            .prepare(
              `SELECT * FROM ${ideas} WHERE subject = ? AND archived_at IS NULL ORDER BY id DESC`,
            )
            .all(TRACK_SUBJECT(trackId)) as IdeaRow[];
          if (!rows.length) return null;
          return `${rows.length} idée${rows.length > 1 ? 's' : ''} : ${rows
            .slice(0, 3)
            .map((r) => r.title)
            .join(' · ')}${rows.length > 3 ? ' · …' : ''}`;
        },
      });
      ctx.onShutdown(remover);
    }

    // --- Assistant actions (MODULES.md §5.15) ----------------------------------

    const tagPhrase = (tag: string | null) => (tag ? ` avec le tag ${tag}` : '');

    ctx.assistant.define({
      name: 'add-idea',
      examples: ADD_EXAMPLES,
      extract: extractAdd,
      right: { id: 'add-ideas', label: 'L’assistant peut ajouter des idées' },
      description:
        'Note une idée dans la Boîte à idées (pas une tâche). text : l’idée telle que dite ; tags : seulement ceux demandés.',
      parameters: {
        text: { type: 'string', description: 'L’idée, ex. « un break avec des cordes »' },
        tags: { type: 'string[]', description: 'Tags, ex. ["arrangement"]' },
      },
      required: ['text'],
      risk: 'change',
      run: (params) => {
        const { title, body } = splitIdea(String(params.text ?? ''));
        if (!title) throw new HttpError(400, 'Quelle idée ?');
        const tags = cleanTags((params.tags as string[] | undefined) ?? []);
        const row = insert({ title, body, tags, subject: null });
        return {
          message: `Idée notée : « ${row.title} »${tags.length ? ` (${tags.map((t) => `#${t}`).join(' ')})` : ''}.`,
          data: { idea: { id: row.id, title: row.title, tags } },
          undo: () => {
            ctx.db.prepare(`DELETE FROM ${ideas} WHERE id = ?`).run(row.id);
          },
        };
      },
    });

    ctx.assistant.define({
      name: 'list-ideas',
      examples: LIST_EXAMPLES,
      extract: extractTagParam,
      description:
        'Liste les idées de la Boîte à idées (les plus récentes d’abord), d’un tag si demandé.',
      parameters: { tag: { type: 'string', description: 'Seulement ce tag, ex. « musique »' } },
      risk: 'read',
      run: (params) => {
        const tag = params.tag ? cleanTag(String(params.tag)) : null;
        const rows = filtered({ tags: tag ? [tag] : [] });
        const titles = rows.slice(0, 5).map((r) => `« ${r.title} »`);
        return {
          message: rows.length
            ? `${rows.length} idée${rows.length > 1 ? 's' : ''}${tagPhrase(tag)} : ${listPhrase(titles)}${rows.length > 5 ? ', etc.' : ''}.`
            : `Aucune idée${tagPhrase(tag)}.`,
          data: {
            ideas: rows.slice(0, 20).map((r) => ({ id: r.id, title: r.title, tags: tagsOf(r) })),
            count: rows.length,
          },
        };
      },
    });

    ctx.assistant.define({
      name: 'random-idea',
      examples: RANDOM_EXAMPLES,
      extract: extractTagParam,
      description: 'Donne une idée au hasard de la Boîte à idées (d’un tag si demandé).',
      parameters: { tag: { type: 'string', description: 'Seulement ce tag, ex. « musique »' } },
      risk: 'read',
      run: (params) => {
        const tag = params.tag ? cleanTag(String(params.tag)) : null;
        const row = random(tag ? [tag] : []);
        return {
          message: row
            ? `Une idée au hasard : « ${row.title} ».`
            : `Aucune idée${tagPhrase(tag)} pour l’instant.`,
          data: row ? { idea: { id: row.id, title: row.title, body: row.body } } : { idea: null },
        };
      },
    });
  },
});

/** The ideas as Markdown: a title per idea, its tags, dates, track, task, then its text. */
export function markdownOf(list: IdeaDto[]): string {
  const day = (iso: string) => iso.slice(0, 10);
  const lines = [
    `# Boîte à idées`,
    '',
    `${list.length} idée(s), exportées le ${day(new Date().toISOString())}.`,
    '',
  ];
  for (const idea of list) {
    lines.push(`## ${idea.title}`, '');
    const facts = [
      idea.tags.length ? idea.tags.map((t) => `#${t}`).join(' ') : null,
      `créée le ${day(idea.createdAt)}`,
      idea.updatedAt !== idea.createdAt ? `modifiée le ${day(idea.updatedAt)}` : null,
      idea.track ? `morceau : ${idea.track.title}` : null,
      idea.task ? 'devenue une tâche' : null,
      idea.archived ? 'archivée' : null,
    ].filter(Boolean);
    lines.push(`*${facts.join(' · ')}*`, '');
    if (idea.body) lines.push(idea.body, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
