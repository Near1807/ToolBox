// The Coffre's rows (SQLite), shared by the backend's files.
import type { ItemKind, LabelFamily, LabelOrigin } from '../shared/types';

/**
 * v0.50.0 (ADR 0067): an entry of the Coffre — a file, or the content of a
 * Projet folder (`kind = 'project'`, its path = the folder's).
 */
export interface ItemRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  kind: ItemKind;
  name: string;
  rel_path: string | null;
  size: number;
  sha256: string | null;
  ext: string;
  /** Its folder (null: À ranger). A project: the Projet folder itself. */
  folder_id: string | null;
  pinned: number;
  trashed_at: string | null;
  trash_from: string | null;
  /** The original (left in its place) and its fingerprint when dropped (v0.52). */
  source_path: string | null;
  source_sha256: string | null;
  source_url: string | null;
  referrer_url: string | null;
  file_date: string | null;
  archived_at: string | null;
  /** The PC file's last known size and date (a project: per file), to see changes. */
  stat_json: string | null;
  opened_at: string | null;
  /** The name it had before Thomas renamed it (kept, searchable). */
  original_name: string | null;
  /**
   * v0.51.0 (ADR 0068): a project « suivi en place » — its real folder on the PC
   * (absolute; the Coffre never moves it). Null: copied in the Coffre.
   */
  tracked_path: string | null;
  /** v0.51.0: a followed project whose folder is not found since (« introuvable »). */
  missing_at: string | null;
  /** v0.51.0: a project's own exclusions, JSON { exclude: rel[], include: rel[] }. */
  exclusions_json: string | null;
}

/** v0.51.0: a file inside a project, as last seen on the PC (a derived index of this PC). */
export interface InnerFileRow {
  item_id: string;
  rel: string;
  name: string;
  ext: string;
  /** Its path folded (accents, case) for the search by name. */
  folded: string;
  size: number;
  mtime: number;
  sha256: string;
  /** The fingerprint whose text is in the index, its state, its rows (« first-last »). */
  text_sha: string | null;
  text_status: string | null;
  text_rows: string | null;
  text_at: string | null;
}

/** v0.51.0: a file of a project as its copy on a disk holds it (the disk's manifest). */
export interface InnerCopyRow {
  disk_id: string;
  item_id: string;
  rel: string;
  sha256: string;
  size: number;
  copied_at: string;
}

/** v0.50.0: a folder of the Coffre (a real folder: its route is its path). */
export interface FolderRow {
  id: string;
  created_at: string;
  deleted_at: string | null;
  parent_id: string | null;
  name: string;
  color: string | null;
  sort: number | null;
  /** « Lié au cours … » (null: by its name or code; « - »: none). */
  course_name: string | null;
  /** 1: « Fin de route » (its sub-folders not on the map). */
  end_of_route: number;
  /** 1: « Projet » (indivisible; its content is ONE item of kind « project »). */
  project: number;
  /** Its default labels (JSON LabelValue[]). */
  default_labels_json: string;
}

export interface LabelRow {
  id: string;
  item_id: string;
  family: LabelFamily;
  value: string;
  origin: LabelOrigin;
  reason: string | null;
}

export interface LabelSetRow {
  id: string;
  deleted_at: string | null;
  name: string;
  labels_json: string;
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
  /** v0.51.0: a file inside a project (its path in it); null: the element itself. */
  inner_rel: string | null;
}
