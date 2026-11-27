// v0.51.0 F (Expérimental, ADR 0068): a project « suivi en place » — for the
// projects that must keep their path on the PC (a launcher, a tool). The
// Coffre never moves it, never archives it, never deletes it: it indexes it,
// searches it, saves it on the disk (where its place follows its route). Not
// found (renamed, moved, another disk): « introuvable », never forgotten —
// « Le retrouver… » (checked by its files). Converted both ways, never two
// living versions without saying it.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, newId, requestBody, uuidParam } from '@hub/sdk/core';
import type { TrackCompareDto } from '../shared/types';
import { TRASH_FOLDER } from '../shared/names';
import { copyFileVerified, hashFileChecked } from './copy';
import { stamp } from './disk-layout';
import { walkProject } from './exclusions';
import type { ProjectDeps } from './projects';
import { projectOrThrow } from './projects';
import type { Library } from './library';
import type { ItemRow } from './rows';
import { taskRoute } from './tasks';
import { walkFolder } from './walk';

export interface TrackedDeps extends ProjectDeps {
  library: Library;
  /** The disk is busy (an update copies the project): refused meanwhile. */
  diskBusy: () => string | null;
}

/** At most this many names listed per kind of difference. */
const MAX_LISTED = 50;

/** A folder compared with the project's files as the Coffre knows them (read only). */
async function compare(
  d: TrackedDeps,
  item: ItemRow,
  candidate: string,
  signal?: AbortSignal,
): Promise<TrackCompareDto> {
  const index = new Map(d.projects.files(item.id).map((f) => [f.rel, f]));
  const w = await walkProject(candidate, d.projects.choicesOf(item), { signal });
  const out: TrackCompareDto = {
    path: candidate,
    same: 0,
    changed: [],
    added: [],
    missing: [],
    known: index.size,
    looksLike: false,
  };
  for (const f of w.files) {
    const known = index.get(f.rel);
    index.delete(f.rel);
    if (!known) {
      out.added.push(f.rel);
      continue;
    }
    const sha =
      known.size === f.size
        ? await hashFileChecked(path.join(candidate, ...f.rel.split('/')), { signal })
        : null;
    if (sha === known.sha256) out.same++;
    else out.changed.push(f.rel);
  }
  out.missing = [...index.keys()];
  // Its files: at least half of what the Coffre knew, found the same.
  out.looksLike = out.known === 0 ? w.files.length === 0 : out.same * 2 >= out.known;
  out.changed = out.changed.slice(0, MAX_LISTED);
  out.added = out.added.slice(0, MAX_LISTED);
  out.missing = out.missing.slice(0, MAX_LISTED);
  return out;
}

const isEmptyDir = (dir: string) => !existsSync(dir) || readdirSync(dir).length === 0;
/** « Cours/Algo » → « Cours » (« » at the top). */
const parentOf = (rel: string) => (path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel));

export function registerTrackedRoutes(d: TrackedDeps): void {
  const { ctx, store, library } = d;
  const checkPath = (raw: unknown): string => {
    if (typeof raw !== 'string' || !path.isAbsolute(raw))
      throw new HttpError(400, 'Dossier manquant');
    const abs = path.resolve(raw);
    const lib = path.resolve(library.root);
    if (abs === lib || abs.startsWith(lib + path.sep))
      throw new HttpError(409, 'Ce dossier est dans le Coffre lui-même');
    return abs;
  };
  const notBusy = () => {
    const busy = d.diskBusy();
    if (busy) throw new HttpError(409, `Le disque est occupé (${busy}) : réessaie après`);
  };

  /**
   * « Le retrouver… »: the folder Thomas chose, compared with the project's
   * files (read only); followed again only when confirmed and it looks like it.
   * Its copy on the disk is never touched.
   */
  taskRoute<{ itemId: string; path: string; confirm: boolean }, unknown>(ctx, {
    route: '/folders/:id/relocate',
    type: 'project-relocate',
    input: (request) => {
      const entry = projectOrThrow(d, uuidParam(request.params));
      if (!entry.tracked_path) throw new HttpError(409, 'Ce projet n’est pas suivi en place');
      const b = requestBody(request);
      const abs = checkPath(b.path);
      if (!existsSync(abs) || !statSync(abs).isDirectory())
        throw new HttpError(404, 'Dossier introuvable');
      return { itemId: entry.id, path: abs, confirm: b.confirm === true };
    },
    title: () => 'Coffre : retrouver un projet suivi',
    run: async (job) => {
      const item = d.getRow(job.input.itemId);
      const diff = await compare(d, item, job.input.path, job.signal);
      if (!job.input.confirm) return { compared: diff };
      if (!diff.looksLike)
        throw new HttpError(
          409,
          'Ce dossier ne ressemble pas au projet (moins de la moitié de ses fichiers) : rien n’a changé',
        );
      const before = { tracked_path: item.tracked_path, missing_at: item.missing_at };
      store.update('items', item.id, { tracked_path: job.input.path, missing_at: null });
      await d.refreshProject(item.id, job.signal);
      d.kick();
      const undoId = d.remember(async () => {
        store.update('items', item.id, before);
        await d.refreshProject(item.id);
      });
      return { compared: diff, undoId };
    },
  });

  /**
   * Copied → followed in place. `mode: 'copy'`: the Coffre copies the project
   * into an EMPTY folder Thomas chose; `mode: 'existing'`: a folder that already
   * holds it, compared first (the differences shown, `confirm` needed). Only
   * after success, the Coffre's own copy goes to the Coffre's Recycle Bin folder.
   */
  taskRoute<{ itemId: string; path: string; mode: string; confirm: boolean }, unknown>(ctx, {
    route: '/folders/:id/track',
    type: 'project-track',
    input: (request) => {
      notBusy();
      const entry = projectOrThrow(d, uuidParam(request.params));
      if (entry.tracked_path) throw new HttpError(409, 'Déjà suivi en place');
      if (entry.archived_at) throw new HttpError(409, 'Archivé : le réactiver d’abord');
      if (entry.trashed_at) throw new HttpError(409, 'Dans la corbeille');
      const b = requestBody(request);
      const abs = checkPath(b.path);
      const mode = b.mode === 'existing' ? 'existing' : 'copy';
      if (mode === 'copy' && !isEmptyDir(abs))
        throw new HttpError(
          409,
          'Ce dossier n’est pas vide : choisis un dossier vide, ou « un dossier qui le contient déjà »',
        );
      if (mode === 'existing' && (!existsSync(abs) || !statSync(abs).isDirectory()))
        throw new HttpError(404, 'Dossier introuvable');
      return { itemId: entry.id, path: abs, mode, confirm: b.confirm === true };
    },
    title: () => 'Coffre : suivre un projet en place',
    run: async (job) => {
      const item = d.getRow(job.input.itemId);
      const from = library.abs(item.rel_path!);
      if (job.input.mode === 'existing') {
        const diff = await compare(d, item, job.input.path, job.signal);
        if (!job.input.confirm) return { compared: diff };
      } else {
        // Every file of the Coffre's copy (its recreatable folders apart), read back.
        const temp = `${job.input.path}.toolbox-${newId().slice(0, 8)}`;
        const files = (await walkFolder(from, { inProject: true })).files;
        try {
          let n = 0;
          for (const f of files) {
            if (job.signal.aborted) throw new Error('Annulée');
            job.step(n++, files.length, { unit: 'fichiers', current: f.rel });
            await copyFileVerified(
              path.join(from, ...f.rel.split('/')),
              path.join(temp, ...f.rel.split('/')),
              { signal: job.signal },
            );
          }
          await mkdir(temp, { recursive: true });
          if (existsSync(job.input.path)) await rmdir(job.input.path);
          await rename(temp, job.input.path);
        } catch (error) {
          await rm(temp, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
      }
      // Followed now; the Coffre's copy aside (its Recycle Bin folder), never erased.
      const aside = `${TRASH_FOLDER}/${item.id} avant suivi ${stamp()}`;
      const moved = await library.move(item.rel_path!, parentOf(aside), path.posix.basename(aside));
      store.update('items', item.id, { tracked_path: job.input.path, missing_at: null });
      await d.refreshProject(item.id, job.signal);
      d.kick();
      const undoId = d.remember(async () => {
        const back = d.getRow(item.id);
        await library.move(moved, parentOf(item.rel_path!), path.posix.basename(item.rel_path!));
        store.update('items', item.id, {
          tracked_path: null,
          missing_at: null,
          rel_path: item.rel_path,
        });
        await d.refreshProject(back.id);
      });
      return { undoId, aside: moved };
    },
  });

  /**
   * Followed → copied: the folder is copied into the Coffre (at its route); the
   * original stays where it is, intact — no longer followed (said).
   */
  taskRoute<{ itemId: string }, unknown>(ctx, {
    route: '/folders/:id/untrack',
    type: 'project-untrack',
    input: (request) => {
      notBusy();
      const entry = projectOrThrow(d, uuidParam(request.params));
      if (!entry.tracked_path) throw new HttpError(409, 'Ce projet n’est pas suivi en place');
      if (!existsSync(entry.tracked_path))
        throw new HttpError(404, 'Introuvable : « Le retrouver… » d’abord');
      if (library.exists(entry.rel_path!))
        throw new HttpError(409, `Un dossier « ${entry.rel_path} » existe déjà dans le Coffre`);
      return { itemId: entry.id };
    },
    title: () => 'Coffre : copier un projet suivi dans le Coffre',
    run: async (job) => {
      const item = d.getRow(job.input.itemId);
      const src = item.tracked_path!;
      const target = library.abs(item.rel_path!);
      const temp = `${target}.toolbox-${newId().slice(0, 8)}`;
      const files = (await walkFolder(src, { inProject: true })).files;
      try {
        let n = 0;
        for (const f of files) {
          if (job.signal.aborted) throw new Error('Annulée');
          job.step(n++, files.length, { unit: 'fichiers', current: f.rel });
          await copyFileVerified(
            path.join(src, ...f.rel.split('/')),
            path.join(temp, ...f.rel.split('/')),
            { signal: job.signal },
          );
        }
        await mkdir(temp, { recursive: true });
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      store.update('items', item.id, { tracked_path: null, missing_at: null, source_path: src });
      await d.refreshProject(item.id, job.signal);
      d.kick();
      const undoId = d.remember(async () => {
        const aside = `${TRASH_FOLDER}/${item.id} copie annulée ${stamp()}`;
        await library.move(item.rel_path!, parentOf(aside), path.posix.basename(aside));
        store.update('items', item.id, { tracked_path: src, missing_at: null });
        await d.refreshProject(item.id);
      });
      return { undoId, original: src };
    },
  });
}
