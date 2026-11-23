// v0.46.0: the Coffre du disque — a folder « ToolBox-Coffre » anywhere on any
// volume, recognised by its identity file, NEVER by its drive letter or path
// (ADR 0055). Inside, the same tree as on the PC (readable without ToolBox),
// and ToolBox's own folder « _ToolBox » (history, disk Recycle Bin, copies of
// the database and the sheets, temporary files). Pure (tested).
import { newId } from '@hub/sdk/core';
import { DISK_SYSTEM_FOLDER } from '../shared/names';

/** The folder ToolBox creates in the folder Thomas chose. */
export const DISK_FOLDER = 'ToolBox-Coffre';
/** The identity file, at the root of DISK_FOLDER. */
export const IDENTITY_FILE = '_identite-toolbox-coffre.json';
/** ToolBox's own folder on the disk (a context never takes this name: folderName). */
export const SYSTEM_FOLDER = DISK_SYSTEM_FOLDER;
export const HISTORY_DIR = `${SYSTEM_FOLDER}/Historique`;
export const DISK_TRASH_DIR = `${SYSTEM_FOLDER}/Corbeille`;
export const BASE_DIR = `${SYSTEM_FOLDER}/Base`;
/** Temporary files of a copy: never at a final place, wiped at the start of each update. */
export const TMP_DIR = `${SYSTEM_FOLDER}/tmp`;
/** Elements on their way from one place to another (kept: a move in progress). */
export const MOVING_DIR = `${SYSTEM_FOLDER}/Deplacement`;
/** Damaged files found by « Vérifier le disque », set aside before a fresh copy. */
export const DAMAGED_DIR = `${SYSTEM_FOLDER}/Abimes`;

export interface DiskIdentity {
  format: 'toolbox-coffre';
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  /** Written at each update (information). */
  lastUpdateAt?: string | null;
}

export function newIdentity(name: string, now = new Date()): DiskIdentity {
  return {
    format: 'toolbox-coffre',
    version: 1,
    id: newId(),
    name: name.trim() || 'Disque du coffre',
    createdAt: now.toISOString(),
  };
}

/** An identity read from a file, or null when it is not one. */
export function parseIdentity(text: string): DiskIdentity | null {
  try {
    const v = JSON.parse(text) as Partial<DiskIdentity>;
    if (v.format !== 'toolbox-coffre' || typeof v.id !== 'string' || !v.id) return null;
    return {
      format: 'toolbox-coffre',
      version: 1,
      id: v.id,
      name: typeof v.name === 'string' && v.name ? v.name : 'Disque du coffre',
      createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
      lastUpdateAt: typeof v.lastUpdateAt === 'string' ? v.lastUpdateAt : null,
    };
  } catch {
    return null;
  }
}

/** The PC's Recycle Bin folder of the Coffre (library.ts: « _Corbeille/<id>/name »). */
const PC_TRASH = '_Corbeille/';

/**
 * Where an element's CURRENT version belongs on the disk: the same relative
 * path as on the PC; an element in the PC's Recycle Bin (or erased on the PC)
 * goes to the disk's Recycle Bin.
 */
export function wantedDiskPath(item: {
  id: string;
  name: string;
  rel_path: string | null;
  trashed_at: string | null;
  deleted_at: string | null;
}): string | null {
  if (item.trashed_at || item.deleted_at || item.rel_path?.startsWith(PC_TRASH))
    return `${DISK_TRASH_DIR}/${item.id}/${baseName(item.rel_path ?? item.name)}`;
  return item.rel_path;
}

export const isInDiskTrash = (rel: string) => rel.startsWith(`${DISK_TRASH_DIR}/`);

export const baseName = (rel: string) => rel.split('/').filter(Boolean).pop() ?? rel;

/** « 2026-11-24 14-05-09 » (a name Windows accepts, sorted by time). */
export function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

/** The place of an old version: « _ToolBox/Historique/<id>/<date> nom.pdf ». */
export const historyPath = (itemId: string, name: string, date = new Date()) =>
  `${HISTORY_DIR}/${itemId}/${stamp(date)} ${name}`;

/**
 * The history to remove to fit in `quota` bytes: the OLDEST first (first in,
 * first out). A version larger than the whole quota is never removed by the
 * quota (it is reported instead); the current files and the archives are not
 * in `versions` at all.
 */
export function quotaPlan(
  versions: readonly { id: string; size: number; savedAt: string }[],
  quota: number,
): {
  remove: string[];
  oversized: string[];
  total: number;
  /** The history counted by the quota after the removals (oversized versions apart). */
  after: number;
} {
  const total = versions.reduce((s, v) => s + v.size, 0);
  const oversized = versions.filter((v) => v.size > quota).map((v) => v.id);
  // A version larger than the quota on its own is kept and reported: it never
  // makes the quota remove the others (they are counted without it).
  let after = versions.filter((v) => v.size <= quota).reduce((s, v) => s + v.size, 0);
  const remove: string[] = [];
  const oldestFirst = [...versions]
    .filter((v) => v.size <= quota)
    .sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.id.localeCompare(b.id));
  for (const v of oldestFirst) {
    if (after <= quota) break;
    remove.push(v.id);
    after -= v.size;
  }
  return { remove, oversized, total, after };
}
