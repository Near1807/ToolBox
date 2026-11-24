// The Coffre's rows (SQLite), shared by the backend's files.
import type { AttributeKey, ItemKind } from '../shared/types';

export interface ItemRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  kind: ItemKind;
  name: string;
  rel_path: string | null;
  external_path: string | null;
  size: number;
  sha256: string | null;
  ext: string;
  context_id: string | null;
  arrival: number;
  pinned: number;
  trashed_at: string | null;
  trash_from: string | null;
  source_path: string | null;
  source_url: string | null;
  referrer_url: string | null;
  file_date: string | null;
  // v0.46.0 (migration 2)
  archived_at: string | null;
  /** The PC file's last known size and date (a project: per file), to see changes. */
  stat_json: string | null;
  opened_at: string | null;
  // v0.48.0 (migration 7)
  /** The name the file had before Thomas renamed it (kept, searchable). */
  original_name: string | null;
  /** 1: imported with an arborescence, its sheet not yet checked (« À compléter »). */
  to_complete: number;
}
export interface ContextRow {
  id: string;
  created_at: string;
  deleted_at: string | null;
  parent_id: string | null;
  name: string;
  color: string | null;
  sort: number | null;
  cover_item_id: string | null;
  /** v0.47.0 (migration 6): « Lié au cours … » (null: by its name or code; « - »: none). */
  course_name: string | null;
}
export interface AttributeRow {
  id: string;
  item_id: string;
  key: AttributeKey;
  value: string;
  origin: 'guessed' | 'chosen';
  reason: string | null;
}

/** v0.46.0: a disk of the Coffre (one for now; the model allows a second one later). */
export interface DiskRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  name: string;
  /** The folder's path inside its volume (« Sauvegardes\\ToolBox-Coffre »): found again on any letter. */
  rel_root: string;
  /** Where it was last seen (information, and the first place looked at). */
  last_root: string | null;
  last_update_at: string | null;
  last_update_json: string | null;
  last_verify_json: string | null;
}

/** v0.46.0: an element's current version on a disk (one row per element and disk). */
export interface CopyRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  item_id: string;
  disk_id: string;
  /** Inside the disk's ToolBox-Coffre folder (« Cours/Thermo/x.pdf », « _ToolBox/Corbeille/<id>/x.pdf »). */
  rel_path: string;
  sha256: string | null;
  size: number;
  copied_at: string | null;
  /** In the disk's Recycle Bin since. */
  trashed_at: string | null;
  /** Found damaged by « Vérifier le disque » (a fresh copy replaces it at the next update). */
  damaged_at: string | null;
}

/** v0.46.0: an old version kept in the disk's history. */
export interface VersionRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  item_id: string;
  disk_id: string;
  rel_path: string;
  name: string;
  sha256: string | null;
  size: number;
  /** When it stopped being the current version. */
  saved_at: string;
}
