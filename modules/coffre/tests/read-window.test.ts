// v0.47.0 B: « Lire en plein écran » — a reading window of its own, asked from
// the desktop host (several at once); none without a desktop host (a tab
// instead); never for an element in the Recycle Bin; never another module's route.
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost } from '@hub/sdk/testing';
import { API, deposit, diskWorld, ok, type DiskWorld } from './disk-helpers';

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

describe('fenêtre de lecture', () => {
  it('ouverte par l’hôte, plusieurs à la fois, titre = nom ; refusée depuis la corbeille', async () => {
    const opened: { route: string; title: string }[] = [];
    w = await diskWorld({
      host: createTestHost({
        openWindow: (route, o) => void opened.push({ route, title: o.title }),
      }),
    });
    const [a, b] = await deposit(w, { 'synthese.md': '# Titre', 'cours.pdf': '%PDF' });
    const r1 = await ok<{ opened: boolean; route: string }>(
      w,
      'POST',
      `${API}/items/${a!.id}/read-window`,
    );
    await ok(w, 'POST', `${API}/items/${b!.id}/read-window`);
    expect(r1).toEqual({ opened: true, route: `/w/m/coffre/lire/${a!.id}` });
    expect(opened).toEqual([
      { route: `/m/coffre/lire/${a!.id}`, title: 'synthese.md' },
      { route: `/m/coffre/lire/${b!.id}`, title: 'cours.pdf' },
    ]);
    await ok(w, 'DELETE', `${API}/items/${b!.id}`);
    expect((await w.hub.request('POST', `${API}/items/${b!.id}/read-window`)).status).toBe(409);
  });

  it('sans hôte de bureau : rien d’ouvert, la page propose un onglet', async () => {
    w = await diskWorld();
    const [a] = await deposit(w, { 'n.txt': 'texte' });
    const r = await ok<{ opened: boolean }>(w, 'POST', `${API}/items/${a!.id}/read-window`);
    expect(r.opened).toBe(false);
  });
});
