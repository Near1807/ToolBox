// v0.48.0 C: the map's layout (pure) — stable (the same tree, the same
// picture), never overlapping neighbours, fast with hundreds of folders.
import { describe, expect, it } from 'vitest';
import { fitView, layoutMap, nodeAt, pathIds, type MapInput } from '../frontend/map-layout';

function bigTree(n: number): MapInput[] {
  const out: MapInput[] = [];
  let i = 0;
  const add = (parentId: string | null, depth: number) => {
    if (i >= n) return;
    const id = `c${i++}`;
    out.push({ id, parentId, name: `Dossier ${id}`, sort: null, count: (i * 7) % 13 });
    if (depth < 4) for (let k = 0; k < 4 && i < n; k++) add(id, depth + 1);
  };
  while (i < n) add(null, 1);
  return out;
}

describe('carte des dossiers', () => {
  it('stable : le même arbre donne la même image, quel que soit l’ordre reçu', () => {
    const tree = bigTree(60);
    const a = layoutMap(tree);
    const b = layoutMap([...tree].reverse());
    expect(b.nodes.map((n) => [n.id, n.x, n.y]).sort()).toEqual(
      a.nodes.map((n) => [n.id, n.x, n.y]).sort(),
    );
  });

  it('ajouter un dossier ne déplace pas les autres branches', () => {
    const tree: MapInput[] = [
      { id: 'cours', parentId: null, name: 'Cours', sort: null, count: 2 },
      { id: 'perso', parentId: null, name: 'Perso', sort: null, count: 1 },
      { id: 'thermo', parentId: 'cours', name: 'Thermo', sort: null, count: 5 },
      { id: 'gpu', parentId: 'cours', name: 'GPU', sort: null, count: 1 },
      { id: 'photos', parentId: 'perso', name: 'Photos', sort: null, count: 1 },
    ];
    const before = layoutMap(tree);
    const after = layoutMap([
      ...tree,
      { id: 'labos', parentId: 'thermo', name: 'Labos', sort: null, count: 1 },
    ]);
    // Thermo had one leaf (itself); it still has one (Labos): nothing moves.
    for (const n of before.nodes) {
      const m = after.byId.get(n.id)!;
      expect([m.x, m.y], n.id).toEqual([n.x, n.y]);
    }
  });

  it('taille selon les éléments (descendants compris) ; chemin d’un nœud profond', () => {
    const tree = bigTree(40);
    const l = layoutMap(tree);
    const root = l.byId.get('c0')!;
    const under = tree.filter((c) => isUnder(tree, c.id, 'c0'));
    expect(root.total).toBe(under.reduce((sum, c) => sum + c.count, 0));
    expect(root.r).toBeGreaterThan(l.byId.get(under[under.length - 1]!.id)!.r);
    const deep = l.nodes.find((n) => n.depth === 4)!;
    const p = pathIds(l, deep.id);
    expect(p.size).toBe(4);
    expect(p.has('c0')).toBe(true);
    expect(nodeAt(l, deep.x, deep.y)?.id).toBe(deep.id);
  });

  it('300 dossiers : disposés en quelques millisecondes, sans chevauchement de deux voisins', () => {
    // Regular branches AND a small shallow one (« Cours » and 3 leaves): the case seen on screen.
    const tree = [
      ...bigTree(296),
      { id: 'cours', parentId: null, name: 'Cours', sort: null, count: 0 },
      ...['GPU', 'Réseaux', 'Thermo'].map((name) => ({
        id: name,
        parentId: 'cours',
        name,
        sort: null,
        count: 2,
      })),
    ];
    const t0 = performance.now();
    const l = layoutMap(tree);
    const ms = performance.now() - t0;
    expect(l.nodes).toHaveLength(300);
    expect(ms).toBeLessThan(50);
    expect(ms).toBeLessThan(50);
    // Neighbours on the same ring: their centres at least their radii apart.
    let overlaps = 0;
    const byDepth = new Map<number, typeof l.nodes>();
    for (const n of l.nodes) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]);
    for (const ring of byDepth.values()) {
      const sorted = [...ring].sort((a, b) => a.angle - b.angle);
      for (let i = 0; i < sorted.length && sorted.length > 1; i++) {
        const a = sorted[i]!;
        const b = sorted[(i + 1) % sorted.length]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
    const v = fitView(l.box, 1000, 640);
    expect(v.k).toBeGreaterThan(0);
    console.info(`carte : 300 dossiers disposés en ${ms.toFixed(2)} ms`);
  });
});

function isUnder(tree: MapInput[], id: string, ancestor: string): boolean {
  for (let c = tree.find((x) => x.id === id); c; c = tree.find((x) => x.id === c!.parentId))
    if (c.id === ancestor) return true;
  return false;
}
