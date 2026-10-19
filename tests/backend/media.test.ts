import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleFiles } from '@hub/sdk/backend';
import { createTestHub, type TestHub } from '@hub/sdk/testing';
import { fakeModule } from '../helpers/fake-modules';

describe('media URLs', () => {
  let hub: TestHub;
  let files: ModuleFiles;

  beforeEach(async () => {
    hub = await createTestHub({
      modules: [fakeModule('media', { backend: { register: (ctx) => void (files = ctx.files) } })],
    });
  });
  afterEach(async () => {
    await hub.close();
  });

  const get = (url: string, headers: Record<string, string> = {}) =>
    hub.app.inject({ url, headers: { host: '127.0.0.1:4321', ...headers } });

  it('serves a module file without the session token, with Range support', async () => {
    const file = files.dataPath('song.txt');
    writeFileSync(file, '0123456789');
    const url = files.mediaUrl(file);
    expect(url).toMatch(/^\/api\/media\/[^/]+\/song\.txt\?v=\d+$/);

    const full = await get(url);
    expect(full.statusCode).toBe(200);
    expect(full.body).toBe('0123456789');

    const partial = await get(url, { range: 'bytes=2-4' });
    expect(partial.statusCode).toBe(206);
    expect(partial.body).toBe('234');
  });

  it('rejects tampered or forged URLs', async () => {
    const file = files.dataPath('a.txt');
    writeFileSync(file, 'a');
    const url = files.mediaUrl(file);
    const forged = url.replace(/\.[A-Za-z0-9_-]+\//, '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/');
    expect((await get(forged)).statusCode).toBe(404);
  });

  it('refuses to sign files outside the hub folders', () => {
    expect(() => files.mediaUrl(path.join(tmpdir(), '..', 'etc', 'passwd'))).toThrow(
      /hors des dossiers/,
    );
  });

  it('exposes the module assets folder and embedded binaries', async () => {
    expect(files.assetsDir).toBe(path.resolve(import.meta.dirname, '../../modules/media/assets'));
    expect(() => files.assetPath('..', '..', 'x')).toThrow(/hors du dossier/);
  });
});
