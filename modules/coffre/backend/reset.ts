// v0.49.0 (Expérimental): « Réinitialiser le Coffre » — empty the Coffre to
// start again (the new model of v0.50), safely and touching nothing else.
// 1. A preview (a task): what will be emptied, and WARNINGS for what exists
//    only in the Coffre (original gone or different, archived, no known
//    original), with « Exporter ces éléments d'abord ».
// 2. Always first: an inventory (CSV + JSON) in a folder Thomas chooses.
// 3. Confirmed by typing « vider »; a task with its report; no « Annuler »
//    afterwards, but everything stays recoverable: the database saved first,
//    the Coffre's files in the WINDOWS RECYCLE BIN (never deleted for good),
//    the inventory, the disk's folder RENAMED « ToolBox-Coffre-ancien-<date> »
//    (nothing removed on the disk; disk absent: proposed at its next plug-in,
//    never done alone). The other modules are never touched.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, cp, mkdir, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { HttpError, requestBody } from '@hub/sdk/core';
import type { ItemDto, OnlyHereReason, ResetPreviewDto, ResetReport } from '../shared/types';
import { DISK_FOLDER } from './disk-layout';
import type { CoffreDeps, DiskManager } from './disk';
import { hashFile } from './library';
import type { ItemRow } from './rows';
import { taskRoute } from './tasks';
import { hashFiles, walkFolder } from './walk';

interface PendingDisk {
  diskId: string;
  name: string;
  date: string;
  keep: boolean;
}

const day = (d = new Date()) => d.toISOString().slice(0, 10);

/** « ToolBox-Coffre-ancien-2026-11-26 », « … (2) » when taken. */
function oldName(parent: string, date: string): string {
  const base = `${DISK_FOLDER}-ancien-${date}`;
  let name = base;
  for (let n = 2; existsSync(path.join(parent, name)); n++) name = `${base} (${n})`;
  return name;
}

export function registerReset(
  d: CoffreDeps,
  disk: DiskManager,
  deps: {
    dtos: (rows: ItemRow[]) => ItemDto[];
    /** An element's file now (the PC's, or the disk's for an archived one), or null. */
    fileOf: (row: ItemRow) => string | null;
    clearDerived: () => void;
  },
) {
  const { ctx, store, library, t } = d;
  const pendingFile = () => ctx.files.dataPath('reset-disque-en-attente.json');
  const rows = () =>
    ctx.db.prepare(`SELECT * FROM ${t.items} WHERE deleted_at IS NULL`).all() as ItemRow[];
  const live = (table: string) =>
    (
      ctx.db.prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL`).all() as { id: string }[]
    ).map((r) => r.id);

  const pending = (): PendingDisk | null => {
    try {
      return JSON.parse(readFileSync(pendingFile(), 'utf8')) as PendingDisk;
    } catch {
      return null;
    }
  };

  // --- 1. The preview ------------------------------------------------------------------

  taskRoute<Record<string, never>, ResetPreviewDto>(ctx, {
    route: '/reset/preview',
    type: 'reset-preview',
    input: () => ({}),
    title: () => 'Coffre : aperçu de la réinitialisation',
    run: async (job) => {
      const all = rows();
      const dtos = new Map(deps.dtos(all).map((x) => [x.id, x]));
      const onlyHere: ResetPreviewDto['onlyHere'] = [];
      let n = 0;
      for (const r of all) {
        if (job.signal.aborted) break;
        job.step(n++, all.length, { unit: 'éléments vérifiés', current: r.name });
        if (r.kind === 'link') continue; // left in its place: nothing lost
        const dto = dtos.get(r.id);
        const add = (reason: OnlyHereReason) =>
          onlyHere.push({ id: r.id, name: r.name, contextPath: dto?.contextPath ?? null, reason });
        if (r.archived_at) {
          add('archived');
          continue;
        }
        const source = r.source_path;
        if (!source || library.relOf(source) !== null) {
          add('no-original');
          continue;
        }
        if (!existsSync(source)) {
          add('original-absent');
          continue;
        }
        // The original and the Coffre's copy, both read NOW: changed on one side or the other?
        const fingerprint = async (abs: string) =>
          statSync(abs).isDirectory()
            ? (await hashFiles(abs, (await walkFolder(abs, { inProject: true })).files)).sha256
            : await hashFile(abs);
        let original: string;
        try {
          original = await fingerprint(source);
        } catch {
          add('original-absent');
          continue;
        }
        const copy = deps.fileOf(r);
        try {
          if (!copy || original !== (await fingerprint(copy))) add('original-different');
        } catch {
          add('original-different');
        }
      }
      job.step(n, all.length, { current: null });
      const s = disk.disk();
      return {
        items: all.filter((r) => r.kind !== 'link').length,
        contexts: live(t.contexts).length,
        links: all.filter((r) => r.kind === 'link').length,
        archived: all.filter((r) => r.archived_at).length,
        bytes: all
          .filter((r) => r.kind !== 'link' && !r.archived_at)
          .reduce((sum, r) => sum + r.size, 0),
        disk: s
          ? { name: s.name, connected: disk.state.root !== null, root: disk.state.root }
          : null,
        onlyHere,
        inventoryParent: path.join(homedir(), 'Documents'),
        rules: live(ctx.db.table('rules')).length,
      };
    },
  });

  // --- « Exporter ces éléments d'abord » -----------------------------------------------

  taskRoute<{ ids: string[]; dest: string }, { exported: number; folder: string }>(ctx, {
    route: '/reset/export',
    type: 'reset-export',
    input: (request) => {
      const b = requestBody(request);
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      const dest = String(b.dest ?? '');
      if (!ids.length) throw new HttpError(400, 'Rien à exporter');
      if (!path.isAbsolute(dest) || !existsSync(dest))
        throw new HttpError(404, 'Dossier introuvable');
      return { ids, dest };
    },
    title: (i) => `Coffre : exporter ${i.ids.length} élément${i.ids.length > 1 ? 's' : ''}`,
    run: async (job) => {
      const folder = path.join(job.input.dest, `ToolBox-Coffre-export-${day()}`);
      await mkdir(folder, { recursive: true });
      const all = new Map(deps.dtos(rows()).map((x) => [x.id, x]));
      const byId = new Map(rows().map((r) => [r.id, r]));
      let exported = 0;
      let n = 0;
      for (const id of job.input.ids) {
        if (job.signal.aborted) break;
        const r = byId.get(id);
        job.step(n++, job.input.ids.length, { unit: 'éléments', current: r?.name ?? id });
        if (!r) continue;
        const from = deps.fileOf(r);
        if (!from || !existsSync(from)) {
          job.problem(
            r.name,
            r.archived_at ? 'archivé : branche le disque du coffre' : 'fichier introuvable',
          );
          continue;
        }
        const dir = path.join(folder, ...(all.get(id)?.contextPath ?? ['Arrivée']));
        await mkdir(dir, { recursive: true });
        let target = path.join(dir, r.name);
        for (let k = 2; existsSync(target); k++) target = path.join(dir, `${k} - ${r.name}`);
        try {
          if (statSync(from).isDirectory()) await cp(from, target, { recursive: true });
          else await copyFile(from, target);
          exported++;
        } catch (error) {
          job.problem(r.name, error instanceof Error ? error.message : String(error));
        }
      }
      job.step(n, job.input.ids.length, { current: null });
      return { exported, folder };
    },
  });

  // --- 2 + 3. Inventory, then empty -----------------------------------------------------

  /** The inventory: a CSV (spreadsheet) and a JSON, readable without ToolBox. */
  const writeInventory = (dir: string): string => {
    const items = deps.dtos(rows());
    const folder = path.join(dir, `ToolBox-inventaire-${day()}`);
    let target = folder;
    for (let n = 2; existsSync(target); n++) target = `${folder} (${n})`;
    mkdirSync(target, { recursive: true });
    const lines = items.map((i) => ({
      nom: i.name,
      contexte: i.contextPath?.join(' › ') ?? 'Arrivée',
      nature: i.attributes.find((a) => a.key === 'nature')?.value ?? '',
      tags: i.attributes
        .filter((a) => a.key === 'tag')
        .map((a) => a.value)
        .join(', '),
      cheminDansLeCoffre: i.path ?? '',
      cheminDOrigine: i.sourcePath ?? '',
      empreinte: i.sha256 ?? '',
      etatDisque: i.diskState,
      type: i.kind,
    }));
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = [
      'nom',
      'contexte',
      'nature',
      'tags',
      'chemin dans le coffre',
      "chemin d'origine",
      'empreinte',
      'état disque',
      'type',
    ];
    const csv = [
      head.map(cell).join(';'),
      ...lines.map((l) =>
        [
          l.nom,
          l.contexte,
          l.nature,
          l.tags,
          l.cheminDansLeCoffre,
          l.cheminDOrigine,
          l.empreinte,
          l.etatDisque,
          l.type,
        ]
          .map(cell)
          .join(';'),
      ),
    ].join('\r\n');
    // A BOM: Excel reads the accents.
    writeFileSync(path.join(target, 'inventaire.csv'), `\ufeff${csv}\r\n`, 'utf8');
    writeFileSync(
      path.join(target, 'inventaire.json'),
      JSON.stringify({ ecritLe: new Date().toISOString(), elements: lines }, null, 2),
      'utf8',
    );
    return target;
  };

  /** The disk's folder renamed (never removed); « keep »: a new empty folder registered there. */
  const renameOnDisk = async (keep: boolean): Promise<string> => {
    const row = disk.disk();
    const root = disk.state.root;
    if (!row || !root) throw new Error('Disque absent');
    const parent = path.dirname(root);
    const name = row.name;
    const old = path.join(parent, oldName(parent, day()));
    disk.forget();
    await rename(root, old);
    // « Restaurer depuis un disque » can still read it (its identity is kept); never found alone.
    if (keep) await disk.register(parent, name);
    try {
      await unlink(pendingFile());
    } catch {
      // nothing pending
    }
    return old;
  };

  taskRoute<{ inventoryDir: string; forgetRules: boolean; keepDisk: boolean }, ResetReport>(ctx, {
    route: '/reset/apply',
    type: 'reset',
    input: (request) => {
      const b = requestBody(request);
      if (
        String(b.confirm ?? '')
          .trim()
          .toLowerCase() !== 'vider'
      )
        throw new HttpError(400, 'Confirmation nécessaire : taper « vider »');
      if (disk.busy) throw new HttpError(409, `Le disque est occupé : ${disk.busy}`);
      const waiting = disk.waitsFor();
      if (waiting) throw new HttpError(409, `Attends la fin de « ${waiting} »`);
      const inventoryDir = String(b.inventoryDir ?? '') || path.join(homedir(), 'Documents');
      if (!path.isAbsolute(inventoryDir))
        throw new HttpError(400, 'Dossier de l’inventaire invalide');
      if (library.relOf(inventoryDir) !== null)
        throw new HttpError(400, 'L’inventaire ne peut pas aller dans le Coffre (il va être vidé)');
      return { inventoryDir, forgetRules: b.forgetRules === true, keepDisk: b.keepDisk !== false };
    },
    title: () => 'Coffre : réinitialisation',
    run: async (job) => {
      const { inventoryDir, forgetRules, keepDisk } = job.input;
      const steps = 5;
      // 1. The database saved first (the existing mechanism).
      job.step(0, steps, { unit: 'étapes', current: 'sauvegarde de la base' });
      const backup = ctx.db.backup('avant-reinitialisation-coffre');
      // 2. The inventory, always.
      job.step(1, steps, { current: 'inventaire' });
      await mkdir(inventoryDir, { recursive: true });
      const inventory = writeInventory(inventoryDir);
      // 3. The disk: its folder renamed now if plugged in; otherwise proposed at its next plug-in.
      job.step(2, steps, { current: 'disque du coffre' });
      let diskFolder: string | null = null;
      let diskPending = false;
      const row = disk.disk();
      if (row && disk.state.root) diskFolder = await renameOnDisk(keepDisk);
      else if (row) {
        diskPending = true;
        writeFileSync(
          pendingFile(),
          JSON.stringify({
            diskId: row.id,
            name: row.name,
            date: day(),
            keep: keepDisk,
          } satisfies PendingDisk),
        );
      }
      // 4. The Coffre's sheets (soft-deleted: the backup and the journal keep them), its derived data.
      job.step(3, steps, { current: 'fiches du Coffre' });
      const counts = { items: live(t.items).length, contexts: live(t.contexts).length };
      ctx.db.transaction(() => {
        for (const table of ['attributes', 'also', 'versions', 'items', 'contexts'] as const)
          for (const id of live(ctx.db.table(table))) store.remove(table, id);
        // The disk's copies: the disk's folder is no longer the Coffre's (renamed, or soon).
        for (const id of live(t.copies)) store.remove('copies', id);
        if (forgetRules) for (const id of live(ctx.db.table('rules'))) store.remove('rules', id);
        deps.clearDerived();
      });
      // 5. The Coffre's files on the PC: into the Windows Recycle Bin (never deleted for good).
      job.step(4, steps, { current: 'fichiers vers la corbeille de Windows' });
      let trashed = 0;
      if (existsSync(library.root))
        for (const name of readdirSync(library.root)) {
          if (job.signal.aborted) break;
          const target = path.join(library.root, name);
          try {
            await ctx.files.trash(target);
            trashed++;
          } catch (error) {
            job.problem(target, error instanceof Error ? error.message : String(error));
          }
        }
      library.ensure();
      job.step(steps, steps, { current: null });
      return { inventory, emptied: counts, trashed, diskFolder, diskPending, backup };
    },
  });

  // --- The disk absent at the reset: proposed at its next plug-in -----------------------

  ctx.routes.get('/reset/pending', () => {
    const p = pending();
    const row = disk.disk();
    if (!p || !row || row.id !== p.diskId) return null;
    return { name: p.name, date: p.date, connected: disk.state.root !== null, keep: p.keep };
  });
  taskRoute<Record<string, never>, { folder: string }>(ctx, {
    route: '/reset/disk-rename',
    type: 'reset-disk-rename',
    input: () => {
      const p = pending();
      if (!p) throw new HttpError(409, 'Rien à renommer');
      if (!disk.state.root) throw new HttpError(409, 'Branche le disque du coffre d’abord');
      if (disk.busy) throw new HttpError(409, `Le disque est occupé : ${disk.busy}`);
      return {};
    },
    title: () => 'Coffre : renommer l’ancien dossier du disque',
    run: async () => ({ folder: await renameOnDisk(pending()?.keep !== false) }),
  });

  return {
    /** A reset waits for the disk's old folder to be renamed: no update meanwhile. */
    diskPending: (): boolean => {
      const p = pending();
      return Boolean(p && disk.disk()?.id === p.diskId);
    },
    pending,
  };
}
