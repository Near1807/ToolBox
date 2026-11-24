// v0.48.0 (Expérimental): the map of the contexts — a radial tree, computed
// (no physics): the same tree always gives the same picture, nothing
// « dances », and adding a context only opens a little room among its
// siblings. Each context gets an angular sector in proportion to its leaves
// (so a big branch gets more room), its depth gives its ring; each ring is
// far enough for two neighbours on it never to overlap.
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
/** The margin between two neighbouring nodes of a ring (their radii apart). */
const LEAF_GAP = 16;
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
  const allLeaves = roots.reduce((sum, r) => sum + (leaves.get(r.id) ?? 1), 0) || 1;

  // 1. The angles: each context a sector in proportion to its leaves (radii come after).
  const placed: { c: MapInput; depth: number; angle: number; total: number }[] = [];
  const place = (c: MapInput, depth: number, from: number, to: number) => {
    placed.push({ c, depth, angle: (from + to) / 2, total: totals.get(c.id) ?? c.count });
    const list = kids.get(c.id) ?? [];
    const sum = list.reduce((acc, k) => acc + (leaves.get(k.id) ?? 1), 0) || 1;
    let at = from;
    for (const k of list) {
      const share = ((to - from) * (leaves.get(k.id) ?? 1)) / sum;
      place(k, depth + 1, at, at + share);
      at += share;
    }
  };
  // From the top (-90°), clockwise.
  let start = -Math.PI / 2;
  for (const r of roots) {
    const share = (2 * Math.PI * (leaves.get(r.id) ?? 1)) / allLeaves;
    place(r, 1, start, start + share);
    start += share;
  }

  // 2. The rings: each one far enough for two neighbours on it never to overlap
  // (their chord at least their two radii and a margin), and a ring further than the last.
  const lone = roots.length === 1;
  const radii: number[] = [0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const ring = placed.filter((p) => p.depth === depth).sort((x, y) => x.angle - y.angle);
    let need = lone && depth === 1 ? 0 : (radii[depth - 1] ?? 0) + RING;
    if (ring.length > 1 && !(lone && depth === 1))
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        let delta = b.angle - a.angle;
        if (delta <= 0) delta += 2 * Math.PI;
        if (delta >= Math.PI) continue;
        const gap = radiusOf(a.total) + radiusOf(b.total) + LEAF_GAP / 2;
        need = Math.max(need, gap / (2 * Math.sin(delta / 2)));
      }
    radii[depth] = Math.ceil(need);
  }

  // 3. The positions.
  const nodes: MapNode[] = placed.map((p) => {
    const radius = radii[p.depth] ?? p.depth * RING;
    return {
      id: p.c.id,
      parentId: p.c.parentId && ids.has(p.c.parentId) ? p.c.parentId : null,
      name: p.c.name,
      depth: p.depth,
      x: Math.round(Math.cos(p.angle) * radius * 10) / 10,
      y: Math.round(Math.sin(p.angle) * radius * 10) / 10,
      r: radiusOf(p.total),
      total: p.total,
      angle: p.angle,
    };
  });

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
