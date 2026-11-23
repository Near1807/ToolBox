// v0.45.0: the Coffre's page logic that needs no screen (tested): the
// entries of the rangement window, what « Ranger » sends, the context typed
// in the sheet, the sorts and the families of the tiles.
import { fold } from '../shared/deduce';
import type { AttributeDto, AttributeKey, ContextDto, ItemDto, ProposalDto } from '../shared/types';

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
}

/** The entries of a set of proposals (`fixed`: the context it was dropped on, « choisi »). */
export function entriesOf(
  proposals: readonly ProposalDto[],
  options: { files?: Map<string, File>; fixed?: string | null; as?: 'copy' | 'link' } = {},
): DepositEntry[] {
  return proposals.map((p, i) => ({
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
  }));
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
