// v0.51.0 (Expérimental, ADR 0068): the routes of a PROJECT's inside — its
// exclusions (what it does not save, and why; Thomas's own choices), its files
// one by one (the search, the views, opening ONE file).
import { existsSync } from 'node:fs';
import {
  HttpError,
  requestBody,
  uuidParam,
  type ModuleContext,
  type SyncStore,
} from '@hub/sdk/core';
import path from 'node:path';
import { languageOfExt } from '../shared/kinds';
import type {
  ExclusionsDto,
  InnerFileDto,
  InnerGroupDto,
  ItemDto,
  LabelDto,
  LabelFamily,
} from '../shared/types';
import { cleanRel, walkProject, type ExclusionChoices } from './exclusions';
import type { ProjectIndex } from './inner';
import type { FolderRow, ItemRow } from './rows';
import { taskRoute } from './tasks';

export interface ProjectDeps {
  ctx: ModuleContext;
  store: SyncStore;
  projects: ProjectIndex;
  getFolder: (id: string) => FolderRow;
  projectItemOf: (folderId: string) => ItemRow | null;
  refreshProject: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<{ missing: boolean; files: number; size: number }>;
  remember: (run: () => Promise<void>) => string;
  /** The search reads what changed. */
  kick: () => void;
  getRow: (id: string) => ItemRow;
  dtos: (rows: ItemRow[]) => ItemDto[];
  labelsOf: (ids: string[]) => Map<string, LabelDto[]>;
}

/** v0.51.0: at most this many inner files in a view by label. */
const MAX_VIEW_FILES = 2000;

/**
 * The labels of a file inside a project: its language (its extension) and its
 * year (its date), deduced; the others are the project's (« du projet »). A
 * file inside a project has no sheet of its own: the project is labelled.
 */
export function innerLabels(
  file: { ext: string; mtime: number },
  projectLabels: readonly LabelDto[],
): LabelDto[] {
  const out: LabelDto[] = [];
  const language = languageOfExt(file.ext);
  if (language)
    out.push({
      family: 'language',
      value: language,
      origin: 'guessed',
      reason: `extension .${file.ext}`,
    });
  if (file.mtime)
    out.push({
      family: 'year',
      value: String(new Date(file.mtime).getFullYear()),
      origin: 'guessed',
      reason: 'date du fichier',
    });
  for (const l of projectLabels)
    if (l.family !== 'language' && l.family !== 'year')
      out.push({ ...l, origin: 'default', reason: 'du projet' });
  return out;
}

/** The project of a Projet folder, or a clear refusal. */
export function projectOrThrow(d: ProjectDeps, folderId: string): ItemRow {
  const folder = d.getFolder(folderId);
  const entry = folder.project ? d.projectItemOf(folderId) : null;
  if (!entry) throw new HttpError(409, 'Ce dossier n’est pas un projet');
  return entry;
}

export function registerProjectRoutes(d: ProjectDeps): void {
  const { ctx, store, projects } = d;

  /**
   * What the project does not save, and why (list, .gitignore, Thomas), with
   * the room it frees; what it saves (files, bytes). Read only.
   */
  ctx.routes.get('/folders/:id/exclusions', async (request): Promise<ExclusionsDto> => {
    const entry = projectOrThrow(d, uuidParam(request.params));
    const root = projects.rootOf(entry);
    const choices = projects.choicesOf(entry);
    if (!root || !existsSync(root))
      return { choices, excluded: [], files: 0, bytes: 0, available: false };
    const w = await walkProject(root, choices, { measureExcluded: true });
    return {
      choices,
      excluded: w.excluded.map((e) => ({ ...e })),
      files: w.files.length,
      bytes: w.bytes,
      available: true,
    };
  });

  /**
   * « Ne pas sauvegarder ce dossier » / « Le sauvegarder quand même » /
   * « Comme avant » (the list and the .gitignore decide): the choice is kept,
   * the project's index follows (a background task: a folder brought back can
   * be big). Nothing is touched in the project's folder. « Annuler » puts the
   * previous choices back.
   */
  taskRoute<{ folderId: string; itemId: string; rel: string; action: string }, unknown>(ctx, {
    route: '/folders/:id/exclusions',
    type: 'project-exclusions',
    input: (request) => {
      const folderId = uuidParam(request.params);
      const entry = projectOrThrow(d, folderId);
      if (entry.archived_at) throw new HttpError(409, 'Projet archivé : le réactiver d’abord');
      const b = requestBody(request);
      const rel = cleanRel(String(b.rel ?? ''));
      if (!rel) throw new HttpError(400, 'Chemin manquant');
      if (rel.split('/').includes('.git')) throw new HttpError(409, '.git est toujours sauvegardé');
      const action = String(b.action ?? '');
      if (!['exclude', 'include', 'reset'].includes(action))
        throw new HttpError(400, 'Action inconnue');
      return { folderId, itemId: entry.id, rel, action };
    },
    title: (i) =>
      `Coffre : ${i.action === 'exclude' ? 'ne plus sauvegarder' : i.action === 'include' ? 'sauvegarder' : 'règle par défaut pour'} « ${i.rel} »`,
    run: async (job) => {
      const { itemId, rel, action } = job.input;
      const before = store.get<ItemRow & { updated_at: string }>('items', itemId) as ItemRow | null;
      if (!before) throw new Error('Projet introuvable');
      const old = projects.choicesOf(before);
      const next: ExclusionChoices = {
        exclude: old.exclude.filter((x) => x !== rel),
        include: old.include.filter((x) => x !== rel),
      };
      if (action === 'exclude') next.exclude.push(rel);
      if (action === 'include') next.include.push(rel);
      store.update('items', itemId, { exclusions_json: JSON.stringify(next) });
      job.progress(null, 'Relit les fichiers du projet…');
      const r = await d.refreshProject(itemId, job.signal);
      d.kick();
      const undoId = d.remember(async () => {
        store.update('items', itemId, { exclusions_json: before.exclusions_json });
        await d.refreshProject(itemId);
        d.kick();
      });
      return { undoId, files: r.files, size: r.size };
    },
  });

  /** One file inside a project: what its reader needs, its labels (deduced or the project's). */
  const innerFile = (row: ItemRow, rel: string): InnerFileDto => {
    const f = projects.file(row.id, rel);
    if (!f) throw new HttpError(404, 'Fichier introuvable dans le projet');
    const root = projects.rootOf(row);
    const abs = root ? path.join(root, ...rel.split('/')) : null;
    let url: string | null = null;
    if (abs && existsSync(abs))
      try {
        url = ctx.files.mediaUrl(abs);
      } catch {
        url = null;
      }
    return {
      projectId: row.id,
      folderId: row.folder_id,
      rel: f.rel,
      name: f.name,
      ext: f.ext,
      size: f.size,
      url,
      path: abs,
      labels: innerLabels(f, d.labelsOf([row.id]).get(row.id) ?? []),
    };
  };
  ctx.routes.get('/files/:id/inner', (request) => {
    const row = d.getRow(uuidParam(request.params));
    if (row.kind !== 'project') throw new HttpError(409, 'Pas un projet');
    return innerFile(row, String((request.query as { rel?: string } | undefined)?.rel ?? ''));
  });
  /** « Lire en plein écran » ONE file inside a project (ADR 0058). */
  ctx.routes.post('/files/:id/inner/read-window', (request) => {
    const row = d.getRow(uuidParam(request.params));
    const f = innerFile(row, String(requestBody(request).rel ?? ''));
    const route = `/m/coffre/lire/${row.id}?f=${encodeURIComponent(f.rel)}`;
    const opened = ctx.ui.openWindow(route, { title: f.name });
    return { opened, route: `/w${route}` };
  });

  /**
   * The files inside the projects in a view by label (« tout ce qui est
   * Python »), grouped by project: their language (extension) and year (date)
   * deduced, the other labels the project's.
   */
  ctx.routes.get('/inner-files', (request): InnerGroupDto[] => {
    const q = (request.query ?? {}) as { family?: string; value?: string };
    const family = String(q.family ?? '') as LabelFamily;
    const value = String(q.value ?? '');
    if (!family || !value) return [];
    const live = `i.deleted_at IS NULL AND i.trashed_at IS NULL AND i.kind = 'project'`;
    let rows: {
      item_id: string;
      rel: string;
      name: string;
      ext: string;
      size: number;
      mtime: number;
    }[];
    const select = `SELECT f.item_id, f.rel, f.name, f.ext, f.size, f.mtime FROM ${projects.table} f JOIN ${ctx.db.table('items')} i ON i.id = f.item_id WHERE ${live}`;
    if (family === 'language') {
      const exts = (
        ctx.db.prepare(`SELECT DISTINCT ext FROM ${projects.table}`).all() as { ext: string }[]
      )
        .map((r) => r.ext)
        .filter((e) => languageOfExt(e) === value);
      if (!exts.length) return [];
      rows = ctx.db
        .prepare(`${select} AND f.ext IN (${exts.map(() => '?').join(',')}) ORDER BY f.rel LIMIT ?`)
        .all(...exts, MAX_VIEW_FILES) as typeof rows;
    } else if (family === 'year' && /^\d{4}$/.test(value)) {
      const from = new Date(Number(value), 0, 1).getTime();
      const to = new Date(Number(value) + 1, 0, 1).getTime();
      rows = ctx.db
        .prepare(`${select} AND f.mtime >= ? AND f.mtime < ? ORDER BY f.rel LIMIT ?`)
        .all(from, to, MAX_VIEW_FILES) as typeof rows;
    } else {
      // An inherited label: the files of the projects that carry it.
      const ids = (
        ctx.db
          .prepare(
            `SELECT DISTINCT item_id FROM ${ctx.db.table('labels')} WHERE deleted_at IS NULL AND family = ? AND value = ?`,
          )
          .all(family, value) as { item_id: string }[]
      ).map((r) => r.item_id);
      if (!ids.length) return [];
      rows = ctx.db
        .prepare(
          `${select} AND f.item_id IN (${ids.map(() => '?').join(',')}) ORDER BY f.rel LIMIT ?`,
        )
        .all(...ids, MAX_VIEW_FILES) as typeof rows;
    }
    const byProject = new Map<string, typeof rows>();
    for (const r of rows) byProject.set(r.item_id, [...(byProject.get(r.item_id) ?? []), r]);
    const projectRows = [...byProject.keys()].map((id) => d.getRow(id));
    const dtos = new Map(d.dtos(projectRows).map((x) => [x.id, x]));
    return projectRows.map((p) => ({
      project: dtos.get(p.id)!,
      files: byProject.get(p.id)!.map((f) => ({
        rel: f.rel,
        name: f.name,
        ext: f.ext,
        size: f.size,
        line: null,
        page: null,
      })),
    }));
  });
}
