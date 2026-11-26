// v0.47.0 (Expérimental): the Coffre's search, on the server — the names,
// labels and routes AND the content (the text index), grouped by file, with
// the extract and the page (v0.50.0: labels instead of the old sheet). Also the Coffre's provider of
// the hub's search (Ctrl+K everywhere, MODULES.md §5.18, ADR 0057). Read only.
import type { ModuleContext, SearchResult } from '@hub/sdk/core';
import { fold } from '../shared/deduce';
import type { InnerHitDto, ItemDto, SearchDto, SearchHitDto } from '../shared/types';
import type { FolderRow, ItemRow, LabelRow } from './rows';
import { splitInnerPart, type TextIndex } from './text-index';

interface Deps {
  ctx: ModuleContext;
  items: string;
  /** v0.51.0: the index of the files inside the projects. */
  inner: string;
  labels: string;
  textIndex: TextIndex;
  dtos: (rows: ItemRow[]) => ItemDto[];
  folderRows: () => FolderRow[];
  pathOf: (byId: Map<string, FolderRow>, id: string | null) => string[];
}

/** At most this many elements in one answer. */
const MAX_RESULTS = 200;
/** Extracts kept per element. */
const HITS_PER_ITEM = 5;
/** v0.51.0: files inside the projects found by their name, at most. */
const MAX_INNER_NAMED = 100;

export function searchCoffre(d: Deps, query: string, limit = MAX_RESULTS): SearchDto {
  const t0 = performance.now();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return { query, results: [], ms: 0, index: d.textIndex.status() };
  // 1. The names, labels and routes (every word).
  const rows = d.ctx.db
    .prepare(`SELECT * FROM ${d.items} WHERE deleted_at IS NULL AND trashed_at IS NULL`)
    .all() as ItemRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const folders = new Map(d.folderRows().map((c) => [c.id, c]));
  const values = new Map<string, string[]>();
  for (const a of d.ctx.db
    .prepare(`SELECT item_id, value FROM ${d.labels} WHERE deleted_at IS NULL`)
    .all() as Pick<LabelRow, 'item_id' | 'value'>[])
    values.set(a.item_id, [...(values.get(a.item_id) ?? []), a.value]);
  const pathCache = new Map<string, string>();
  const byName = new Set<string>();
  for (const r of rows) {
    let routePath = r.folder_id ? pathCache.get(r.folder_id) : '';
    if (routePath === undefined) {
      routePath = d.pathOf(folders, r.folder_id).join(' ');
      pathCache.set(r.folder_id!, routePath);
    }
    const hay = fold(
      [r.name, r.original_name ?? '', routePath, ...(values.get(r.id) ?? [])].join(' '),
    );
    if (words.every((w) => hay.includes(w))) byName.add(r.id);
  }
  // 1 bis. v0.51.0: the files inside the projects, by their path (and the project's name).
  const innerNamed = (
    d.ctx.db
      .prepare(
        `SELECT f.item_id AS itemId, f.rel AS rel, f.name AS name, f.ext AS ext, f.size AS size
         FROM ${d.inner} f JOIN ${d.items} i ON i.id = f.item_id
         WHERE i.deleted_at IS NULL AND i.trashed_at IS NULL
           ${words.map(() => `AND instr(f.folded || ' ' || lower(i.name), ?) > 0`).join(' ')}
         ORDER BY length(f.rel) LIMIT ?`,
      )
      .all(...words, MAX_INNER_NAMED) as (Omit<InnerHitDto, 'line' | 'page'> & { itemId: string })[]
  ).map((f) => ({ ...f, line: null, page: null }));
  // 2. The content: the parts holding every word, by relevance, grouped by element
  // (a file inside a project: grouped by that file).
  const groups = new Map<
    string,
    {
      itemId: string;
      rel: string | null;
      hits: { part: string; snippet: string; rowid: number }[];
      count: number;
      rank: number;
    }
  >();
  for (const h of d.textIndex.search(query)) {
    const item = byId.get(h.itemId);
    if (!item) continue;
    const inner = item.kind === 'project' ? splitInnerPart(h.part) : null;
    const key = inner ? `${h.itemId}\0${inner.rel}` : h.itemId;
    const g = groups.get(key) ?? {
      itemId: h.itemId,
      rel: inner?.rel ?? null,
      hits: [],
      count: 0,
      rank: h.rank,
    };
    g.count++;
    if (g.hits.length < HITS_PER_ITEM)
      g.hits.push({ part: inner ? inner.page : h.part, snippet: h.snippet, rowid: h.rowid });
    groups.set(key, g);
  }
  // A PDF's pages in their order (the most relevant first is kept for the first extract).
  for (const g of groups.values()) {
    const [first, ...rest] = g.hits;
    rest.sort((a, b) => (Number(a.part) || 0) - (Number(b.part) || 0));
    g.hits = first ? [first, ...rest] : [];
  }
  // Names first (most recent), then the files inside the projects by name, then the
  // content (most relevant).
  type Entry = { item: ItemRow; inner: InnerHitDto | null; key: string; byName: boolean };
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const push = (e: Entry) => {
    if (seen.has(e.key) || entries.length >= limit) return;
    seen.add(e.key);
    entries.push(e);
  };
  for (const r of [...byName]
    .map((id) => byId.get(id)!)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
    push({ item: r, inner: null, key: r.id, byName: true });
  for (const f of innerNamed) {
    const item = byId.get(f.itemId);
    if (item) push({ item, inner: innerDto(f), key: `${f.itemId}\0${f.rel}`, byName: true });
  }
  for (const [key, g] of [...groups.entries()].sort((a, b) => a[1].rank - b[1].rank)) {
    const item = byId.get(g.itemId)!;
    if (!g.rel) {
      push({ item, inner: null, key, byName: false });
      continue;
    }
    const f = d.ctx.db
      .prepare(`SELECT rel, name, ext, size FROM ${d.inner} WHERE item_id = ? AND rel = ?`)
      .get(g.itemId, g.rel) as Pick<InnerHitDto, 'rel' | 'name' | 'ext' | 'size'> | undefined;
    if (f) push({ item, inner: innerDto({ ...f, line: null, page: null }), key, byName: false });
  }
  const dtos = new Map(d.dtos([...new Set(entries.map((e) => e.item))]).map((x) => [x.id, x]));
  const results: SearchHitDto[] = entries.map((e) => {
    const g = groups.get(e.key);
    const inner = e.inner;
    if (inner && g?.hits[0]) {
      const first = g.hits[0];
      inner.page = first.part || null;
      if (!first.part) inner.line = d.textIndex.lineOf(first.rowid, query);
    }
    return {
      item: dtos.get(e.item.id)!,
      byName: e.byName,
      hits: (g?.hits ?? []).map((h) => ({ part: h.part, snippet: h.snippet })),
      partCount: g?.count ?? 0,
      inner,
    };
  });
  return {
    query,
    results,
    ms: Math.round((performance.now() - t0) * 10) / 10,
    index: d.textIndex.status(),
  };
}

const innerDto = (f: InnerHitDto): InnerHitDto => ({
  rel: f.rel,
  name: f.name,
  ext: f.ext,
  size: f.size,
  line: f.line,
  page: f.page,
});

/** « page 3 », « diapositive 2 », « src/main.c ». */
export function partLabel(item: Pick<ItemDto, 'ext' | 'kind'>, part: string): string {
  if (!part) return '';
  if (item.kind === 'project') return part;
  if (item.ext === 'pptx') return `diapositive ${part}`;
  return `page ${part}`;
}

/**
 * v0.51.0: the route that opens ONE file inside a project — the project's page,
 * its tree on that file, the reader at its line or page, the words marked.
 */
export function innerRoute(folderId: string, inner: InnerHitDto, query: string): string {
  const q = new URLSearchParams({ f: inner.rel });
  if (inner.line) q.set('line', String(inner.line));
  if (inner.page) q.set('page', inner.page);
  if (query.trim()) q.set('q', query.trim());
  return `/m/coffre/c/${folderId}?${q.toString()}`;
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
  d.ctx.routes.get('/files/:id/matches', (request) => {
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
        // v0.51.0: a file inside a project — « main.py — Cours › GPU › Labos (projet) ».
        if (hit.inner) {
          const at = hit.inner.page
            ? `page ${hit.inner.page}`
            : hit.inner.line
              ? `ligne ${hit.inner.line}`
              : '';
          return {
            id: `${hit.item.id}/${hit.inner.rel}`,
            title: hit.inner.name,
            snippet: first?.snippet,
            hint: [
              `${[...(hit.item.folderPath ?? [])].join(' › ')} (projet)`,
              hit.inner.rel.includes('/') ? hit.inner.rel : '',
              at,
            ]
              .filter(Boolean)
              .join(' · '),
            icon: 'file',
            open: innerRoute(hit.item.folderId!, hit.inner, first ? query : ''),
          };
        }
        const where = first ? partLabel(hit.item, first.part) : '';
        return {
          id: hit.item.id,
          title: hit.item.name,
          snippet: first?.snippet,
          hint: [
            hit.item.folderPath?.join(' › ') ?? 'À ranger',
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
