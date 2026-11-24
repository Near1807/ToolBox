// v0.45.0: the filters in pills of a context's page and the views by
// attribute (« Python », « Prof PCH »): combinable — AND between two keys,
// OR inside one key —, with the number of elements each pill would show.
// Pure (tested).
import { fold } from './deduce';
import { ATTRIBUTE_KEYS, type AttributeKey, type ItemDto } from './types';

/** The pills chosen: for each key, the values kept (none: no filter on that key). */
export type FacetSelection = Partial<Record<AttributeKey, string[]>>;

const valuesOf = (item: ItemDto, key: AttributeKey) =>
  item.attributes.filter((a) => a.key === key).map((a) => a.value);

/** Does the item pass every key's filter? */
export function matches(item: ItemDto, selection: FacetSelection): boolean {
  return ATTRIBUTE_KEYS.every((key) => {
    const wanted = selection[key];
    if (!wanted?.length) return true;
    const own = valuesOf(item, key).map(fold);
    return wanted.some((w) => own.includes(fold(w)));
  });
}

export const filterItems = (items: readonly ItemDto[], selection: FacetSelection) =>
  items.filter((i) => matches(i, selection));

export interface Facet {
  key: AttributeKey;
  values: { value: string; count: number; on: boolean }[];
}

/**
 * The pills of a list: for each key, its values with the number of elements
 * the pill gives WITH the other keys' filters (so a pill never promises an
 * empty list), most frequent first. Keys without values are left out.
 */
export function facetsOf(items: readonly ItemDto[], selection: FacetSelection): Facet[] {
  const out: Facet[] = [];
  for (const key of ATTRIBUTE_KEYS) {
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

/** The search (v0.45: names, sheets, attributes; the content in v0.47): every word must be found. */
export function searchItems(items: readonly ItemDto[], query: string): ItemDto[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((i) => {
    const hay = fold(
      [
        i.name,
        ...(i.contextPath ?? []),
        ...i.attributes.map((a) => a.value),
        i.externalPath ?? '',
      ].join(' '),
    );
    return words.every((w) => hay.includes(w));
  });
}
