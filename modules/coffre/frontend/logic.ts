// v0.45.0, v0.50.0: the Coffre's page logic that needs no screen (tested):
// the entries of the rangement window, what « Ranger » sends, the route typed,
// the sorts, the labels of « Pour tous ».
import { isRunnable } from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import { languageOfExt } from '../shared/kinds';
import type {
  FolderDto,
  ItemDto,
  LabelDto,
  LabelFamily,
  LabelValue,
  ProposalDto,
} from '../shared/types';
import type { RoutePick } from '../shared/route';
import { batchFree, batchNames, common, type BatchField, type BatchKey } from '../shared/batch';

/** Where a file goes: an existing folder, a route to create, or À ranger (null). */
export type FolderChoice =
  | { kind: 'existing'; id: string; origin: 'guessed' | 'chosen'; reason: string | null }
  | { kind: 'new'; path: string[]; origin: 'guessed' | 'chosen'; reason: string | null }
  | null;

/** One line of the rangement window. */
export interface DepositEntry {
  key: string;
  proposal: ProposalDto;
  /** The file dropped (its preview), when the page has it. */
  file: File | null;
  name: string;
  choice: FolderChoice;
  labels: LabelDto[];
  /** A folder: its sub-folders (« » = itself) marked « Projet » (proposed, changeable). */
  projects: string[];
  /** v0.51.0 F: among them, the ones « laissés en place et suivis » (never copied). */
  tracked: string[];
  /** « Garder quand même » a duplicate. */
  keepDuplicate: boolean;
  state: 'todo' | 'done' | 'later' | 'skipped';
  /** v0.48.0: « Pour tous » applies to the checked ones (all by default). */
  checked: boolean;
  /** v0.48.0: the fields changed on this file alone after « Pour tous » (kept). */
  exceptions: BatchField[];
  /** v0.48.0: its own values before « Pour tous » (an unchecked file gets them back). */
  own: { name: string; choice: FolderChoice; labels: LabelDto[] };
}

/** The entries of a set of proposals (`fixed`: the folder it was dropped on, « choisi »). */
export function entriesOf(
  proposals: readonly ProposalDto[],
  options: { files?: Map<string, File>; fixed?: string | null } = {},
): DepositEntry[] {
  return proposals
    .map((p, i): DepositEntry => ({
      key: `${i}:${p.path}`,
      proposal: p,
      file: options.files?.get(p.path) ?? null,
      name: p.name,
      choice: options.fixed
        ? { kind: 'existing', id: options.fixed, origin: 'chosen', reason: null }
        : p.route
          ? p.route.kind === 'existing'
            ? { kind: 'existing', id: p.route.id, origin: 'guessed', reason: p.route.reason }
            : { kind: 'new', path: p.route.path, origin: 'guessed', reason: p.route.reason }
          : null,
      labels: p.labels,
      // The highest projects proposed (a project inside a project does not count).
      projects: (p.projects ?? []).filter((h) => !h.nested).map((h) => h.rel),
      tracked: [],
      keepDuplicate: false,
      state: 'todo',
      checked: true,
      exceptions: [],
      own: { name: p.name, choice: null, labels: p.labels },
    }))
    .map((e): DepositEntry => ({ ...e, own: { ...e.own, choice: e.choice } }));
}

/**
 * v0.48.0: a file unchecked — « Pour tous » no longer applies to it: its own
 * values come back (what was changed on it alone is kept).
 */
export function uncheck(e: DepositEntry): DepositEntry {
  const keep = (f: BatchField) => e.exceptions.includes(f);
  let labels = e.labels;
  for (const key of ['nature', 'origin', 'year', 'free'] as LabelFamily[]) {
    if (keep(key as BatchField)) continue;
    labels = [
      ...labels.filter((a) => a.family !== key),
      ...e.own.labels.filter((a) => a.family === key),
    ];
  }
  return {
    ...e,
    checked: false,
    name: keep('rename') ? e.name : e.own.name,
    choice: keep('route') ? e.choice : e.own.choice,
    labels,
  };
}

/** What /deposit/apply receives for an entry (`later`: to À ranger, a file only). */
export function applyEntry(entry: DepositEntry, later = false) {
  const choice = later ? null : entry.choice;
  return {
    path: entry.proposal.path,
    name: entry.name.trim() || entry.proposal.name,
    later: choice === null && !entry.proposal.isDirectory,
    folderId: choice?.kind === 'existing' ? choice.id : null,
    newFolder: choice?.kind === 'new' ? choice.path : null,
    labels: entry.labels,
    keepDuplicate: entry.keepDuplicate,
    projects: entry.proposal.isDirectory ? entry.projects : undefined,
    tracked: entry.proposal.isDirectory
      ? entry.tracked.filter((t) => entry.projects.includes(t))
      : undefined,
  };
}

/** An entry that « Tout valider » leaves aside: a duplicate not kept. */
export const isHeldDuplicate = (e: DepositEntry) =>
  e.proposal.duplicate !== null && !e.keepDuplicate;

/** Thomas's values for a family: « choisi », the other families untouched. */
export function chooseValues(
  list: readonly LabelDto[],
  key: LabelFamily,
  values: readonly string[],
): LabelDto[] {
  const kept = list.filter((a) => a.family !== key);
  const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  return [
    ...kept,
    ...clean.map((value) => ({ family: key, value, origin: 'chosen' as const, reason: null })),
  ];
}

/** « Cours › Thermo », « Cours/Thermo » or « Thermo »: the names of a folder typed. */
export function parseFolderPath(text: string): string[] {
  return text
    .split(/\s*(?:›|>|\/|\\)\s*/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** The existing folder of that path (case and accents ignored), or null. */
export function folderOfPath(folders: readonly FolderDto[], names: readonly string[]) {
  const wanted = names.map(fold).join('\u0000');
  return folders.find((c) => c.path.map(fold).join('\u0000') === wanted) ?? null;
}

/** v0.48.0: what the route picker gave, as a choice (« choisi »). */
export function pickToChoice(pick: RoutePick): FolderChoice {
  if (pick.kind === 'existing')
    return { kind: 'existing', id: pick.id, origin: 'chosen', reason: null };
  if (pick.kind === 'new') return { kind: 'new', path: pick.path, origin: 'chosen', reason: null };
  return null;
}

/** A choice, as the route picker's line. */
export function choiceToPick(choice: FolderChoice): RoutePick {
  if (!choice) return { kind: 'pending' };
  return choice.kind === 'existing'
    ? { kind: 'existing', id: choice.id }
    : { kind: 'new', path: choice.path };
}

/** How a choice reads (« Cours › Thermo », « nouveau : Cours › Réseaux », « À ranger »). */
export function choiceLabel(
  choice: FolderChoice,
  folders: readonly FolderDto[],
  /** v0.50.0: a folder has no « À ranger »: without a route it goes to the top. */
  isFolder = false,
): string {
  if (!choice) return isFolder ? 'Le haut du Coffre' : 'À ranger (plus tard)';
  if (choice.kind === 'new') return `${choice.path.join(' › ')} (nouveau)`;
  return folders.find((c) => c.id === choice.id)?.path.join(' › ') ?? 'Dossier disparu';
}

export type SortKey = 'recent' | 'name' | 'nature' | 'size' | 'date';
export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Ajoutés récemment' },
  { id: 'name', label: 'Nom' },
  { id: 'nature', label: 'Nature' },
  { id: 'date', label: 'Date du fichier' },
  { id: 'size', label: 'Taille' },
];

const valueOf = (item: ItemDto, key: LabelFamily) =>
  item.labels.find((a) => a.family === key)?.value ?? '';

export function sortItems(items: readonly ItemDto[], sort: SortKey): ItemDto[] {
  const byName = (a: ItemDto, b: ItemDto) => a.name.localeCompare(b.name, 'fr', { numeric: true });
  const list = [...items];
  switch (sort) {
    case 'name':
      return list.sort(byName);
    case 'nature':
      // Without a nature: last.
      return list.sort(
        (a, b) =>
          Number(!valueOf(a, 'nature')) - Number(!valueOf(b, 'nature')) ||
          valueOf(a, 'nature').localeCompare(valueOf(b, 'nature'), 'fr') ||
          byName(a, b),
      );
    case 'size':
      return list.sort((a, b) => b.size - a.size || byName(a, b));
    case 'date':
      return list.sort(
        (a, b) => (b.fileDate ?? '').localeCompare(a.fileDate ?? '') || byName(a, b),
      );
    default:
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
  }
}

/** The tiles by family (the first name of their path), families and tiles in order. */
export function familiesOf(
  folders: readonly FolderDto[],
): { family: string; tiles: FolderDto[] }[] {
  const groups = new Map<string, FolderDto[]>();
  for (const c of folders) {
    const family = c.path[0] ?? c.name;
    groups.set(family, [...(groups.get(family) ?? []), c]);
  }
  const order = (a: FolderDto, b: FolderDto) =>
    (a.sort ?? 1e9) - (b.sort ?? 1e9) || a.path.join('/').localeCompare(b.path.join('/'), 'fr');
  return [...groups]
    .map(([family, tiles]) => ({
      family,
      // The family itself only when it holds files, or has nothing under it.
      tiles: tiles
        .filter((t) => t.path.length > 1 || t.count > 0 || tiles.length === 1)
        .sort(order),
    }))
    .sort((a, b) => a.family.localeCompare(b.family, 'fr'));
}

/** « 2 h », « hier », « 12 mars » — a short date for the cards. */
export function shortDate(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 1 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (days < 2) return 'hier';
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** The extension a card or a reader uses (« pdf »; « » for a project). */
export const extOfItem = (item: Pick<ItemDto, 'kind' | 'ext'>) =>
  item.kind === 'project' ? '' : item.ext.toLowerCase();

/**
 * v0.47.1: what a double-click (or Entrée, « Ouvrir ») does with an element.
 * A file of code (Python, JavaScript, PowerShell, shell, batch…) is never
 * handed to Windows' associated application — which may RUN it: VS Code when
 * it is installed, else ToolBox's own preview. A project goes to VS Code (or
 * its folder). Anything else: its application (a program or a script only
 * after the question that names it, `confirm`).
 */
export type OpenPlan =
  { kind: 'vscode' } | { kind: 'preview' } | { kind: 'folder' } | { kind: 'app'; confirm: boolean };

export function openPlan(
  item: Pick<ItemDto, 'kind' | 'name' | 'ext'>,
  tools: { vscode: boolean },
): OpenPlan {
  if (item.kind === 'project') return tools.vscode ? { kind: 'vscode' } : { kind: 'folder' };
  if (item.kind === 'file' && languageOfExt(item.ext) !== null)
    return tools.vscode ? { kind: 'vscode' } : { kind: 'preview' };
  return { kind: 'app', confirm: isRunnable(item.name) };
}

// --- v0.48.0: « Pour tous » (a setting for a batch) -------------------------------

/** What « Pour tous » sets; a field left undefined is not touched (« mixte » stays). */
export interface BatchValues {
  route?: FolderChoice;
  nature?: string | null;
  origin?: string | null;
  year?: string | null;
  /** Free labels added / removed. */
  freeAdd: string[];
  freeRemove: string[];
  /** The rename template (« Thermo - {nom} »); empty: the names are kept. */
  template: string;
  /** v0.50.0: labels added to all (a named set). */
  add?: LabelValue[];
}

export const emptyBatch = (): BatchValues => ({ freeAdd: [], freeRemove: [], template: '' });

/** Has this field a value in « Pour tous »? */
export function batchSets(v: BatchValues, field: BatchField): boolean {
  if (field === 'free') return v.freeAdd.length > 0 || v.freeRemove.length > 0;
  if (field === 'rename') return v.template.trim() !== '';
  if (field === 'set') return (v.add?.length ?? 0) > 0;
  return v[field] !== undefined;
}

const attrValue = (attrs: readonly LabelDto[], key: LabelFamily) =>
  attrs.find((a) => a.family === key)?.value ?? null;

/** The last name of a choice's route (for {dossier}), or null (À ranger). */
function folderNameOf(choice: FolderChoice, folders: readonly FolderDto[]): string | null {
  if (!choice) return null;
  if (choice.kind === 'new') return choice.path[choice.path.length - 1] ?? null;
  return folders.find((c) => c.id === choice.id)?.name ?? null;
}

/**
 * « Pour tous » applied to the checked files still to put away — except the
 * fields changed on a file alone (its exceptions). Every value is « choisi ».
 */
export function applyBatch(
  entries: readonly DepositEntry[],
  v: BatchValues,
  folders: readonly FolderDto[],
  date?: string,
  /** The template was just emptied: the names come back (exceptions kept). */
  resetNames = false,
): DepositEntry[] {
  const targets = entries.filter((e) => e.checked && e.state === 'todo');
  const out = new Map<string, DepositEntry>();
  for (const e of targets) {
    const keep = (f: BatchField) => e.exceptions.includes(f) || !batchSets(v, f);
    const next: DepositEntry = { ...e };
    if (!keep('route'))
      next.choice = v.route ? { ...v.route, origin: 'chosen', reason: null } : null;
    for (const key of ['nature', 'origin', 'year'] as BatchKey[]) {
      if (keep(key)) continue;
      const value = v[key];
      next.labels = chooseValues(next.labels, key, value ? [value] : []);
    }
    if (!keep('free')) {
      const free = next.labels.filter((a) => a.family === 'free').map((a) => a.value);
      next.labels = chooseValues(next.labels, 'free', batchFree(free, v.freeAdd, v.freeRemove));
    }
    if (!keep('set'))
      for (const l of v.add ?? [])
        if (!next.labels.some((x) => x.family === l.family && fold(x.value) === fold(l.value)))
          next.labels = [...next.labels, { ...l, origin: 'chosen', reason: null }];
    if (resetNames && !v.template.trim() && !e.exceptions.includes('rename'))
      next.name = e.proposal.name;
    out.set(e.key, next);
  }
  // The names: from the template, collisions inside the batch numbered.
  if (v.template.trim()) {
    const renamed = targets.filter((e) => !e.exceptions.includes('rename'));
    const names = batchNames(
      renamed.map((e) => ({
        key: e.key,
        name: e.proposal.name,
        folder: folderNameOf(out.get(e.key)!.choice, folders),
      })),
      v.template,
      date,
    );
    for (const [key, name] of names) out.set(key, { ...out.get(key)!, name });
  }
  return entries.map((e) => out.get(e.key) ?? e);
}

/** A file's own change after « Pour tous »: an exception for that field (kept). */
export function markException(
  entry: DepositEntry,
  field: BatchField,
  v: BatchValues,
): DepositEntry['exceptions'] {
  return entry.checked && batchSets(v, field) && !entry.exceptions.includes(field)
    ? [...entry.exceptions, field]
    : entry.exceptions;
}

/** What « Pour tous » shows for a field: the common value, or « mixte ». */
export function batchSummary(
  entries: readonly { choice: FolderChoice; labels: readonly LabelDto[] }[],
  folders: readonly FolderDto[],
) {
  return {
    route: common(entries.map((e) => choiceLabel(e.choice, folders))),
    nature: common(entries.map((e) => attrValue(e.labels, 'nature'))),
    origin: common(entries.map((e) => attrValue(e.labels, 'origin'))),
    year: common(entries.map((e) => attrValue(e.labels, 'year'))),
    /** The free labels every file has, and those only some have. */
    free: (() => {
      const lists = entries.map((e) =>
        e.labels.filter((a) => a.family === 'free').map((a) => a.value),
      );
      const all = [...new Set(lists.flat())];
      return {
        everywhere: all.filter((t) => lists.every((l) => l.includes(t))),
        some: all.filter((t) => !lists.every((l) => l.includes(t))),
      };
    })(),
  };
}
