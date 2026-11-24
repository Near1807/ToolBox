// v0.45.0: the Coffre's page logic that needs no screen (tested): the
// entries of the rangement window, what « Ranger » sends, the context typed
// in the sheet, the sorts and the families of the tiles.
import { isRunnable } from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import { languageOfExt } from '../shared/kinds';
import type { AttributeDto, AttributeKey, ContextDto, ItemDto, ProposalDto } from '../shared/types';
import type { RoutePick } from '../shared/route';
import { batchNames, batchTags, common, type BatchField, type BatchKey } from '../shared/batch';

/** Where an element goes: an existing context, one to create (its path), or Arrivée (null). */
export type ContextChoice =
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
  as: 'copy' | 'link';
  choice: ContextChoice;
  attributes: AttributeDto[];
  /** « Garder quand même » a duplicate. */
  keepDuplicate: boolean;
  state: 'todo' | 'done' | 'later' | 'skipped';
  /** v0.48.0: « Pour tous » applies to the checked ones (all by default). */
  checked: boolean;
  /** v0.48.0: the fields changed on this file alone after « Pour tous » (kept). */
  exceptions: BatchField[];
  /** v0.48.0: its own values before « Pour tous » (an unchecked file gets them back). */
  own: { name: string; choice: ContextChoice; attributes: AttributeDto[] };
}

/** The entries of a set of proposals (`fixed`: the context it was dropped on, « choisi »). */
export function entriesOf(
  proposals: readonly ProposalDto[],
  options: { files?: Map<string, File>; fixed?: string | null; as?: 'copy' | 'link' } = {},
): DepositEntry[] {
  return proposals
    .map((p, i): DepositEntry => ({
      key: `${i}:${p.path}`,
      proposal: p,
      file: options.files?.get(p.path) ?? null,
      name: p.name,
      as: options.as ?? 'copy',
      choice: options.fixed
        ? { kind: 'existing', id: options.fixed, origin: 'chosen', reason: null }
        : p.context
          ? p.context.kind === 'existing'
            ? { kind: 'existing', id: p.context.id, origin: 'guessed', reason: p.context.reason }
            : { kind: 'new', path: p.context.path, origin: 'guessed', reason: p.context.reason }
          : null,
      attributes: p.attributes,
      keepDuplicate: false,
      state: 'todo',
      checked: true,
      exceptions: [],
      own: { name: p.name, choice: null, attributes: p.attributes },
    }))
    .map((e): DepositEntry => ({ ...e, own: { ...e.own, choice: e.choice } }));
}

/**
 * v0.48.0: a file unchecked — « Pour tous » no longer applies to it: its own
 * values come back (what was changed on it alone is kept).
 */
export function uncheck(e: DepositEntry): DepositEntry {
  const keep = (f: BatchField) => e.exceptions.includes(f);
  let attributes = e.attributes;
  for (const key of ['nature', 'origin', 'year', 'tag'] as AttributeKey[]) {
    if (keep(key === 'tag' ? 'tags' : (key as BatchField))) continue;
    attributes = [
      ...attributes.filter((a) => a.key !== key),
      ...e.own.attributes.filter((a) => a.key === key),
    ];
  }
  return {
    ...e,
    checked: false,
    name: keep('rename') ? e.name : e.own.name,
    choice: keep('route') ? e.choice : e.own.choice,
    attributes,
  };
}

/** What /deposit/apply receives for an entry (`later`: to Arrivée). */
export function applyEntry(entry: DepositEntry, later = false) {
  const choice = later ? null : entry.choice;
  return {
    path: entry.proposal.path,
    as: entry.as === 'link' ? 'link' : undefined,
    name: entry.name.trim() || entry.proposal.name,
    arrival: choice === null,
    contextId: choice?.kind === 'existing' ? choice.id : null,
    newContext: choice?.kind === 'new' ? choice.path : null,
    attributes: entry.attributes,
    keepDuplicate: entry.keepDuplicate,
  };
}

/** An entry that « Tout valider » leaves aside: a duplicate not kept. */
export const isHeldDuplicate = (e: DepositEntry) =>
  e.as !== 'link' && e.proposal.duplicate !== null && !e.keepDuplicate;

/** Thomas's values for a key: « choisi », the other keys untouched. */
export function chooseValues(
  list: readonly AttributeDto[],
  key: AttributeKey,
  values: readonly string[],
): AttributeDto[] {
  const kept = list.filter((a) => a.key !== key);
  const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  return [
    ...kept,
    ...clean.map((value) => ({ key, value, origin: 'chosen' as const, reason: null })),
  ];
}

/** « Cours › Thermo », « Cours/Thermo » or « Thermo »: the names of a context typed. */
export function parseContextPath(text: string): string[] {
  return text
    .split(/\s*(?:›|>|\/|\\)\s*/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** The existing context of that path (case and accents ignored), or null. */
export function contextOfPath(contexts: readonly ContextDto[], names: readonly string[]) {
  const wanted = names.map(fold).join('\u0000');
  return contexts.find((c) => c.path.map(fold).join('\u0000') === wanted) ?? null;
}

/** v0.48.0: what the route picker gave, as a choice (« choisi »). */
export function pickToChoice(pick: RoutePick): ContextChoice {
  if (pick.kind === 'existing')
    return { kind: 'existing', id: pick.id, origin: 'chosen', reason: null };
  if (pick.kind === 'new') return { kind: 'new', path: pick.path, origin: 'chosen', reason: null };
  return null;
}

/** A choice, as the route picker's line. */
export function choiceToPick(choice: ContextChoice): RoutePick {
  if (!choice) return { kind: 'arrival' };
  return choice.kind === 'existing'
    ? { kind: 'existing', id: choice.id }
    : { kind: 'new', path: choice.path };
}

/** How a choice reads (« Cours › Thermo », « nouveau : Cours › Réseaux », « Arrivée »). */
export function choiceLabel(choice: ContextChoice, contexts: readonly ContextDto[]): string {
  if (!choice) return 'Arrivée (à ranger plus tard)';
  if (choice.kind === 'new') return `${choice.path.join(' › ')} (nouveau)`;
  return contexts.find((c) => c.id === choice.id)?.path.join(' › ') ?? 'Contexte disparu';
}

export type SortKey = 'recent' | 'name' | 'nature' | 'size' | 'date';
export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Ajoutés récemment' },
  { id: 'name', label: 'Nom' },
  { id: 'nature', label: 'Nature' },
  { id: 'date', label: 'Date du fichier' },
  { id: 'size', label: 'Taille' },
];

const valueOf = (item: ItemDto, key: AttributeKey) =>
  item.attributes.find((a) => a.key === key)?.value ?? '';

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
  contexts: readonly ContextDto[],
): { family: string; tiles: ContextDto[] }[] {
  const groups = new Map<string, ContextDto[]>();
  for (const c of contexts) {
    const family = c.path[0] ?? c.name;
    groups.set(family, [...(groups.get(family) ?? []), c]);
  }
  const order = (a: ContextDto, b: ContextDto) =>
    (a.sort ?? 1e9) - (b.sort ?? 1e9) || a.path.join('/').localeCompare(b.path.join('/'), 'fr');
  return [...groups]
    .map(([family, tiles]) => ({
      family,
      // The family itself only when it holds elements, or has nothing under it.
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
  route?: ContextChoice;
  nature?: string | null;
  origin?: string | null;
  year?: string | null;
  tagsAdd: string[];
  tagsRemove: string[];
  /** The rename template (« Thermo - {nom} »); empty: the names are kept. */
  template: string;
}

export const emptyBatch = (): BatchValues => ({ tagsAdd: [], tagsRemove: [], template: '' });

/** Has this field a value in « Pour tous »? */
export function batchSets(v: BatchValues, field: BatchField): boolean {
  if (field === 'tags') return v.tagsAdd.length > 0 || v.tagsRemove.length > 0;
  if (field === 'rename') return v.template.trim() !== '';
  return v[field] !== undefined;
}

const attrValue = (attrs: readonly AttributeDto[], key: AttributeKey) =>
  attrs.find((a) => a.key === key)?.value ?? null;

/** The last name of a choice's route (for {contexte}), or null (Arrivée). */
function contextNameOf(choice: ContextChoice, contexts: readonly ContextDto[]): string | null {
  if (!choice) return null;
  if (choice.kind === 'new') return choice.path[choice.path.length - 1] ?? null;
  return contexts.find((c) => c.id === choice.id)?.name ?? null;
}

/**
 * « Pour tous » applied to the checked files still to put away — except the
 * fields changed on a file alone (its exceptions). Every value is « choisi ».
 */
export function applyBatch(
  entries: readonly DepositEntry[],
  v: BatchValues,
  contexts: readonly ContextDto[],
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
      next.attributes = chooseValues(next.attributes, key, value ? [value] : []);
    }
    if (!keep('tags')) {
      const tags = next.attributes.filter((a) => a.key === 'tag').map((a) => a.value);
      next.attributes = chooseValues(
        next.attributes,
        'tag',
        batchTags(tags, v.tagsAdd, v.tagsRemove),
      );
    }
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
        context: contextNameOf(out.get(e.key)!.choice, contexts),
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
  entries: readonly { choice: ContextChoice; attributes: readonly AttributeDto[] }[],
  contexts: readonly ContextDto[],
) {
  return {
    route: common(entries.map((e) => choiceLabel(e.choice, contexts))),
    nature: common(entries.map((e) => attrValue(e.attributes, 'nature'))),
    origin: common(entries.map((e) => attrValue(e.attributes, 'origin'))),
    year: common(entries.map((e) => attrValue(e.attributes, 'year'))),
    /** The tags every file has, and those only some have. */
    tags: (() => {
      const lists = entries.map((e) =>
        e.attributes.filter((a) => a.key === 'tag').map((a) => a.value),
      );
      const all = [...new Set(lists.flat())];
      return {
        everywhere: all.filter((t) => lists.every((l) => l.includes(t))),
        some: all.filter((t) => !lists.every((l) => l.includes(t))),
      };
    })(),
  };
}
