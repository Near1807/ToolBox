import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNullHost } from '../../backend/core/host';
import { TOKEN_HEADER } from '../../backend/core/security';
import { buildServer, type SystemInfo } from '../../backend/server';

const TOKEN = 'c'.repeat(64);

describe('backend server', () => {
  let dataDir: string;
  let server: ReturnType<typeof buildServer>;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'toolbox-server-'));
    server = buildServer({ dataDir, token: TOKEN, appVersion: '9.9.9', host: createNullHost() });
    server.setPort(1234);
  });

  afterEach(async () => {
    await server.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reports system information with working SQLite and FFmpeg', async () => {
    const res = await server.app.inject({
      url: '/api/core/system',
      headers: { host: '127.0.0.1:1234', [TOKEN_HEADER]: TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const info = res.json<SystemInfo>();
    expect(info.appVersion).toBe('9.9.9');
    expect(info.dataDir).toBe(dataDir);
    expect(info.sqliteVersion).toMatch(/^3\./);
    expect(info.ffmpegVersion).toMatch(/^ffmpeg version/);
    expect(info.ffprobeVersion).toMatch(/^ffprobe version/);
  });

  it('stores the database in the data directory', () => {
    expect(server.db.name).toBe(path.join(dataDir, 'hub.db'));
  });
});
