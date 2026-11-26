// v0.50.0 (ADR 0067): moving up from a v0.49 base. The migration 8 needs an
// EMPTY Coffre: (a) a v0.49 Coffre emptied by « Réinitialiser le Coffre » →
// the new tables, the disk and the settings kept, the old rules gone; (b) a
// Coffre that is not empty → refused, NOTHING touched (tables, rows, files), the
// module not loaded but not disabled, tried again at the next start; (c) the
// other modules untouched either way.
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleInfo } from '@hub/sdk/manifest';
import { createTestHub, loadModuleFolder } from '@hub/sdk/testing';
import { MIGRATIONS } from '../backend/migrations';
import { diskWorld, type DiskWorld } from './disk-helpers';

let w: DiskWorld | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
});

const NOW = '2026-11-01T10:00:00.000Z';

/** A base as v0.49.0 leaves it: the To-do with a task, the Coffre at its migration 7. */
async function v49Base(fill: (db: Database.Database, dataDir: string) => void): Promise<string> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'coffre-upgrade-'));
  const todo = await createTestHub({
    loadExamples: false,
    dataDir,
    modules: [await loadModuleFolder(path.resolve(__dirname, '..', '..', 'todo'))],
  });
  expect((await todo.request('POST', '/api/modules/todo/tasks', { title: 'Réviser' })).status).toBe(
    200,
  );
  await todo.close({ keepData: true });
  const db = new Database(path.join(dataDir, 'hub.db'));
  const record = db.prepare(
    'INSERT INTO core__migrations (scope, version, description, applied_at) VALUES (?, ?, ?, ?)',
  );
  for (const m of MIGRATIONS.filter((x) => x.version <= 7)) {
    if (typeof m.up !== 'string') throw new Error('v0.49 migrations are SQL');
    db.exec(m.up);
    record.run('coffre', m.version, m.description, NOW);
  }
  // What the reset keeps: the disk, a learned rule (on an old context), a setting.
  db.prepare(
    `INSERT INTO coffre__disks (id, created_at, updated_at, name, rel_root) VALUES ('d1', ?, ?, 'Disque photo', 'ToolBox-Coffre')`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO coffre__rules (id, created_at, updated_at, kind, key, value) VALUES ('r1', ?, ?, 'site', 'moodle.be', 'ctx-old')`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO core__settings (scope, key, value, encrypted, updated_at) VALUES ('coffre', 'downloadsWatch', 'false', 0, ?)`,
  ).run(NOW);
  fill(db, dataDir);
  db.close();
  return dataDir;
}

const tables = (dataDir: string) => {
  const db = new Database(path.join(dataDir, 'hub.db'), { readonly: true });
  const names = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'coffre__%'`)
      .all() as { name: string }[]
  )
    .map((r) => r.name)
    .filter((n) => !n.startsWith('coffre__text_')) // FTS5's own shadow tables
    .sort();
  const rows = Object.fromEntries(
    names.map((n) => [n, db.prepare(`SELECT * FROM ${n}`).all()]),
  ) as Record<string, unknown[]>;
  const todo = db.prepare(`SELECT title FROM todo__tasks WHERE deleted_at IS NULL`).all();
  const setting = db
    .prepare(`SELECT value FROM core__settings WHERE scope = 'coffre' AND key = 'downloadsWatch'`)
    .get();
  const versions = db
    .prepare(`SELECT version FROM core__migrations WHERE scope = 'coffre' ORDER BY version`)
    .all();
  db.close();
  return { names, rows, todo, setting, versions };
};

async function modules(W: DiskWorld): Promise<Record<string, ModuleInfo>> {
  const { body } = await W.hub.request<ModuleInfo[]>('GET', '/api/core/modules');
  return Object.fromEntries(body.map((m) => [m.id, m]));
}

describe('montée de version depuis la v0.49.0 (migration 8)', () => {
  it('(a) un Coffre réinitialisé : nouvelles tables, disque et réglages gardés, règles retirées, To-do intacte', async () => {
    const dataDir = await v49Base((_db, dir) => {
      // What the reset leaves on the PC: the technical folders only (bin, empty « Arrivée »).
      mkdirSync(path.join(dir, 'coffre', '_Corbeille'), { recursive: true });
      mkdirSync(path.join(dir, 'coffre', '_Arrivée'), { recursive: true });
    });
    w = await diskWorld({ dataDir, others: ['todo'] });
    const state = await modules(w);
    expect(state.coffre?.status).toBe('loaded');
    expect(state.todo?.status).toBe('loaded');
    await w.close();
    w = null;
    const t = tables(dataDir);
    for (const name of ['folders', 'items', 'labels', 'label_sets', 'disks', 'rules', 'changes'])
      expect(t.names).toContain(`coffre__${name}`);
    for (const old of ['contexts', 'attributes', 'also', 'imports'])
      expect(t.names).not.toContain(`coffre__${old}`);
    expect(t.rows.coffre__disks).toMatchObject([{ id: 'd1', name: 'Disque photo' }]);
    expect(t.rows.coffre__rules).toEqual([]);
    expect(t.setting).toEqual({ value: 'false' });
    expect(t.todo).toEqual([{ title: 'Réviser' }]);
    // v0.51.0: the migration 9 (additions only) follows.
    expect(t.versions.map((v) => (v as { version: number }).version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    for (const name of ['inner_files', 'inner_copies'])
      expect(t.names).toContain(`coffre__${name}`);
    // The old empty « _Arrivée » removed at start; « _À ranger » the new one.
    expect(readdirSync(path.join(dataDir, 'coffre'))).not.toContain('_Arrivée');
  });

  it('(b) un Coffre non vide : refus, rien n’est touché, module non désactivé, réessayé ensuite ; (c) la To-do intacte', async () => {
    const dataDir = await v49Base((db, dir) => {
      db.prepare(
        `INSERT INTO coffre__contexts (id, created_at, updated_at, name) VALUES ('c1', ?, ?, 'Cours')`,
      ).run(NOW, NOW);
      db.prepare(
        `INSERT INTO coffre__items (id, created_at, updated_at, kind, name, rel_path, context_id) VALUES ('i1', ?, ?, 'file', 'td.pdf', 'Cours/td.pdf', 'c1')`,
      ).run(NOW, NOW);
      mkdirSync(path.join(dir, 'coffre', 'Cours'), { recursive: true });
      writeFileSync(path.join(dir, 'coffre', 'Cours', 'td.pdf'), '%PDF-1.4');
    });
    const before = tables(dataDir);
    w = await diskWorld({ dataDir, others: ['todo'] });
    let state = await modules(w);
    expect(state.coffre?.status).toBe('failed');
    expect(state.coffre?.disabled).toBe(false);
    expect(state.coffre?.error).toMatch(/Le Coffre n’est pas vide \(2 ligne\(s\) dans la base/);
    expect(state.coffre?.error).toMatch(/Réinitialiser le Coffre/);
    expect(state.todo?.status).toBe('loaded');
    expect((await w.hub.request('GET', '/api/modules/coffre/home')).status).toBe(404);
    await w.close();
    w = null;
    // Nothing touched: same tables, same rows, same files, still at version 7.
    const after = tables(dataDir);
    expect(after).toEqual(before);
    expect(after.versions).toHaveLength(7);
    expect(readdirSync(path.join(dataDir, 'coffre', 'Cours'))).toEqual(['td.pdf']);

    // Emptied (as « Réinitialiser le Coffre » does): the next start takes it.
    const db = new Database(path.join(dataDir, 'hub.db'));
    db.exec(
      `UPDATE coffre__items SET deleted_at = '${NOW}'; UPDATE coffre__contexts SET deleted_at = '${NOW}';`,
    );
    db.close();
    const { rmSync } = await import('node:fs');
    rmSync(path.join(dataDir, 'coffre', 'Cours'), { recursive: true });
    w = await diskWorld({ dataDir, others: ['todo'] });
    state = await modules(w);
    expect(state.coffre?.status).toBe('loaded');
    expect((await w.hub.request('GET', '/api/modules/coffre/home')).status).toBe(200);
    expect(tables(dataDir).todo).toEqual([{ title: 'Réviser' }]);
  });
});
