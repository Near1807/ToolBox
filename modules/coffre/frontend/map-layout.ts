// v0.48.0 (Expérimental): the map of the contexts — a radial tree, computed
// (no physics): the same tree always gives the same picture, nothing
// « dances », and adding a context only opens a little room among its
// siblings. Each context gets an angular sector in proportion to its leaves
// (so a big branch gets more room), its depth gives its ring; the rings move
// apart when there are many leaves so that two neighbours never overlap.
// Pure (tested), no screen.

export interface MapInput {
  id: string;
  parentId: string | null;
  name: string;
  sort: number | null;
  count: number;
}

export interface MapNode {
  id: string;
  parentId: string | null;
  name: string;
  depth: number;
  x: number;
  y: number;
  /** Its radius on the map (its elements, descendants included). */
  r: number;
  /** Its elements, descendants included. */
  total: number;
  /** Its angle (radians), for the label's side. */
  angle: number;
}

export interface MapLayout {
  nodes: MapNode[];
  byId: Map<string, MapNode>;
  /** The bounding box (labels included, roughly). */
  box: { x: number; y: number; w: number; h: number };
}

/** The distance between two rings, at least. */
export const RING = 130;
/** Two neighbouring leaves on the outer ring: at least this far apart. */
const LEAF_GAP = 30;
const LABEL_ROOM = 120;

/** The size of a node from its number of elements (descendants included). */
export const radiusOf = (total: number) => Math.min(30, 6 + 2.4 * Math.sqrt(total));

const order = (a: MapInput, b: MapInput) =>
  (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER) ||
  a.name.localeCompare(b.name, 'fr') ||
  a.id.localeCompare(b.id);

export function layoutMap(input: readonly MapInput[]): MapLayout {
  const ids = new Set(input.map((c) => c.id));
  const kids = new Map<string | null, MapInput[]>();
  for (const c of input) {
    // A parent that is not there (should not happen): at the root.
    const p = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    const list = kids.get(p) ?? [];
    list.push(c);
    kids.set(p, list);
  }
  for (const list of kids.values()) list.sort(order);

  const leaves = new Map<string, number>();
  const totals = new Map<string, number>();
  let maxDepth = 0;
  const measure = (c: MapInput, depth: number, seen: Set<string>): void => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    maxDepth = Math.max(maxDepth, depth);
    let l = 0;
    let t = c.count;
    for (const k of kids.get(c.id) ?? []) {
      measure(k, depth + 1, seen);
      l += leaves.get(k.id) ?? 0;
      t += totals.get(k.id) ?? 0;
    }
    leaves.set(c.id, Math.max(1, l));
    totals.set(c.id, t);
  };
  const seen = new Set<string>();
  const roots = kids.get(null) ?? [];
  for (const r of roots) measure(r, 1, seen);
  const allLeaves = roots.reduce((s, r) => s + (leaves.get(r.id) ?? 1), 0) || 1;
  // The rings move apart when the outer ring would be crowded.
  const ring = Math.max(RING, (LEAF_GAP * allLeaves) / (2 * Math.PI * Math.max(1, maxDepth)));

  const nodes: MapNode[] = [];
  const place = (c: MapInput, depth: number, from: number, to: number) => {
    const angle = (from + to) / 2;
    // A lone root sits in the middle.
    const radius = roots.length === 1 && depth === 1 ? 0 : depth * ring;
    const total = totals.get(c.id) ?? c.count;
    nodes.push({
      id: c.id,
      parentId: c.parentId && ids.has(c.parentId) ? c.parentId : null,
      name: c.name,
      depth,
      x: Math.round(Math.cos(angle) * radius * 10) / 10,
      y: Math.round(Math.sin(angle) * radius * 10) / 10,
      r: radiusOf(total),
      total,
      angle,
    });
    const list = kids.get(c.id) ?? [];
    const sum = list.reduce((s, k) => s + (leaves.get(k.id) ?? 1), 0) || 1;
    let at = from;
    for (const k of list) {
      const share = ((to - from) * (leaves.get(k.id) ?? 1)) / sum;
      place(k, depth + 1, at, at + share);
      at += share;
    }
  };
  // From the top (-90°), clockwise.
  let at = -Math.PI / 2;
  for (const r of roots) {
    const share = (2 * Math.PI * (leaves.get(r.id) ?? 1)) / allLeaves;
    place(r, 1, at, at + share);
    at += share;
  }

  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r - LABEL_ROOM);
    maxX = Math.max(maxX, n.x + n.r + LABEL_ROOM);
    minY = Math.min(minY, n.y - n.r - 24);
    maxY = Math.max(maxY, n.y + n.r + 24);
  }
  return {
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    box: { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) },
  };
}

/** A context and its ancestors (the path lit by the search). */
export function pathIds(layout: MapLayout, id: string): Set<string> {
  const out = new Set<string>();
  for (
    let n = layout.byId.get(id);
    n && !out.has(n.id);
    n = n.parentId ? layout.byId.get(n.parentId) : undefined
  )
    out.add(n.id);
  return out;
}

/** The view that shows everything in a w × h frame (« tout voir »). */
export function fitView(box: MapLayout['box'], w: number, h: number) {
  const k = Math.min(2, Math.max(0.05, Math.min(w / box.w, h / box.h) * 0.95));
  return {
    k,
    x: w / 2 - (box.x + box.w / 2) * k,
    y: h / 2 - (box.y + box.h / 2) * k,
  };
}

/** The node under a point of the map (its coordinates), the closest, or null. */
export function nodeAt(layout: MapLayout, x: number, y: number, slack = 6): MapNode | null {
  let best: MapNode | null = null;
  let bestD = Infinity;
  for (const n of layout.nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= n.r + slack && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}
