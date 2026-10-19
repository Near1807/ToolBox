import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  applyMigrations,
  assertNotSchemaChange,
  ensureMigrationsTable,
  getAppliedVersion,
  getPendingMigrations,
  MigrationError,
  tablePrefix,
} from '../../backend/core/migrations';

function db() {
  const database = new Database(':memory:');
  ensureMigrationsTable(database);
  return database;
}

describe('migrations', () => {
  it('derives the table prefix from the module id', () => {
    expect(tablePrefix('music-library')).toBe('music_library__');
  });

  it('applies pending migrations once, in order', () => {
    const database = db();
    const migrations = [
      { version: 1, description: 'a', up: 'CREATE TABLE m__a (x)' },
      { version: 2, description: 'b', up: 'CREATE TABLE m__b (x)' },
    ];
    applyMigrations(database, 'm', getPendingMigrations(database, 'm', migrations));
    expect(getAppliedVersion(database, 'm')).toBe(2);
    expect(getPendingMigrations(database, 'm', migrations)).toEqual([]);
  });

  it('refuses tables outside the module prefix and rolls the migration back', () => {
    const database = db();
    const bad = [
      { version: 1, description: 'bad', up: 'CREATE TABLE m__ok (x); CREATE TABLE other (x);' },
    ];
    expect(() => applyMigrations(database, 'm', bad)).toThrow(/hors de son préfixe.*other/);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tables).toEqual([{ name: 'core__migrations' }]);
    expect(getAppliedVersion(database, 'm')).toBe(0);
  });

  it('refuses touching another module’s tables', () => {
    const database = db();
    applyMigrations(database, 'a', [{ version: 1, description: 'a', up: 'CREATE TABLE a__t (x)' }]);
    expect(() =>
      applyMigrations(database, 'b', [{ version: 1, description: 'drop', up: 'DROP TABLE a__t' }]),
    ).toThrow(MigrationError);
  });

  it('rejects badly numbered migrations', () => {
    expect(() =>
      getPendingMigrations(db(), 'm', [{ version: 2, description: 'x', up: '' }]),
    ).toThrow(/mal numérotées/);
  });

  it('refuses to run against a newer schema (downgrade)', () => {
    const database = db();
    applyMigrations(database, 'm', [
      { version: 1, description: 'a', up: 'CREATE TABLE m__a (x)' },
      { version: 2, description: 'b', up: 'CREATE TABLE m__b (x)' },
    ]);
    expect(() =>
      getPendingMigrations(database, 'm', [{ version: 1, description: 'a', up: '' }]),
    ).toThrow(/plus récente/);
  });

  it('supports function migrations with the table() helper', () => {
    const database = db();
    applyMigrations(database, 'my-mod', [
      {
        version: 1,
        description: 'fn',
        up: (m) => m.exec(`CREATE TABLE ${m.table('items')} (x)`),
      },
    ]);
    expect(database.prepare('SELECT COUNT(*) AS n FROM my_mod__items').get()).toEqual({ n: 0 });
  });

  it('forbids schema changes outside migrations', () => {
    expect(() => assertNotSchemaChange('DROP TABLE x')).toThrow(/migration/);
    expect(() => assertNotSchemaChange('  /* c */ alter table x add y')).toThrow(/migration/);
    expect(() => assertNotSchemaChange('SELECT * FROM x')).not.toThrow();
  });
});
