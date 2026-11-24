// v0.46.0 I: « Aussi utilisé dans… » (a link, never a copy) and « Retirer la couverture ».
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextDto, ItemDto } from '../shared/types';
import { API, deposit, diskWorld, ok, type DiskWorld } from './disk-helpers';

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

describe('aussi utilisé, couverture', () => {
  it('un élément montré dans un autre contexte sans copie ; retiré ; la couverture retirée', async () => {
    w = await diskWorld();
    const [img] = await deposit(w, { 'schema.png': 'png' });
    const [other] = await deposit(w, { 'x.txt': 'x' }, ['Projets', 'Robot']);
    const robot = other!.contextId!;
    await ok(w, 'POST', `${API}/items/${img!.id}/also`, { contextId: robot });
    const inRobot = await ok<ItemDto[]>(w, 'GET', `${API}/items?context=${robot}`);
    expect(inRobot.map((i) => i.id)).toContain(img!.id);
    expect(readdirSync(path.join(w.hub.dataDir, 'coffre', 'Projets', 'Robot'))).toEqual(['x.txt']);
    await ok(w, 'DELETE', `${API}/items/${img!.id}/also/${robot}`);
    expect((await ok<ItemDto>(w, 'GET', `${API}/items/${img!.id}`)).alsoIn).toEqual([]);

    await ok(w, 'PATCH', `${API}/contexts/${img!.contextId}`, { coverItemId: img!.id });
    const withCover = (await ok<ContextDto[]>(w, 'GET', `${API}/contexts`)).find(
      (c) => c.id === img!.contextId,
    )!;
    expect(withCover.coverItemId).toBe(img!.id);
    await ok(w, 'PATCH', `${API}/contexts/${img!.contextId}`, { coverItemId: null });
    const without = (await ok<ContextDto[]>(w, 'GET', `${API}/contexts`)).find(
      (c) => c.id === img!.contextId,
    )!;
    expect(without.coverItemId).toBeNull();
    // The image itself stays.
    expect((await ok<ItemDto>(w, 'GET', `${API}/items/${img!.id}`)).trashedAt).toBeNull();
  });
});
