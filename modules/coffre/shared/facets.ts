// v0.45.0, v0.50.0: the filters in pills of a folder's view and the views by
// label (« Python », « Prof PCH »): combinable — AND between two families,
// OR inside one family —, with the number of files each pill would show.
// Pure (tested).
import { fold } from './deduce';
import { LABEL_FAMILIES, type ItemDto, type LabelFamily } from './types';

/** The pills chosen: for each family, the values kept (none: no filter on that family). */
export type FacetSelection = Partial<Record<LabelFamily, string[]>>;

const valuesOf = (item: ItemDto, key: LabelFamily) =>
  item.labels.filter((l) => l.family === key).map((l) => l.value);

/** Does the item pass every key's filter? */
export function matches(item: ItemDto, selection: FacetSelection): boolean {
  return LABEL_FAMILIES.every((key) => {
    const wanted = selection[key];
    if (!wanted?.length) return true;
    const own = valuesOf(item, key).map(fold);
    return wanted.some((w) => own.includes(fold(w)));
  });
}

export const filterItems = (items: readonly ItemDto[], selection: FacetSelection) =>
  items.filter((i) => matches(i, selection));

export interface Facet {
  key: LabelFamily;
  values: { value: string; count: number; on: boolean }[];
}

/**
 * The pills of a list: for each family, its values with the number of elements
 * the pill gives WITH the other families' filters (so a pill never promises an
 * empty list), most frequent first. Families without values are left out.
 */
export function facetsOf(items: readonly ItemDto[], selection: FacetSelection): Facet[] {
  const out: Facet[] = [];
  for (const key of LABEL_FAMILIES) {
    const others = { ...selection, [key]: [] };
    const pool = items.filter((i) => matches(i, others));
    const counts = new Map<string, { value: string; count: number }>();
    for (const item of pool)
      for (const v of new Set(valuesOf(item, key))) {
        const k = fold(v);
        const c = counts.get(k) ?? { value: v, count: 0 };
        c.count++;
        counts.set(k, c);
      }
    const chosen = (selection[key] ?? []).map(fold);
    const values = [...counts.values()]
      .map((v) => ({ ...v, on: chosen.includes(fold(v.value)) }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'fr'));
    if (values.length) out.push({ key, values });
  }
  return out;
}

/** The search on a list (names, routes, labels): every word must be found. */
export function searchItems(items: readonly ItemDto[], query: string): ItemDto[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((i) => {
    const hay = fold([i.name, ...(i.folderPath ?? []), ...i.labels.map((l) => l.value)].join(' '));
    return words.every((w) => hay.includes(w));
  });
}
