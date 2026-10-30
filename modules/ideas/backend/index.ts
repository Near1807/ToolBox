// Boîte à idées: ideas noted quickly (title, optional free text with simple
// formatting, tags, optional track of the library), searched without accents,
// one at random, archived, deleted with « Annuler », and turned into a task of
// the To-do on a click when the To-do is there. Everything works without the
// other modules. The assistant adds ideas only with its own right (off by
// default) and reads them freely (MODULES.md §5.15).
import {
  changesTableSql,
  defineBackendModule,
  HttpError,
  listPhrase,
  type MigrationDatabase,
  type ModuleContext,
  requestBody,
  SYNC_COLUMNS,
  SyncStore,
  uuidParam,
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
  id: string;
  title: string;
  body: string;
  tags: string;
  subject: string | null;
  archived_at: string | null;
  /** The task of the To-do it became (its UUID), or null. */
  task_id: string | null;
  task_title: string | null;
  created_at: string;
  /** Last change of any kind (synchronisation). */
  updated_at: string;
  deleted_at: string | null;
  /** Last change of the idea itself (title, text, tags, track): « modifiée le »; null: never. */
  edited_at: string | null;
  /** Its number before v0.25 (migration 2), null for an idea noted since. */
  legacy_id: number | null;
}

interface TagRow {
  id: string;
  name: string;
  color: number;
  deleted_at: string | null;
}

const TRACK_SUBJECT = (id: number) => `music-library:track:${id}`;
/** « modifiée le »: the last change of the idea itself, else its creation. */
const editedAt = (row: { created_at: string; edited_at: string | null }) =>
  row.edited_at ?? row.created_at;
const MAX_TITLE = 160;
const MAX_BODY = 20_000;

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
    {
      version: 2,
      description: 'ready for sync: UUIDs, dates, tombstones, journal (old tables kept)',
      up: (db) => migrateToSync(db),
    },
  ],

  register(ctx: ModuleContext) {
    const ideas = ctx.db.table('ideas');
    const tagTable = ctx.db.table('tags');
    const library = () => ctx.services.optional<MusicLibraryService>('musicLibrary');
    const todo = () => ctx.services.optional<TodoService>('todo');
    const store = new SyncStore(ctx.db);

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
      updatedAt: editedAt(row),
      archived: row.archived_at !== null,
      track: trackOf(row),
      task: row.task_id !== null ? { id: row.task_id, title: row.task_title ?? '' } : null,
    });

    const get = (id: string): IdeaRow => {
      const row = store.get<IdeaRow>('ideas', id);
      if (!row) throw new HttpError(404, 'Idée introuvable');
      return row;
    };
    const all = () =>
      ctx.db
        .prepare(
          `SELECT * FROM ${ideas} WHERE deleted_at IS NULL ORDER BY created_at, legacy_id, id`,
        )
        .all() as IdeaRow[];
    /** Same creation date: the old order (number), then the id. */
    const sameTime = (a: IdeaRow, b: IdeaRow) =>
      (a.legacy_id ?? 0) - (b.legacy_id ?? 0) || a.id.localeCompare(b.id);

    const tagRows = () =>
      ctx.db.prepare(`SELECT * FROM ${tagTable} WHERE deleted_at IS NULL`).all() as TagRow[];
    const tagRow = (name: string) => tagRows().find((t) => t.name === name) ?? null;
    const colors = () => new Map(tagRows().map((t) => [t.name, t.color]));
    /** The colour of a tag (a row created the first time). */
    const setColor = (name: string, color: number) => {
      const row = tagRow(name);
      if (!row) store.create('tags', { name, color });
      else if (row.color !== color) store.update('tags', row.id, { color });
    };
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
      const row = store.create<IdeaRow>('ideas', {
        title: fields.title,
        body: fields.body,
        tags: JSON.stringify(fields.tags),
        subject: fields.subject,
        archived_at: null,
        task_id: null,
        task_title: null,
        edited_at: null,
        legacy_id: null,
      });
      return row;
    };

    /** Only the fields that change are written (and journaled). */
    const update = (id: string, patch: Record<string, unknown>): IdeaRow => {
      const row = get(id);
      const next: Partial<Record<keyof IdeaRow, string | null>> = {};
      if ('title' in patch) next.title = titleFrom(patch.title);
      if ('body' in patch) next.body = bodyFrom(patch.body);
      if ('tags' in patch) next.tags = JSON.stringify(tagsFrom(patch.tags));
      if ('trackId' in patch) next.subject = subjectFrom(patch.trackId);
      if ('archived' in patch)
        next.archived_at = patch.archived ? (row.archived_at ?? new Date().toISOString()) : null;
      // Archiving is not a change of the idea itself: « modifiée » keeps its date.
      if (['title', 'body', 'tags', 'trackId'].some((k) => k in patch))
        next.edited_at = new Date().toISOString();
      const changed = Object.fromEntries(
        Object.entries(next).filter(([key, value]) => row[key as keyof IdeaRow] !== value),
      ) as Record<string, string | null>;
      return Object.keys(changed).length ? store.update<IdeaRow>('ideas', id, changed) : row;
    };

    /** A tombstone (« Annuler » brings it back; the future sync sees the deletion). */
    const remove = (id: string): IdeaRow => {
      const row = get(id);
      store.remove('ideas', id);
      return row;
    };
    const restore = (id: string): IdeaRow => {
      const row = store.get<IdeaRow>('ideas', id, true);
      if (!row || row.deleted_at === null)
        throw new HttpError(404, 'Plus rien à restaurer pour cette idée');
      store.restore('ideas', id);
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
          ? a.created_at.localeCompare(b.created_at) || sameTime(a, b)
          : sort === 'modified'
            ? editedAt(b).localeCompare(editedAt(a)) || sameTime(b, a)
            : b.created_at.localeCompare(a.created_at) || sameTime(b, a),
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
      dto(update(uuidParam(request.params), requestBody(request))),
    );
    // The page asks for a confirmation first, then offers « Annuler ».
    ctx.routes.delete('/ideas/:id', (request) => {
      remove(uuidParam(request.params));
      return { ok: true };
    });
    ctx.routes.post('/ideas/:id/restore', (request) => dto(restore(uuidParam(request.params))));

    ctx.routes.get('/random', (request) => {
      const row = random(listQuery(request.query).tags);
      return { idea: row ? dto(row) : null };
    });

    /** « Transformer en tâche » (a click): a task of the To-do; the idea stays, marked. */
    ctx.routes.post('/ideas/:id/to-task', (request) => {
      const row = get(uuidParam(request.params));
      const service = todo();
      if (!service) throw new HttpError(409, 'La To-do n’est pas disponible.');
      if (row.task_id !== null && service.getTask(row.task_id))
        throw new HttpError(409, 'Cette idée est déjà devenue une tâche.');
      const track = trackOf(row);
      const task = service.createTask({ title: row.title, tags: tagsOf(row), trackId: track?.id });
      store.update('ideas', row.id, { task_id: task.id, task_title: task.title });
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
            // Not a change of the idea's text: « modifiée » keeps its date (as before).
            store.update('ideas', row.id, { tags: JSON.stringify(next) });
          }
          // The colour goes with the name, unless merged into a tag that has one.
          const old = tagRow(from);
          const target = tagRow(name);
          if (!merged && old) store.update('tags', old.id, { name });
          else {
            if (old) store.remove('tags', old.id);
            if (!(target?.color ?? 0)) setColor(name, old?.color ?? 0);
          }
        });
        ctx.logger.info(`Tag « ${from} » ${merged ? 'fusionné dans' : 'renommé en'} « ${name} »`);
      }
      if (body.color !== undefined) {
        const color = Number(body.color);
        if (!Number.isInteger(color) || color < 0 || color > 8)
          throw new HttpError(400, 'Couleur invalide');
        setColor(name, color);
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
              `SELECT * FROM ${ideas} WHERE subject = ? AND archived_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC, legacy_id DESC`,
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
          undo: () => store.remove('ideas', row.id),
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

/**
 * Migration 2 (v0.25): ideas and tag colours get a UUID, a tombstone and a
 * journal (« Prêt pour la synchro », MODULES.md §6 bis). The old tables stay
 * as `ideas_v1` and `tags_v1`, untouched. Each idea is copied with the same
 * values and dates (`edited_at` = its old « modifiée le »), its new id is
 * `legacyId('ideas:idea', n)`; the task it became is `legacyId('todo:task',
 * n)`, the UUID the To-do gives its task n. Old → new pairs in `legacy_ids`.
 */
export function migrateToSync(db: MigrationDatabase): void {
  const ideas = db.table('ideas');
  const tags = db.table('tags');
  const legacy = db.table('legacy_ids');
  const journal = db.table('changes');
  db.exec(`
    ALTER TABLE ${ideas} RENAME TO ${ideas}_v1;
    ALTER TABLE ${tags} RENAME TO ${tags}_v1;
    DROP INDEX IF EXISTS ${ideas}_subject;
    CREATE INDEX ${ideas}_v1_subject ON ${ideas}_v1 (subject);
    CREATE TABLE ${ideas} (
      ${SYNC_COLUMNS},
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      subject TEXT,
      archived_at TEXT,
      task_id TEXT,
      task_title TEXT,
      edited_at TEXT,
      legacy_id INTEGER
    );
    CREATE INDEX ${ideas}_subject ON ${ideas} (subject);
    CREATE TABLE ${tags} (
      ${SYNC_COLUMNS},
      name TEXT NOT NULL,
      color INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX ${tags}_name ON ${tags} (name) WHERE deleted_at IS NULL;
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
  const insertIdea = db.prepare(
    `INSERT INTO ${ideas} (id, created_at, updated_at, deleted_at, title, body, tags, subject, archived_at, task_id, task_title, edited_at, legacy_id) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  type OldIdea = Omit<IdeaRow, 'id' | 'task_id' | 'deleted_at' | 'edited_at' | 'legacy_id'> & {
    id: number;
    task_id: number | null;
  };
  for (const r of db.prepare(`SELECT * FROM ${ideas}_v1 ORDER BY id`).all() as OldIdea[]) {
    const id = db.legacyId('ideas:idea', r.id);
    const fields = {
      title: r.title,
      body: r.body,
      tags: r.tags,
      subject: r.subject,
      archived_at: r.archived_at,
      task_id: r.task_id === null ? null : db.legacyId('todo:task', r.task_id),
      task_title: r.task_title,
      edited_at: r.updated_at,
    };
    insertIdea.run(id, r.created_at, r.updated_at, ...Object.values(fields), r.id);
    pair.run('ideas', r.id, id);
    log.run(
      db.legacyId('ideas:journal:idea', r.id),
      r.updated_at,
      'ideas',
      id,
      JSON.stringify(fields),
    );
  }
  // Tag colours had their name as key: numbered by their row, in order.
  const now = new Date().toISOString();
  const insertTag = db.prepare(
    `INSERT INTO ${tags} (id, created_at, updated_at, deleted_at, name, color) VALUES (?, ?, ?, NULL, ?, ?)`,
  );
  for (const r of db
    .prepare(`SELECT rowid AS n, name, color FROM ${tags}_v1 ORDER BY rowid`)
    .all() as {
    n: number;
    name: string;
    color: number;
  }[]) {
    const id = db.legacyId('ideas:tag', r.n);
    insertTag.run(id, now, now, r.name, r.color);
    pair.run('tags', r.n, id);
    log.run(
      db.legacyId('ideas:journal:tag', r.n),
      now,
      'tags',
      id,
      JSON.stringify({ name: r.name, color: r.color }),
    );
  }
}
