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
}

export interface HomeDto {
  pinned: ItemDto[];
  recent: ItemDto[];
  arrivalCount: number;
  contexts: ContextDto[];
  health: {
    items: number;
    bytes: number;
    /** The PC's disk: free and total bytes (null when unknown). */
    diskFree: number | null;
    diskTotal: number | null;
    trashCount: number;
  };
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
  /** The context proposed: an existing one, a new one to create (its path), or none. */
  context:
    | { kind: 'existing'; id: string; path: string[]; reason: string }
    | { kind: 'new'; path: string[]; reason: string }
    | null;
  attributes: AttributeDto[];
}
