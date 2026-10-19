import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHub, type TestHub } from '@hub/sdk/testing';
import type { SystemInfo } from '../../backend/server';

describe('backend server', () => {
  let hub: TestHub;

  beforeEach(async () => {
    hub = await createTestHub({ modules: [] });
  });

  afterEach(async () => {
    await hub.close();
  });

  it('reports system information with working SQLite and FFmpeg', async () => {
    const { status, body } = await hub.request<SystemInfo>('GET', '/api/core/system');
    expect(status).toBe(200);
    expect(body.dataDir).toBe(hub.dataDir);
    expect(body.sqliteVersion).toMatch(/^3\./);
    expect(body.ffmpegVersion).toMatch(/^ffmpeg version/);
    expect(body.ffprobeVersion).toMatch(/^ffprobe version/);
  });

  it('stores the database in the data directory', () => {
    expect(hub.hub.handle.file).toBe(path.join(hub.dataDir, 'hub.db'));
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const { status } = await hub.request('GET', '/api/modules/nope/anything');
    expect(status).toBe(404);
  });
});
