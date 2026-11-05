// The safety net, page side (ADR 0044; rules in packages/phone/backup.ts):
// copies of the base in the app's own storage (Capacitor Filesystem,
// Directory.Data: private to the app, never emptied by Android, removed only
// with the app). A copy is two files: the base (.sqlite3) and its card (.json).
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { base64ToBytes, bytesToBase64 } from '@hub/sdk/core';
import {
  copiesToDelete,
  copyFileName,
  localDay,
  needsDailyCopy,
  restoreOffer,
  sortCopies,
  type BackupCopy,
  type BaseState,
} from '../../../packages/phone/backup';
import type { WorkerClient } from '../../../packages/phone/transport';

const DIR = 'copies';
const card = (file: string) => file.replace(/\.sqlite3$/, '.json');

export interface BaseStatus extends BaseState {
  tasks: number;
  counts: Record<string, number>;
  /** Migrations waiting for the copy « avant-migration » (empty: none). */
  pending: { scope: string; count: number }[];
  modules: { id: string; status: string; error?: string }[];
  sqlite: string;
  vfs: string;
}

/** Every copy, newest first (an unreadable card is skipped, never fatal). */
export async function listCopies(): Promise<BackupCopy[]> {
  let names: string[];
  try {
    const dir = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
    names = dir.files.map((f) => f.name).filter((n) => n.endsWith('.json'));
  } catch {
    return []; // No folder yet: no copy.
  }
  const copies: BackupCopy[] = [];
  for (const name of names) {
    try {
      const { data } = await Filesystem.readFile({
        path: `${DIR}/${name}`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      copies.push(JSON.parse(String(data)) as BackupCopy);
    } catch {
      // A card that cannot be read: left alone, not listed.
    }
  }
  return sortCopies(copies);
}

/**
 * Takes a copy now, then keeps the 7 newest (the older copies are deleted).
 * Reasons: the daily copy, before a restore, before a migration (an update
 * of the app that changes the structure of a base holding something).
 */
export async function takeCopy(
  client: WorkerClient,
  reason: BackupCopy['reason'],
): Promise<BackupCopy> {
  const snap = await client.call<{
    bytes: Uint8Array;
    rows: number;
    tasks: number;
    counts: Record<string, number>;
  }>({
    kind: 'snapshot',
  });
  const createdAt = new Date().toISOString();
  const copy: BackupCopy = {
    file: copyFileName(createdAt),
    createdAt,
    day: localDay(new Date()),
    tasks: snap.tasks,
    rows: snap.rows,
    counts: snap.counts,
    appVersion: __APP_VERSION__,
    reason,
  };
  await Filesystem.writeFile({
    path: `${DIR}/${copy.file}`,
    data: bytesToBase64(snap.bytes),
    directory: Directory.Data,
    recursive: true,
  });
  // The card last: a copy is listed only once its base is fully written.
  await Filesystem.writeFile({
    path: `${DIR}/${card(copy.file)}`,
    data: JSON.stringify(copy),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  for (const old of copiesToDelete(await listCopies())) {
    await Filesystem.deleteFile({ path: `${DIR}/${card(old.file)}`, directory: Directory.Data });
    await Filesystem.deleteFile({ path: `${DIR}/${old.file}`, directory: Directory.Data }).catch(
      () => undefined,
    );
  }
  return copy;
}

/** At opening: today's copy if due (never of an empty base). */
export async function dailyCopy(client: WorkerClient, base: BaseStatus): Promise<void> {
  if (needsDailyCopy(await listCopies(), localDay(new Date()), base))
    await takeCopy(client, 'quotidienne');
}

/** At opening: the copy to OFFER when the base is absent or empty (null: nothing to offer). */
export async function offerAtOpening(base: BaseStatus): Promise<BackupCopy | null> {
  return restoreOffer(await listCopies(), base);
}

/**
 * Restores a copy, after the user's confirmation only. The current base is
 * copied first when it holds anything (« avant-restauration »), then replaced.
 */
export async function restoreCopy(
  client: WorkerClient,
  copy: BackupCopy,
  base: BaseStatus,
): Promise<void> {
  // Read first: the copy taken just below may push the oldest one out (7 kept).
  const { data } = await Filesystem.readFile({
    path: `${DIR}/${copy.file}`,
    directory: Directory.Data,
  });
  const bytes = base64ToBytes(String(data));
  if (!base.absent && base.rows > 0) await takeCopy(client, 'avant-restauration');
  await client.call({ kind: 'restore', bytes });
}
