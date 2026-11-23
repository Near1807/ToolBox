// v0.46.0 (ADR 0054): a module may let the UI show files of a folder the user
// chose outside ToolBox (ctx.files.allowMediaRoot), withdrawn when it goes
// away; and the database's consistent copy to a path a module chose.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { snapshotDatabase } from '../backend/core/backups';
import { createModuleFiles } from '../backend/core/files';
import { createNullHost } from '../backend/core/host';
import { MediaSigner, mediaTokenFromUrl } from '../backend/core/media';

describe('ctx.files.allowMediaRoot', () => {
  it('serves the folder while it is allowed, refuses it after', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'toolbox-ext-'));
    const disk = path.join(root, 'disque');
    mkdirSync(disk);
    const file = path.join(disk, 'cours.pdf');
    writeFileSync(file, '%PDF');
    const extra = new Set<string>();
    const signer = new MediaSigner(() => [path.join(root, 'userData'), ...extra]);
    const files = createModuleFiles({
      moduleId: 'm',
      modulesDataDir: path.join(root, 'userData', 'modules'),
      assetsDir: path.join(root, 'assets'),
      getOutputRoot: () => path.join(root, 'out'),
      host: createNullHost(),
      mediaUrl: (p) => signer.url(p),
      allowMediaRoot: (dir) => {
        extra.add(dir);
        return () => extra.delete(dir);
      },
    });
    expect(() => files.mediaUrl(file)).toThrow(/hors des dossiers autorisés/);
    expect(() => files.allowMediaRoot!('relatif')).toThrow(/absolu/);
    const withdraw = files.allowMediaRoot!(disk);
    const url = files.mediaUrl(file);
    const token = mediaTokenFromUrl(url)!;
    expect(signer.resolve(token)).toBe(path.resolve(file));
    withdraw();
    // Withdrawn (disk unplugged): the same URL no longer opens anything.
    expect(signer.resolve(token)).toBeNull();
  });
});

describe('ctx.db.snapshotTo', () => {
  it('writes a consistent copy of the database to the path given', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'toolbox-snap-'));
    const db = new Database(path.join(root, 'hub.db'));
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('a'), ('b');");
    const target = path.join(root, 'disque', '_ToolBox', 'Base', 'hub.db');
    snapshotDatabase(db, target);
    const copy = new Database(target, { readonly: true });
    expect(copy.prepare('SELECT v FROM t ORDER BY v').all()).toEqual([{ v: 'a' }, { v: 'b' }]);
    copy.close();
    db.close();
  });
});
