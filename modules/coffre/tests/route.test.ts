// v0.48.0 D: the route picker's logic (pure).
import { describe, expect, it } from 'vitest';
import {
  completeRoute,
  resolveRoute,
  splitRoute,
  subtreeOf,
  suggestRoutes,
  type RouteFolder,
} from '../shared/route';

const tree: RouteFolder[] = [];
const add = (id: string, parentId: string | null, name: string) => {
  const parent = tree.find((c) => c.id === parentId);
  tree.push({ id, parentId, name, path: [...(parent?.path ?? []), name] });
};
add('cours', null, 'Cours');
add('thermo', 'cours', 'Thermo');
add('labos', 'thermo', 'Labos');
add('reseaux', 'cours', 'Réseaux');
add('thermodyn', null, 'Thermodynamique');
add('perso', null, 'Perso');
add('ete', 'perso', 'Été 2026');

describe('sélecteur de route', () => {
  it('séparateurs « / », « › », « \\ » ; segment en cours', () => {
    for (const t of ['Cours/Thermo', 'Cours › Thermo', 'Cours\\Thermo', ' cours /thermo '])
      expect(splitRoute(t).segments.map((s) => s.toLowerCase())).toEqual(['cours', 'thermo']);
    expect(splitRoute('Cours/').trailing).toBe(true);
  });

  it('« cou/the » → « Cours/Thermo » (complétion tolérante, Tab)', () => {
    expect(suggestRoutes('cou/the', tree)[0]!.path).toEqual(['Cours', 'Thermo']);
    expect(completeRoute('cou/the', tree)).toBe('Cours/Thermo');
    // One segment alone: anywhere in the tree, the shallowest closest first.
    const the = suggestRoutes('the', tree).map((s) => s.id);
    expect(the.slice(0, 2).sort()).toEqual(['thermo', 'thermodyn']);
    expect(suggestRoutes('cours/lab', tree)[0]!.id).toBe('labos');
  });

  it('accents et casse ignorés', () => {
    expect(suggestRoutes('reseau', tree)[0]!.id).toBe('reseaux');
    expect(suggestRoutes('ETE', tree)[0]!.id).toBe('ete');
    expect(resolveRoute('cours/RESEAUX', tree).existingId).toBe('reseaux');
  });

  it('« Labos » nouveau : montré « nouveau », créé seulement à la validation (newPath)', () => {
    const r = resolveRoute('Cours/Réseaux/Labos', tree);
    expect(r.segments.map((s) => s.id)).toEqual(['cours', 'reseaux', null]);
    expect(r.existingId).toBeNull();
    expect(r.newPath).toEqual(['Cours', 'Réseaux', 'Labos']);
    expect(r.error).toBeNull();
    // A new segment, then the following ones are new too.
    const deep = resolveRoute('Cours/Semestre 2/Thermo', tree);
    expect(deep.segments.map((s) => s.id)).toEqual(['cours', null, null]);
  });

  it('noms invalides pour Windows signalés', () => {
    expect(resolveRoute('Cours/TP: 1', tree).error).toMatch(/caractère interdit/);
    expect(resolveRoute('Cours/con', tree).error).toMatch(/réservé par Windows/);
    expect(resolveRoute('Cours/fin.', tree).error).toMatch(/point/);
    expect(resolveRoute('', tree).error).toBe('Route vide');
  });

  it('un dossier et ses descendants (exclus de « Déplacer dans… »)', () => {
    expect([...subtreeOf('cours', tree)].sort()).toEqual(['cours', 'labos', 'reseaux', 'thermo']);
  });
});
