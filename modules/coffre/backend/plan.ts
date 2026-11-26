// v0.46.0: an element's state with the disk, and what an update must do for
// it — from the database only (the update itself also looks at the disk).
// Pure (tested). ADR 0055.
import type { DiskState } from '../shared/types';
import { isInDiskTrash, wantedDiskPath } from './disk-layout';
import type { CopyRow, ItemRow } from './rows';

type Item = Pick<
  ItemRow,
  'id' | 'kind' | 'name' | 'rel_path' | 'sha256' | 'trashed_at' | 'deleted_at' | 'archived_at'
>;
type Copy = Pick<CopyRow, 'rel_path' | 'sha256' | 'damaged_at'>;

export function stateOf(item: Item, copy: Copy | null): DiskState {
  if (item.trashed_at || item.deleted_at) return 'trash';
  if (item.archived_at) return 'archived';
  if (!copy || copy.damaged_at || !copy.sha256 || copy.sha256 !== item.sha256) return 'pending';
  return 'active';
}

export type StepKind = 'copy' | 'update' | 'move' | 'trash' | 'repair';

export interface Step {
  kind: StepKind;
  itemId: string;
  name: string;
  /** Where its copy is on the disk now (null: none yet). */
  from: string | null;
  /** Where its current version belongs. */
  to: string;
  /** Bytes to write (a move writes nothing). */
  size: number;
}

/**
 * What the update does for one entry, or null (nothing to do, or nothing
 * possible: an entry never saved and now deleted).
 */
export function stepOf(
  item: Item & { size: number },
  copy: Copy | null,
  /** Its copy's file is really on the disk (false: copy it again). */
  copyPresent = true,
): Step | null {
  const to = wantedDiskPath(item);
  if (!to) return null;
  const base = { itemId: item.id, name: item.name, from: copy?.rel_path ?? null, to };
  const present = copy !== null && copyPresent;
  // In the Recycle Bin (or erased) on the PC: its copy goes to the disk's Recycle Bin.
  if (item.trashed_at || item.deleted_at) {
    if (!present || isInDiskTrash(copy.rel_path)) return null;
    return { ...base, kind: 'trash', size: 0 };
  }
  // Archived: on the disk only; it may have changed folder (a move).
  if (item.archived_at) {
    if (!present || copy.rel_path === to) return null;
    return { ...base, kind: 'move', size: 0 };
  }
  if (!present) return { ...base, kind: 'copy', size: item.size };
  if (copy.damaged_at) return { ...base, kind: 'repair', size: item.size };
  if (copy.sha256 !== item.sha256) return { ...base, kind: 'update', size: item.size };
  if (copy.rel_path !== to) return { ...base, kind: 'move', size: 0 };
  return null;
}

export interface PlanCounts {
  copy: number;
  update: number;
  move: number;
  trash: number;
}

/** The banner's numbers (a repair counts as an update). */
export function countSteps(steps: readonly Step[]): PlanCounts {
  const c: PlanCounts = { copy: 0, update: 0, move: 0, trash: 0 };
  for (const s of steps) {
    if (s.kind === 'repair') c.update++;
    else c[s.kind]++;
  }
  return c;
}
