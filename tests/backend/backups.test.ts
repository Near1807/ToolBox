import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import { createTestHub, createTestHost, type TestHub } from '@hub/sdk/testing';
import { fakeModule } from '../helpers/fake-modules';

function zipEntries(file: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: false, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const names: string[] = [];
      zip.on('entry', (entry: yauzl.Entry) => names.push(entry.fileName));
      zip.on('end', () => resolve(names.sort()));
      zip.on('error', reject);
    });
  });
}

describe('backup export', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub.close();
  });

  it('exports hub.db and module files into a zip chosen by the user', async () => {
    let target = '';
    hub = await createTestHub({
      modules: [fakeModule('library')],
      host: createTestHost({ selectSaveFile: async () => target }),
    });
    target = path.join(hub.dataDir, 'export.zip');
    mkdirSync(path.join(hub.dataDir, 'modules', 'library', 'covers'), { recursive: true });
    writeFileSync(path.join(hub.dataDir, 'modules', 'library', 'covers', 'a.png'), 'png');

    const { status, body } = await hub.request<{ cancelled: boolean; fileCount: number }>(
      'POST',
      '/api/core/backups/export',
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ cancelled: false, fileCount: 2 });
    expect(await zipEntries(target)).toEqual([
      'hub.db',
      'modules/library/covers/a.png',
      'toolbox-sauvegarde.json',
    ]);
  });

  it('does nothing when the save dialog is cancelled', async () => {
    hub = await createTestHub({
      modules: [],
      host: createTestHost({ selectSaveFile: async () => null }),
    });
    const { body } = await hub.request('POST', '/api/core/backups/export');
    expect(body).toEqual({ cancelled: true });
  });
});
