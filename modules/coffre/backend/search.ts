// v0.47.0 (Expérimental): the Coffre's search, on the server — the names,
// sheets and contexts (as in v0.45) AND the content (the text index), grouped
// by element, with the extract and the page. Also the Coffre's provider of
// the hub's search (Ctrl+K everywhere, MODULES.md §5.18, ADR 0057). Read only.
import type { ModuleContext, SearchResult } from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import type { ItemDto, SearchDto, SearchHitDto } from '../shared/types';
import type { AttributeRow, ContextRow, ItemRow } from './rows';
import type { TextIndex } from './text-index';

interface Deps {
  ctx: ModuleContext;
  items: string;
  attributes: string;
  textIndex: TextIndex;
  dtos: (rows: ItemRow[]) => ItemDto[];
  contextRows: () => ContextRow[];
  pathOf: (byId: Map<string, ContextRow>, id: string | null) => string[];
}

/** At most this many elements in one answer. */
const MAX_RESULTS = 200;
/** Extracts kept per element. */
const HITS_PER_ITEM = 5;

export function searchCoffre(d: Deps, query: string, limit = MAX_RESULTS): SearchDto {
  const t0 = performance.now();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return { query, results: [], ms: 0, index: d.textIndex.status() };
  // 1. The names, sheets and contexts (every word, as the v0.45 search).
  const rows = d.ctx.db
    .prepare(`SELECT * FROM ${d.items} WHERE deleted_at IS NULL AND trashed_at IS NULL`)
    .all() as ItemRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const contexts = new Map(d.contextRows().map((c) => [c.id, c]));
  const values = new Map<string, string[]>();
  for (const a of d.ctx.db
    .prepare(`SELECT item_id, value FROM ${d.attributes} WHERE deleted_at IS NULL`)
    .all() as Pick<AttributeRow, 'item_id' | 'value'>[])
    values.set(a.item_id, [...(values.get(a.item_id) ?? []), a.value]);
  const pathCache = new Map<string, string>();
  const byName = new Set<string>();
  for (const r of rows) {
    let ctxPath = r.context_id ? pathCache.get(r.context_id) : '';
    if (ctxPath === undefined) {
      ctxPath = d.pathOf(contexts, r.context_id).join(' ');
      pathCache.set(r.context_id!, ctxPath);
    }
    const hay = fold(
      [r.name, ctxPath, ...(values.get(r.id) ?? []), r.external_path ?? ''].join(' '),
    );
    if (words.every((w) => hay.includes(w))) byName.add(r.id);
  }
  // 2. The content: the parts holding every word, by relevance, grouped by element.
  const groups = new Map<
    string,
    { hits: { part: string; snippet: string }[]; count: number; rank: number }
  >();
  for (const h of d.textIndex.search(query)) {
    if (!byId.has(h.itemId)) continue;
    const g = groups.get(h.itemId) ?? { hits: [], count: 0, rank: h.rank };
    g.count++;
    if (g.hits.length < HITS_PER_ITEM) g.hits.push({ part: h.part, snippet: h.snippet });
    groups.set(h.itemId, g);
  }
  // A PDF's pages in their order (the most relevant first is kept for the first extract).
  for (const g of groups.values()) {
    const [first, ...rest] = g.hits;
    rest.sort((a, b) => (Number(a.part) || 0) - (Number(b.part) || 0));
    g.hits = first ? [first, ...rest] : [];
  }
  // Names first (most recent), then the content (most relevant).
  const named = [...byName]
    .map((id) => byId.get(id)!)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const content = [...groups.entries()]
    .filter(([id]) => !byName.has(id))
    .sort((a, b) => a[1].rank - b[1].rank)
    .map(([id]) => byId.get(id)!);
  const ordered = [...named, ...content].slice(0, limit);
  const dtos = d.dtos(ordered);
  const results: SearchHitDto[] = dtos.map((item) => {
    const g = groups.get(item.id);
    return {
      item,
      byName: byName.has(item.id),
      hits: g?.hits ?? [],
      partCount: g?.count ?? 0,
    };
  });
  return {
    query,
    results,
    ms: Math.round((performance.now() - t0) * 10) / 10,
    index: d.textIndex.status(),
  };
}

/** « page 3 », « diapositive 2 », « src/main.c ». */
export function partLabel(item: Pick<ItemDto, 'ext' | 'kind'>, part: string): string {
  if (!part) return '';
  if (item.kind === 'project') return part;
  if (item.ext === 'pptx') return `diapositive ${part}`;
  return `page ${part}`;
}

/** The route that opens an element at its page, the words marked (the preview). */
export function openRoute(itemId: string, part: string, query: string): string {
  const q = new URLSearchParams();
  if (part && /^\d+$/.test(part)) q.set('page', part);
  if (query.trim()) q.set('q', query.trim());
  const s = q.toString();
  return `/m/coffre/voir/${itemId}${s ? `?${s}` : ''}`;
}

export function registerSearch(d: Deps & { scanPc: () => Promise<unknown> }): void {
  /** Looks at the PC's files now (what changed is read again): only the PC's database is written. */
  d.ctx.routes.post('/search/refresh', async () => {
    await d.scanPc();
    d.textIndex.kick();
    return d.textIndex.status();
  });
  d.ctx.routes.get('/search', (request) => {
    const q = (request.query ?? {}) as { q?: string; limit?: string };
    const limit = Math.max(1, Math.min(MAX_RESULTS, Number(q.limit) || MAX_RESULTS));
    return searchCoffre(d, String(q.q ?? '').slice(0, 200), limit);
  });
  /** Where the reading of the texts stands (the health zone). */
  d.ctx.routes.get('/search/status', () => ({
    ...d.textIndex.status(),
    reading: d.textIndex.reading,
  }));
  /** The pages of one element holding the words (the reader's occurrences). */
  d.ctx.routes.get('/items/:id/matches', (request) => {
    const { id } = request.params as { id: string };
    const q = String((request.query as { q?: string } | undefined)?.q ?? '');
    return { parts: d.textIndex.partsOf(id, q) };
  });

  // The hub's search (Ctrl+K anywhere): the first elements, each with its best extract.
  d.ctx.search.provide({
    label: 'Coffre',
    more: (query) => `/m/coffre/chercher?q=${encodeURIComponent(query)}`,
    search: (query, limit) => {
      const r = searchCoffre(d, query, limit);
      return r.results.map((hit): SearchResult => {
        const first = hit.hits[0];
        const where = first ? partLabel(hit.item, first.part) : '';
        return {
          id: hit.item.id,
          title: hit.item.name,
          snippet: first?.snippet,
          hint: [
            hit.item.contextPath?.join(' › ') ?? 'Arrivée',
            where,
            hit.partCount > 1 ? `${hit.partCount} passages` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          icon: hit.item.kind === 'project' ? 'folder' : 'file',
          open: openRoute(hit.item.id, first?.part ?? '', first ? query : ''),
        };
      });
    },
  });
}
