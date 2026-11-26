// v0.46.0 D and E: the old versions on the disk (« Restaurer cette version »)
// and the disk's Recycle Bin (recover, erase — erasing is never automatic:
// after 30 days ToolBox only PROPOSES it). Every write on the disk follows a
// click; every write on the PC is undoable (« Annuler », 15 minutes).
import { existsSync, readdirSync, rmdirSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, newId, requestBody, uuidParam } from '@hub/sdk/core';
import { freeName, PENDING_FOLDER, folderName } from '../shared/names';
import { copyVerified, place } from './copy';
import { baseName, DISK_TRASH_DIR, historyPath, isInDiskTrash, TMP_DIR } from './disk-layout';
import type { CoffreDeps, DiskManager } from './disk';
import { DISK_TRASH_DAYS, versionsOf } from './disk-routes';
import type { FolderRow, CopyRow, ItemRow, VersionRow } from './rows';

/** Room kept free on the PC beyond what a copy back needs. */
export const PC_MARGIN = 200 * 1024 * 1024;

export interface VersionDto {
  id: string;
  name: string;
  size: number;
  savedAt: string;
}

export interface DiskTrashDto {
  itemId: string;
  name: string;
  size: number;
  trashedAt: string | null;
  /** In the disk's Recycle Bin for more than 30 days. */
  old: boolean;
  /** Still in the Coffre's own Recycle Bin on the PC (« Récupérer » there), or erased on the PC. */
  onPc: boolean;
  folderPath: string[];
}

export function registerHistoryRoutes(d: CoffreDeps, disk: DiskManager): void {
  const { ctx, store, library } = d;
  const item = (id: string, withDeleted = false) => {
    const row = store.get<ItemRow & { updated_at: string }>(
      'items',
      id,
      withDeleted,
    ) as ItemRow | null;
    if (!row) throw new HttpError(404, 'Élément introuvable');
    return row;
  };
  const pcTemp = () => ctx.files.dataPath('tmp', newId());
  const pcFree = async () => (await library.disk()).free;
  const folderPath = (folderId: string | null): string[] => {
    const rows = ctx.db
      .prepare(`SELECT * FROM ${d.t.folders} WHERE deleted_at IS NULL`)
      .all() as FolderRow[];
    const byId = new Map(rows.map((c) => [c.id, c]));
    const out: string[] = [];
    for (
      let c = folderId ? byId.get(folderId) : undefined;
      c;
      c = c.parent_id ? byId.get(c.parent_id) : undefined
    )
      out.unshift(c.name);
    return out;
  };

  // --- D: the versions -----------------------------------------------------------------

  ctx.routes.get('/files/:id/versions', (request) => {
    const id = uuidParam(request.params);
    item(id);
    const row = disk.disk();
    const versions: VersionDto[] = row
      ? versionsOf(d, row.id, id).map((v) => ({
          id: v.id,
          name: v.name,
          size: v.size,
          savedAt: v.saved_at,
        }))
      : [];
    return { versions, connected: Boolean(row && disk.state.root), diskName: row?.name ?? null };
  });

  /**
   * « Restaurer cette version » (confirmed): it becomes the current version on
   * the PC; the current one is kept on the disk (in the history at the next
   * update, or put there now when it is not on the disk yet). « Annuler » puts
   * the PC's file back as it was.
   */
  ctx.routes.post('/files/:id/versions/:vid/restore', async (request) => {
    const { id, vid } = request.params as { id: string; vid: string };
    if (requestBody(request).confirm !== true)
      throw new HttpError(400, 'Restaurer une version : confirmation nécessaire');
    const row = item(uuidParam({ id }));
    if (row.archived_at) throw new HttpError(409, 'Archivé : le réactiver d’abord');
    if (row.trashed_at || !row.rel_path)
      throw new HttpError(409, 'Dans la corbeille : le récupérer d’abord');
    const diskRow = disk.disk();
    const root = disk.rootOrThrow();
    const version = store.get<VersionRow>('versions', vid);
    if (!version || version.item_id !== row.id) throw new HttpError(404, 'Version introuvable');
    return disk.exclusive('restauration d’une version', async () => {
      await disk.scanPc();
      const now = item(row.id);
      const pcFile = library.abs(now.rel_path!);
      if (!existsSync(pcFile)) throw new HttpError(404, 'Fichier introuvable sur le PC');
      // 1. The current version must be kept on the disk first.
      const copy = disk.copyOf(row.id, diskRow!.id);
      const currentOnDisk =
        copy && copy.sha256 === now.sha256 && existsSync(disk.abs(root, copy.rel_path));
      if (!currentOnDisk) {
        const temp = disk.abs(root, `${TMP_DIR}/${row.id}-${newId().slice(0, 8)}`);
        const saved = await copyVerified(pcFile, temp);
        const at = new Date();
        const wanted = historyPath(row.id, now.name, at);
        const rel = existsSync(disk.abs(root, wanted)) ? disk.freeOnDisk(root, wanted) : wanted;
        await place(temp, disk.abs(root, rel));
        store.create<VersionRow>('versions', {
          inner_rel: null,
          item_id: row.id,
          disk_id: diskRow!.id,
          rel_path: rel,
          name: now.name,
          sha256: saved.sha256,
          size: saved.size,
          saved_at: at.toISOString(),
        });
      }
      // 2. The version, read back from the disk onto the PC (its fingerprint checked).
      const free = await pcFree();
      if (free !== null && version.size + PC_MARGIN > free)
        throw new HttpError(409, 'Pas assez de place sur le PC pour cette version');
      const temp = pcTemp();
      const restored = await copyVerified(disk.abs(root, version.rel_path), temp);
      if (version.sha256 && restored.sha256 !== version.sha256) {
        await rm(temp, { recursive: true, force: true });
        throw new HttpError(
          409,
          'La version du disque ne correspond plus à son empreinte : rien n’a changé',
        );
      }
      // 3. On the PC: the current file aside (for « Annuler »), the version in its place.
      const aside = ctx.files.dataPath('annuler', newId(), path.basename(pcFile));
      await mkdir(path.dirname(aside), { recursive: true });
      await rename(pcFile, aside);
      try {
        await rename(temp, pcFile);
      } catch (error) {
        await rename(aside, pcFile);
        throw error;
      }
      const before = { sha256: now.sha256, size: now.size };
      store.update('items', row.id, {
        sha256: restored.sha256,
        size: restored.size,
        stat_json: null,
      });
      const undoId = d.remember(async () => {
        const back = item(row.id);
        if (!back.rel_path) return;
        const file = library.abs(back.rel_path);
        await rm(file, { recursive: true, force: true });
        await rename(aside, file);
        store.update('items', row.id, { ...before, stat_json: null });
      });
      return { ok: true, undoId };
    });
  });

  // --- E: the disk's Recycle Bin ---------------------------------------------------------

  const trashEntries = (): (DiskTrashDto & { copy: CopyRow; item: ItemRow })[] => {
    const row = disk.disk();
    if (!row) return [];
    const copies = (
      ctx.db
        .prepare(`SELECT * FROM ${d.t.copies} WHERE deleted_at IS NULL AND disk_id = ?`)
        .all(row.id) as CopyRow[]
    ).filter((c) => isInDiskTrash(c.rel_path));
    const old = new Date(Date.now() - DISK_TRASH_DAYS * 86_400_000).toISOString();
    return copies.flatMap((copy) => {
      const it = store.get<ItemRow & { updated_at: string }>(
        'items',
        copy.item_id,
        true,
      ) as ItemRow | null;
      if (!it) return [];
      return [
        {
          itemId: it.id,
          name: baseName(copy.rel_path),
          size: copy.size,
          trashedAt: copy.trashed_at,
          old: Boolean(copy.trashed_at && copy.trashed_at < old),
          onPc: !it.deleted_at,
          folderPath: folderPath(it.folder_id),
          copy,
          item: it,
        },
      ];
    });
  };

  ctx.routes.get('/disk/trash', () =>
    trashEntries()
      .map(({ copy: _c, item: _i, ...e }) => e)
      .sort((a, b) => (a.trashedAt ?? '').localeCompare(b.trashedAt ?? '')),
  );

  /**
   * « Récupérer » an element erased on the PC: copied back from the disk's
   * Recycle Bin (fingerprint checked), its sheet with it, in its folder (or
   * À ranger). One still in the PC's Recycle Bin is recovered there instead.
   */
  ctx.routes.post('/disk/trash/recover', async (request) => {
    const itemId = String(requestBody(request).itemId ?? '');
    const entry = trashEntries().find((e) => e.itemId === itemId);
    if (!entry) throw new HttpError(404, 'Pas dans la corbeille du disque');
    if (entry.onPc)
      throw new HttpError(
        409,
        'Encore dans la corbeille du Coffre sur ce PC : « Récupérer » là-bas',
      );
    const root = disk.rootOrThrow();
    return disk.exclusive('récupération depuis la corbeille du disque', async () => {
      const free = await pcFree();
      if (free !== null && entry.size + PC_MARGIN > free)
        throw new HttpError(409, 'Pas assez de place sur le PC pour le récupérer');
      const it = entry.item;
      const folderOk =
        it.folder_id &&
        (ctx.db
          .prepare(`SELECT 1 FROM ${d.t.folders} WHERE deleted_at IS NULL AND id = ?`)
          .get(it.folder_id) as unknown);
      const dir = folderOk ? folderPath(it.folder_id).map(folderName).join('/') : PENDING_FOLDER;
      const temp = pcTemp();
      const back = await copyVerified(disk.abs(root, entry.copy.rel_path), temp);
      if (entry.copy.sha256 && back.sha256 !== entry.copy.sha256) {
        await rm(temp, { recursive: true, force: true });
        throw new HttpError(
          409,
          'La copie du disque ne correspond plus à son empreinte : rien n’a changé',
        );
      }
      const dirAbs = library.abs(dir);
      await mkdir(dirAbs, { recursive: true });
      const taken = new Set(readdirSync(dirAbs).map((n) => n.toLowerCase()));
      const name = freeName(entry.name, (c) => taken.has(c.toLowerCase()));
      await rename(temp, path.join(dirAbs, name));
      ctx.db.transaction(() => {
        store.restore('items', it.id);
        store.update('items', it.id, {
          rel_path: `${dir}/${name}`,
          name,
          sha256: back.sha256,
          size: back.size,
          trashed_at: null,
          trash_from: null,
          archived_at: null,
          stat_json: null,
          ...(folderOk ? {} : { folder_id: null, arrival: 1 }),
        });
      });
      return { ok: true, folderPath: folderOk ? folderPath(it.folder_id) : null };
    });
  });

  /** Erases for good from the disk's Recycle Bin (only with the page's confirmation). */
  ctx.routes.post('/disk/trash/erase', async (request) => {
    const b = requestBody(request);
    if (b.confirm !== true)
      throw new HttpError(400, 'Effacement définitif : confirmation nécessaire');
    const ids = Array.isArray(b.itemIds) ? b.itemIds.map(String) : [];
    if (!ids.length) throw new HttpError(400, 'Rien à effacer');
    const root = disk.rootOrThrow();
    return disk.exclusive('effacement de la corbeille du disque', async () => {
      const entries = trashEntries().filter((e) => ids.includes(e.itemId));
      let erased = 0;
      for (const e of entries) {
        // Only ever inside the disk's Recycle Bin.
        if (!e.copy.rel_path.startsWith(`${DISK_TRASH_DIR}/`)) continue;
        const target = disk.abs(root, e.copy.rel_path);
        await rm(target, { recursive: true, force: true });
        try {
          const dir = path.dirname(target);
          if (!readdirSync(dir).length) rmdirSync(dir);
        } catch {
          // A folder that stays: harmless.
        }
        store.remove('copies', e.copy.id);
        erased++;
      }
      return { erased };
    });
  });
}
