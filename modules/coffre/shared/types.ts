// v0.45.0: what the Coffre's pages receive (cahier des charges : docs/coffre/).

export type ItemKind = 'file' | 'project' | 'link';
/** « deviné » (a deduction, with its reason) or « choisi » (Thomas's: never replaced by a deduction). */
export type AttributeOrigin = 'guessed' | 'chosen';

/** The keys of the attributes (one value each, except the tags). */
export const ATTRIBUTE_KEYS = [
  'nature',
  'origin',
  'language',
  'application',
  'prof',
  'year',
  'site',
  'tag',
] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/** How each key reads in the interface. */
export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  nature: 'Nature',
  origin: 'Origine',
  language: 'Langage',
  application: 'Application',
  prof: 'Prof',
  year: 'Année',
  site: 'Site',
  tag: 'Tag',
};

export interface AttributeDto {
  key: AttributeKey;
  value: string;
  origin: AttributeOrigin;
  /** Why it was guessed (« extension .py »), shown on hover; null when chosen. */
  reason: string | null;
}

export interface ContextDto {
  id: string;
  parentId: string | null;
  name: string;
  /** « p:<palette id> » (the Agenda's category palette) or « #rrggbb », or null. */
  color: string | null;
  /** The CSS value of its colour (a theme token, or the free colour). */
  css: string;
  sort: number | null;
  /** The names from the root (« Cours › Thermo »). */
  path: string[];
  /** Elements in it (its children's not counted). */
  count: number;
  /** Elements added in the last 7 days. */
  fresh: number;
  /** The item shown as its cover, or null. */
  coverItemId: string | null;
  /** v0.47.0: « Lié au cours … » (null: automatic, by name or code; « - »: no course). */
  courseName: string | null;
}

export interface ItemDto {
  id: string;
  kind: ItemKind;
  name: string;
  /** « pdf », « py »… (« » for a project or a folder). */
  ext: string;
  size: number;
  sha256: string | null;
  contextId: string | null;
  /** « Cours › Thermo », or null (Arrivée). */
  contextPath: string[] | null;
  arrival: boolean;
  pinned: boolean;
  /** In the Coffre's Recycle Bin since (ISO), or null. */
  trashedAt: string | null;
  /** A link: the file or folder left in its place (not kept, not backed up). */
  externalPath: string | null;
  /** Where it was dropped from (information only: the original is never touched). */
  sourcePath: string | null;
  /** Its file's date (the original's), ISO. */
  fileDate: string | null;
  createdAt: string;
  updatedAt: string;
  attributes: AttributeDto[];
  /** Other contexts it is « aussi utilisé » in (links, never copies). */
  alsoIn: string[];
  /** A URL to show it (images, PDF, text, video…), or null (a link, a project). */
  url: string | null;
  /** Its file on the disk, to open or show in the Explorer. */
  path: string | null;
  /** v0.46.0: its state with the disk (« pas encore sur le disque », actif, archivé…). */
  diskState: DiskState;
  /** v0.46.0: archived and the disk absent: its file cannot be opened now. */
  unavailable: boolean;
  /** v0.48.0: the name it had before being renamed (searchable), or null. */
  originalName: string | null;
  /** v0.48.0: imported with an arborescence, its sheet not yet checked (« À compléter »). */
  toComplete: boolean;
}

export interface HomeDto {
  pinned: ItemDto[];
  recent: ItemDto[];
  arrivalCount: number;
  contexts: ContextDto[];
  /** v0.48.0: « pas encore sur le disque » per context (the map's marks). */
  pendingByContext: Record<string, number>;
  /** v0.48.0: elements imported whose sheet is not yet checked (« À compléter »). */
  toCompleteCount: number;
  /** v0.48.0: folders put in the Coffre by hand, proposed for adoption. */
  foundCount: number;
  health: {
    items: number;
    bytes: number;
    /** The PC's disk: free and total bytes (null when unknown). */
    diskFree: number | null;
    diskTotal: number | null;
    trashCount: number;
    /** v0.46.0: « pas encore sur le disque » (the one fragile state). */
    pending: number;
    archived: number;
    /** v0.47.0: the search in the content (texts read in the background). */
    index: IndexStatusDto;
    /**
     * v0.47.0: elements meant to be on this PC whose file is not here (a base
     * restored, a folder emptied by hand): « Restaurer le Coffre depuis le disque ».
     */
    missingOnPc: number;
  };
}

/** v0.47.0: where the reading of the texts (search in the content) stands. */
export interface IndexStatusDto {
  /** Elements with a fingerprint (files and projects, not in the Recycle Bin). */
  total: number;
  /** Read for their current content. */
  done: number;
  pending: number;
  withText: number;
  /** « Pas de texte » (a scanned PDF): no OCR. */
  noText: number;
  errors: number;
  running: boolean;
}

/** v0.47.0: one part of an element holding the words (a PDF's page, a project's file). */
export interface TextHitDto {
  /** « 3 » (a page, a slide), « src/main.c » (a project's file), or « ». */
  part: string;
  /** The extract, the found words between U+0001 and U+0002. */
  snippet: string;
}

/** v0.47.0: one element found, with where its words are. */
export interface SearchHitDto {
  item: ItemDto;
  /** Its name, its sheet or its context hold the words. */
  byName: boolean;
  /** Where in its content (most relevant first, at most 5). */
  hits: TextHitDto[];
  /** Number of parts holding the words (« 7 pages »). */
  partCount: number;
}

export interface SearchDto {
  query: string;
  results: SearchHitDto[];
  /** Server time (ms), for the report. */
  ms: number;
  index: IndexStatusDto;
}

/** A course of the Agenda (its service), for the deductions and a course's header. */
export interface CourseHint {
  name: string;
  code: string | null;
  teachers: string[];
  next: { start: string; end: string; location: string | null } | null;
}

/** What the Coffre proposes for a dropped file (nothing written yet). */
export interface ProposalDto {
  /** The path of the original (dropped). */
  path: string;
  name: string;
  isDirectory: boolean;
  /** Files inside a folder. */
  fileCount: number;
  size: number;
  sha256: string | null;
  /** Already in the Coffre (same content), or null. */
  duplicate: { id: string; name: string; contextPath: string[] | null } | null;
  /**
   * v0.49.0: a folder's recreatable folders set aside before counting
   * (node_modules…), with their size (partial: « plus de »).
   */
  setAside?: { rel: string; name: string; files: number; bytes: number; partial: boolean }[];
  /** The context proposed: an existing one, a new one to create (its path), or none. */
  context:
    | { kind: 'existing'; id: string; path: string[]; reason: string }
    | { kind: 'new'; path: string[]; reason: string }
    | null;
  attributes: AttributeDto[];
}

// --- v0.46.0: the disk ----------------------------------------------------------------

/** An element's state with the disk (ADR 0055). */
export type DiskState =
  /** On the PC only (new, or changed since the last update): the one fragile state. */
  | 'pending'
  /** On the PC and on the disk, the same (same fingerprint). */
  | 'active'
  /** On the disk only. */
  | 'archived'
  /** A link left in its place: not saved. */
  | 'link'
  /** In the Coffre's Recycle Bin. */
  | 'trash'
  /** Its file is not on the PC any more (moved or deleted outside ToolBox). */
  | 'missing';

/** What a disk update did (also its last one, shown in the Coffre). */
export interface UpdateReport {
  at: string;
  copied: number;
  updated: number;
  moved: number;
  trashed: number;
  repaired: number;
  /** Old versions removed by the quota (oldest first). */
  removedVersions: number;
  /** Versions larger than the whole quota (kept, reported). */
  oversized: string[];
  problems: { itemId: string; name: string; reason: string }[];
  /** Stopped before the end (cancelled, disk unplugged…): what is done stays valid. */
  stopped: string | null;
}

export interface DiskStatusDto {
  disk: { id: string; name: string; lastRoot: string | null } | null;
  connected: boolean;
  root: string | null;
  free: number | null;
  total: number | null;
  lastUpdateAt: string | null;
  lastUpdate: UpdateReport | null;
  /** What runs on the disk now (« mise à jour »…). */
  busy: string | null;
  /** v0.49.0: a deposit or an import running (its title): the update waits for its end. */
  waitsFor: string | null;
  /** v0.49.0: the update refused for now, and why (a reset to finish on this disk). */
  refuses: string | null;
  /** The running job (update, verification…), to follow its progress. */
  jobId: string | null;
  /** Elements « pas encore sur le disque ». */
  pending: number;
  archived: number;
  /** What an update would do now (from the database; the detailed plan reads the disk). */
  counts: { copy: number; update: number; move: number; trash: number };
  /** On the disk: current versions, old versions (history), its Recycle Bin. */
  bytes: { current: number; history: number; trash: number };
  /** In the disk's Recycle Bin for more than 30 days (ToolBox proposes to erase them). */
  oldTrash: number;
  /** The history quota (bytes). */
  quota: number;
}

/** v0.47.0: a new download proposed (« Proposer de ranger mes nouveaux téléchargements »). */
export interface DownloadDto {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export interface DownloadsDto {
  enabled: boolean;
  folder: string;
  pending: DownloadDto[];
  /** Seen, not stable yet (a download in progress). */
  waiting: number;
}

/** v0.47.0: one rule the Coffre learned (Réglages › Coffre › « Ce que le Coffre a appris »). */
export interface LearnedRuleDto {
  id: string;
  kind: 'site' | 'word' | 'ext';
  /** The site, the word, or the extension. */
  key: string;
  /** The context it proposes (site, word), or the one the extension is in (ext). */
  contextId: string;
  contextPath: string[] | null;
  /** The nature it proposes (ext). */
  nature: string | null;
  hits: number;
  misses: number;
  /** hits / (hits + misses). */
  confidence: number;
  /** Sure enough to propose. */
  active: boolean;
  lastAt: string | null;
}

/** v0.47.0: « Maintenant » — the course of the Agenda now (or within 15 min) and its context. */
export interface NowDto {
  course: {
    name: string;
    code: string | null;
    start: string;
    end: string;
    location: string | null;
    inProgress: boolean;
  };
  context: ContextDto | null;
  /** The context's elements, the most recent first. */
  items: ItemDto[];
}

// --- v0.48.0: importing an arborescence (ADR 0065) ----------------------------------

/** One folder of the tree to import: a context, or ONE project element. */
export interface ImportNodeDto {
  /** Relative to the folder imported (« » for itself). */
  rel: string;
  name: string;
  /** Why it is a code project (« .git », « package.json », « fichiers de code »), or null. */
  marker: string | null;
  /** Its own files (a project: all its files, its dependencies apart) and their size. */
  files: number;
  bytes: number;
  /** With its sub-folders. */
  totalFiles: number;
  totalBytes: number;
  /** Dependencies and build folders found in it (left out by default). */
  deps: { rel: string; name: string; files: number; bytes: number }[];
  /** A context of that route already exists: merged with it. */
  exists: boolean;
  children: ImportNodeDto[];
  /** Its name changed to be a valid folder name, or null. */
  invalidName: string | null;
}

export interface ImportPreviewDto {
  source: string;
  mode: 'copy' | 'adopt';
  /** Where it goes (the names of the route, [] = the root). */
  route: string[];
  tree: ImportNodeDto;
  totals: {
    folders: number;
    files: number;
    bytes: number;
    projects: number;
    ignored: number;
    duplicates: number;
    depsFiles: number;
    depsBytes: number;
  };
  /** Files already in the Coffre (same fingerprint) or twice in the import. */
  duplicates: {
    rel: string;
    existing: { id: string; name: string; contextPath: string[] | null } | null;
    twinOf: string | null;
  }[];
  /** System and temporary files, never imported. */
  ignored: string[];
  /** Existing contexts that receive files (merged). */
  merges: string[][];
}

export interface ImportStatusDto {
  id: string;
  source: string;
  mode: 'copy' | 'adopt';
  state: 'running' | 'done' | 'cancelled' | 'failed' | 'undone';
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  /** Elements and contexts made so far. */
  items: number;
  contexts: number;
  error: string | null;
  /** « Annuler » the whole import (for a while after it ended). */
  undoId: string | null;
  jobId: string | null;
  createdAt: string;
}

/** A folder put in the Coffre by hand: ToolBox proposes to adopt it. */
export interface FoundFolderDto {
  rel: string;
  name: string;
  /** Its absolute path (the adoption's source). */
  path: string;
  files: number;
  bytes: number;
  /** The route of its parent context ([] = the root). */
  route: string[];
}

// --- v0.49.0: depositing as background tasks ------------------------------------------

/** A recreatable folder set aside before counting (node_modules…). */
export interface SetAsideDto {
  rel: string;
  name: string;
  files: number;
  bytes: number;
  /** Counted only partly (time budget): « plus de ». */
  partial: boolean;
}

/** What the analysis task gives. */
export interface AnalyzeResultDto {
  proposals: ProposalDto[];
  /** Beyond the threshold: nothing analysed; « Continuer » (confirmed) or « Choisir ce qu'on garde ». */
  needsConfirm: { files: number; bytes: number; setAside: SetAsideDto[] } | null;
  setAside: SetAsideDto[];
  ignored: number;
}

/** What the rangement task gives. */
export interface ApplyResultDto {
  created: ItemDto[];
  skipped: {
    path: string;
    duplicate: { id: string; name: string; contextPath: string[] | null };
  }[];
  undoId: string | null;
  failed: number;
}

// v0.49.0: « Réinitialiser le Coffre ».
export type OnlyHereReason = 'original-absent' | 'original-different' | 'archived' | 'no-original';

export interface ResetPreviewDto {
  items: number;
  contexts: number;
  links: number;
  archived: number;
  /** The Coffre's files on the PC. */
  bytes: number;
  disk: { name: string; connected: boolean; root: string | null } | null;
  /** What exists ONLY in the Coffre (lost for ToolBox if emptied without exporting). */
  onlyHere: { id: string; name: string; contextPath: string[] | null; reason: OnlyHereReason }[];
  /** The default folder of the inventory (« Documents »). */
  inventoryParent: string;
  rules: number;
}

export interface ResetReport {
  inventory: string;
  emptied: { items: number; contexts: number };
  trashed: number;
  diskFolder: string | null;
  diskPending: boolean;
  backup: string;
}
