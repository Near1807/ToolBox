// v0.47.0 (ADR 0063): restore ToolBox from a copy of its base — an older base
// (its migrations run after), a newer one refused, the current base saved
// first, replaced only at the restart, a failure at the restart → the base of
// before comes back by itself.
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, type TestHub } from '@hub/sdk/testing';
import type { Migration, ModuleContext } from '@hub/sdk/core';

const V1: Migration = {
  version: 1,
  description: 'notes',
  up: 'CREATE TABLE notes__items (id TEXT PRIMARY KEY, text TEXT NOT NULL, deleted_at TEXT)',
};
const V2: Migration = {
  version: 2,
  description: 'a column',
  up: 'ALTER TABLE notes__items ADD COLUMN done INTEGER NOT NULL DEFAULT 0',
};
const notes = (migrations: Migration[]) => ({
  folder: 'notes',
  manifest: {
    id: 'notes',
    name: 'Notes',
    description: 'x',
    version: '1.0.0',
    section: 'Outils',
    icon: 'x',
  },
  backend: {
    migrations,
    register(ctx: ModuleContext) {
      ctx.routes.post('/items', (request) => {
        const b = request.body as { id: string; text: string };
        ctx.db
          .prepare(`INSERT INTO ${ctx.db.table('items')} (id, text) VALUES (?, ?)`)
          .run(b.id, b.text);
        return { ok: true };
      });
      ctx.routes.get('/items', () =>
        ctx.db.prepare(`SELECT * FROM ${ctx.db.table('items')} ORDER BY id`).all(),
      );
    },
  },
});

let hub: TestHub | null = null;
afterEach(async () => {
  await hub?.close();
  hub = null;
});
const ok = async <T>(method: string, url: string, body?: unknown) => {
  const r = await hub!.request<T>(method, url, body);
  if (r.status >= 400) throw new Error(`${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
/** A copy of a hub's base, as a backup on the disk would be. */
function copyOf(h: TestHub, name: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'copie-')), name);
  h.hub.handle.db.prepare('VACUUM INTO ?').run(file);
  return file;
}
const open = async (dataDir: string, migrations: Migration[]) =>
  createTestHub({ loadExamples: false, dataDir, modules: [notes(migrations)] });

interface Preview {
  appVersion: string | null;
  modules: { scope: string; name: string; version: number; items: number }[];
  refused: string | null;
}

describe('restaurer ToolBox depuis une sauvegarde', () => {
  it('une base plus ancienne : aperçu, sauvegarde d’abord, remplacée au redémarrage, migrations ensuite', async () => {
    // The « old ToolBox »: notes v1, two notes.
    const oldDir = mkdtempSync(path.join(tmpdir(), 'old-'));
    hub = await open(oldDir, [V1]);
    await ok('POST', '/api/modules/notes/items', { id: 'a', text: 'ancienne A' });
    await ok('POST', '/api/modules/notes/items', { id: 'b', text: 'ancienne B' });
    const backup = copyOf(hub, 'hub.db');
    await hub.close();
    // Today's ToolBox: notes v2, other data.
    const dir = mkdtempSync(path.join(tmpdir(), 'now-'));
    hub = await open(dir, [V1, V2]);
    await ok('POST', '/api/modules/notes/items', { id: 'z', text: 'actuelle' });
    const preview = await ok<Preview>('POST', '/api/core/restore/preview', { file: backup });
    expect(preview.refused).toBeNull();
    expect(preview.appVersion).toBe('0.0.0-test');
    expect(preview.modules.find((m) => m.scope === 'notes')).toEqual({
      scope: 'notes',
      name: 'Notes',
      version: 1,
      items: 2,
    });
    expect((await hub.request('POST', '/api/core/restore/stage', { file: backup })).status).toBe(
      400,
    );
    await ok('POST', '/api/core/restore/stage', { file: backup, confirm: true });
    // Nothing replaced while ToolBox runs; the current base saved.
    expect(
      (await ok<{ id: string }[]>('GET', '/api/modules/notes/items')).map((n) => n.id),
    ).toEqual(['z']);
    expect(
      readdirSync(path.join(dir, 'backups')).some((f) => f.includes('avant-restauration')),
    ).toBe(true);
    await hub.close({ keepData: true });
    // The restart: the copy, brought up to date (v2), the result said.
    hub = await open(dir, [V1, V2]);
    const items = await ok<{ id: string; done: number }[]>('GET', '/api/modules/notes/items');
    expect(items).toEqual([
      { id: 'a', text: 'ancienne A', deleted_at: null, done: 0 },
      { id: 'b', text: 'ancienne B', deleted_at: null, done: 0 },
    ]);
    const status = await ok<{ pending: unknown; result: { ok: boolean } }>(
      'GET',
      '/api/core/restore',
    );
    expect(status.pending).toBeNull();
    expect(status.result).toMatchObject({ ok: true, source: backup });
    expect(existsSync(path.join(dir, 'restore', 'before.db'))).toBe(false);
  });

  it('une base plus récente : refusée, et expliqué', async () => {
    const newDir = mkdtempSync(path.join(tmpdir(), 'new-'));
    hub = await open(newDir, [
      V1,
      V2,
      { version: 3, description: 'v3', up: 'CREATE TABLE notes__x (id TEXT)' },
    ]);
    const newer = copyOf(hub, 'hub.db');
    await hub.close();
    hub = await open(mkdtempSync(path.join(tmpdir(), 'now-')), [V1, V2]);
    const p = await ok<Preview>('POST', '/api/core/restore/preview', { file: newer });
    expect(p.refused).toMatch(/plus récent \(Notes v3 > v2\)/);
    expect(
      (await hub.request('POST', '/api/core/restore/stage', { file: newer, confirm: true })).status,
    ).toBe(409);
    // A higher app version too.
    const db = new Database(newer);
    db.prepare("UPDATE core__meta SET value = '9.0.0' WHERE key = 'app_version'").run();
    db.close();
    expect(
      (await ok<Preview>('POST', '/api/core/restore/preview', { file: newer })).refused,
    ).toMatch(/ToolBox 9\.0\.0, plus récent/);
    // Not a base of ToolBox.
    const other = path.join(mkdtempSync(path.join(tmpdir(), 'x-')), 'autre.db');
    new Database(other).exec('CREATE TABLE t (x)');
    expect((await ok<Preview>('POST', '/api/core/restore/preview', { file: other })).refused).toBe(
      'Ce n’est pas une base de ToolBox',
    );
  });

  it('échec au redémarrage (une migration échoue) : la base d’avant revient toute seule', async () => {
    const oldDir = mkdtempSync(path.join(tmpdir(), 'old-'));
    hub = await open(oldDir, [V1]);
    await ok('POST', '/api/modules/notes/items', { id: 'a', text: 'ancienne' });
    const broken = copyOf(hub, 'hub.db');
    await hub.close();
    // A copy whose table is gone: migration v2 cannot run on it.
    const db = new Database(broken);
    db.exec('DROP TABLE notes__items');
    db.close();
    const dir = mkdtempSync(path.join(tmpdir(), 'now-'));
    hub = await open(dir, [V1, V2]);
    await ok('POST', '/api/modules/notes/items', { id: 'z', text: 'actuelle' });
    await ok('POST', '/api/core/restore/stage', { file: broken, confirm: true });
    await hub.close({ keepData: true });
    hub = await open(dir, [V1, V2]);
    expect(
      (await ok<{ id: string }[]>('GET', '/api/modules/notes/items')).map((n) => n.id),
    ).toEqual(['z']);
    const status = await ok<{ result: { ok: boolean; reason: string } }>(
      'GET',
      '/api/core/restore',
    );
    expect(status.result.ok).toBe(false);
    expect(status.result.reason).toMatch(/notes/);
    // The module is not left disabled by the attempt (the base of before is back as it was).
    const modules = await ok<{ id: string; status: string }[]>('GET', '/api/core/modules');
    expect(modules.find((m) => m.id === 'notes')?.status).toBe('loaded');
  });

  it('« Annuler » avant le redémarrage : rien ne change', async () => {
    const oldDir = mkdtempSync(path.join(tmpdir(), 'old-'));
    hub = await open(oldDir, [V1]);
    const backup = copyOf(hub, 'hub.db');
    await hub.close();
    const dir = mkdtempSync(path.join(tmpdir(), 'now-'));
    hub = await open(dir, [V1, V2]);
    await ok('POST', '/api/modules/notes/items', { id: 'z', text: 'actuelle' });
    await ok('POST', '/api/core/restore/stage', { file: backup, confirm: true });
    await ok('POST', '/api/core/restore/cancel', {});
    await hub.close({ keepData: true });
    hub = await open(dir, [V1, V2]);
    expect(
      (await ok<{ id: string }[]>('GET', '/api/modules/notes/items')).map((n) => n.id),
    ).toEqual(['z']);
    expect((await ok<{ result: unknown }>('GET', '/api/core/restore')).result).toBeNull();
  });
});
