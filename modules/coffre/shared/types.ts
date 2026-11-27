// v0.45.0: what the Coffre's pages receive (cahier des charges : docs/coffre/).

/**
 * v0.50.0 (ADR 0067): an entry of the Coffre — a file, or the content of a
 * Projet folder (one entry: the disk copies, archives and checks it whole).
 */
export type ItemKind = 'file' | 'project';
/**
 * « deviné » (a deduction, with its reason), « choisi » (Thomas's: never
 * replaced by a deduction), or « par défaut du dossier » (its folder's).
 */
export type LabelOrigin = 'guessed' | 'chosen' | 'default';

/** v0.50.0: the families of the labels (several values each). */
export const LABEL_FAMILIES = [
  'nature',
  'language',
  'year',
  'origin',
  'site',
  'course',
  'prof',
  'free',
] as const;
export type LabelFamily = (typeof LABEL_FAMILIES)[number];

/** How each family reads in the interface. */
export const FAMILY_NAMES: Record<LabelFamily, string> = {
  nature: 'Nature',
  language: 'Langage',
  year: 'Année',
  origin: 'Origine',
  site: 'Site',
  course: 'Cours',
  prof: 'Prof',
  free: 'Libre',
};

export interface LabelDto {
  family: LabelFamily;
  value: string;
  origin: LabelOrigin;
  /** Why it was guessed (« extension .py »), shown on hover; null when chosen. */
  reason: string | null;
}

/** A label without its origin (a folder's default labels, a named set, the clipboard). */
export interface LabelValue {
  family: LabelFamily;
  value: string;
}

/** v0.50.0: a named set of labels (« Slides de cours »). */
export interface LabelSetDto {
  id: string;
  name: string;
  labels: LabelValue[];
}

/** v0.50.0: a folder of the Coffre (a real folder, its route = its path). */
export interface FolderDto {
  id: string;
  parentId: string | null;
  name: string;
  /** « p:<palette id> » (the Agenda's category palette) or « #rrggbb », or null. */
  color: string | null;
  /** The CSS value of its colour (a theme token, or the free colour). */
  css: string;
  sort: number | null;
  /** Its route: the names from the top (« Cours », « Thermo »). */
  path: string[];
  /** Files in it (its sub-folders' not counted; a project: the files of its folder). */
  count: number;
  /** Files of it and of its descendants (the map's numbers). */
  total: number;
  /** Files added in the last 7 days. */
  fresh: number;
  /** « Fin de route »: its sub-folders are not on the map nor in the tree. */
  endOfRoute: boolean;
  /** « Projet »: indivisible, VS Code, Git read (an end of route too). */
  project: boolean;
  /** Inside a Projet or a Fin de route above it (not on the map, browsed inside). */
  inside: boolean;
  /** Its default labels (proposed to the files put in it and its sub-folders). */
  defaults: LabelValue[];
  /** « Lié au cours … » (null: automatic, by name or code; « - »: no course). */
  courseName: string | null;
}

export interface ItemDto {
  id: string;
  kind: ItemKind;
  name: string;
  /** « pdf », « py »… (« » for a project). */
  ext: string;
  size: number;
  sha256: string | null;
  folderId: string | null;
  /** Its route (« Cours », « Thermo »), or null: À ranger. */
  folderPath: string[] | null;
  /** In a Projet (or is one): no action file by file (indivisible). */
  inProject: boolean;
  pinned: boolean;
  /** In the Coffre's Recycle Bin since (ISO), or null. */
  trashedAt: string | null;
  /** v0.50.0: where it was dropped from (the original, never touched) and its fingerprint then. */
  sourcePath: string | null;
  sourceSha256: string | null;
  /** Its file's date (the original's), ISO. */
  fileDate: string | null;
  createdAt: string;
  updatedAt: string;
  labels: LabelDto[];
  /** A URL to show it (images, PDF, text, video…), or null (a project). */
  url: string | null;
  /** Its file on the disk, to open or show in the Explorer. */
  path: string | null;
  /** Its state with the disk (« pas encore sur le disque », actif, archivé…). */
  diskState: DiskState;
  /** Archived and the disk absent: its file cannot be opened now. */
  unavailable: boolean;
  /** The name it had before being renamed (searchable), or null. */
  originalName: string | null;
}

export interface HomeDto {
  pinned: ItemDto[];
  recent: ItemDto[];
  /** À ranger: files put there with « Ranger plus tard ». */
  pendingCount: number;
  folders: FolderDto[];
  /** « pas encore sur le disque » per folder (with its descendants: the map's marks). */
  pendingByFolder: Record<string, number>;
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
  /** Its name, its labels or its route hold the words. */
  byName: boolean;
  /** Where in its content (most relevant first, at most 5). */
  hits: TextHitDto[];
  /** Number of parts holding the words (« 7 pages »). */
  partCount: number;
  /**
   * v0.51.0 (ADR 0068): a file INSIDE the project `item` (a result on its own),
   * or null (the element itself).
   */
  inner: InnerHitDto | null;
}

/** v0.51.0: a file inside a project, found by its name or its content. */
export interface InnerHitDto {
  rel: string;
  name: string;
  ext: string;
  size: number;
  /** The first line holding the words (text, code), or null. */
  line: number | null;
  /** The first page (PDF), or null. */
  page: string | null;
}

export interface SearchDto {
  query: string;
  results: SearchHitDto[];
  /** Server time (ms), for the report. */
  ms: number;
  index: IndexStatusDto;
}

/** A course of the Agenda (its service), for the deductions and a course folder's header. */
export interface CourseHint {
  name: string;
  code: string | null;
  teachers: string[];
  next: { start: string; end: string; location: string | null } | null;
}

/** A sub-folder of a dropped folder that looks like a code project (« Projet » proposed). */
export interface ProjectHintDto {
  /** Relative to the dropped folder (« » for itself). */
  rel: string;
  /** Why (« .git », « package.json », « contient du code »). */
  reason: string;
  /** Inside another project hint: only the highest counts (signalled). */
  nested: boolean;
}

/** The route proposed for a dropped file or folder: an existing folder, a new route, or none. */
type RouteProposal =
  | { kind: 'existing'; id: string; path: string[]; reason: string }
  | { kind: 'new'; path: string[]; reason: string }
  | null;

/** What the Coffre proposes for a dropped file or folder (nothing written yet). */
export interface ProposalDto {
  /** The path of the original (dropped). */
  path: string;
  name: string;
  isDirectory: boolean;
  /** Files inside a folder (its excluded folders apart). */
  fileCount: number;
  /** Sub-folders inside a folder (hidden ones apart). */
  folderCount: number;
  size: number;
  sha256: string | null;
  /** Already in the Coffre (same content), or null. */
  duplicate: { id: string; name: string; folderPath: string[] | null } | null;
  /** A folder: its files already in the Coffre (same content), counted (they come anyway). */
  innerDuplicates?: number;
  /** A folder's recreatable folders set aside before counting (node_modules…), with their size. */
  setAside?: SetAsideDto[];
  /** A folder: the sub-folders (or itself) proposed as « Projet ». */
  projects?: ProjectHintDto[];
  route: RouteProposal;
  labels: LabelDto[];
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
  /** v0.51.0: files copied inside projects (only the added or changed ones). */
  files: number;
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
  /** The folder it proposes (site, word), or the one the extension is in (ext). */
  folderId: string;
  folderPath: string[] | null;
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

/** v0.47.0: « Maintenant » — the course of the Agenda now (or within 15 min) and its folder. */
export interface NowDto {
  course: {
    name: string;
    code: string | null;
    start: string;
    end: string;
    location: string | null;
    inProgress: boolean;
  };
  folder: FolderDto | null;
  /** The folder's files, the most recent first. */
  items: ItemDto[];
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
    duplicate: { id: string; name: string; folderPath: string[] | null };
  }[];
  undoId: string | null;
  failed: number;
}

// v0.49.0: « Réinitialiser le Coffre ».
export type OnlyHereReason = 'original-absent' | 'original-different' | 'archived' | 'no-original';

export interface ResetPreviewDto {
  items: number;
  folders: number;
  archived: number;
  /** The Coffre's files on the PC. */
  bytes: number;
  disk: { name: string; connected: boolean; root: string | null } | null;
  /** What exists ONLY in the Coffre (lost for ToolBox if emptied without exporting). */
  onlyHere: { id: string; name: string; folderPath: string[] | null; reason: OnlyHereReason }[];
  /** The default folder of the inventory (« Documents »). */
  inventoryParent: string;
  rules: number;
}

export interface ResetReport {
  inventory: string;
  emptied: { items: number; folders: number };
  trashed: number;
  diskFolder: string | null;
  diskPending: boolean;
  backup: string;
}

// --- v0.50.0: inside a Fin de route or a Projet -----------------------------------------

/** One entry of a folder's inside (read from the PC's folder for a project). */
export interface InsideEntryDto {
  /** Relative to the folder (« src/main.py »). */
  rel: string;
  name: string;
  dir: boolean;
  size: number;
  /** A dot name or a recreatable folder: hidden unless « Afficher les dossiers cachés ». */
  hidden: boolean;
  /** Not saved nor searched (recreatable, .gitignore of a project). */
  excluded: boolean;
  /** v0.51.0: why (the default list, a .gitignore, Thomas's choice), or null. */
  excludedReason: ExclusionReasonDto | null;
  /** A file of the Coffre (a row): its id (not inside a project). */
  itemId: string | null;
  /** To show it (its reader). */
  url: string | null;
  path: string;
}

export interface InsideDto {
  folder: FolderDto;
  entries: InsideEntryDto[];
  /** The README shown by default, or null. */
  readme: string | null;
  /** A project: its branch and last commit, read in .git (never a git command). */
  git: {
    branch: string | null;
    commit: { hash: string; message: string; date: string | null } | null;
    /** v0.51.0: changes not committed (git's own index read), or null (not told). */
    changes: { modified: number; deleted: number; untracked: number } | null;
  } | null;
  /** Cut at this many entries (a huge folder). */
  truncated: boolean;
}

/** v0.51.0 (ADR 0068): why a project does not save a path. */
export type ExclusionReasonDto = 'défaut' | '.gitignore' | 'choisi';

/** v0.51.0: what a project does not save, and what it saves. */
export interface ExclusionsDto {
  choices: { exclude: string[]; include: string[] };
  excluded: {
    rel: string;
    dir: boolean;
    reason: ExclusionReasonDto;
    files: number;
    bytes: number;
    /** Measured only partly: « plus de ». */
    partial: boolean;
  }[];
  files: number;
  bytes: number;
  /** The project's folder is there (false: archived, or a followed folder not found). */
  available: boolean;
}

/** v0.51.0: one file inside a project, for its reader (its own page or window). */
export interface InnerFileDto {
  projectId: string;
  /** The Projet folder (its page shows the file in its tree). */
  folderId: string | null;
  rel: string;
  name: string;
  ext: string;
  size: number;
  url: string | null;
  path: string | null;
  /** Deduced (language, year) or the project's (« du projet »): no sheet of its own. */
  labels: LabelDto[];
}

/** v0.51.0: the files inside one project in a view by label. */
export interface InnerGroupDto {
  project: ItemDto;
  files: InnerHitDto[];
}
