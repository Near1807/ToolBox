import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '@hub/sdk/backend';
import type { ModuleInfo } from '@hub/sdk/manifest';
import { createTestHub, type TestHub } from '@hub/sdk/testing';
import { fakeModule } from '../helpers/fake-modules';

const hubs: TestHub[] = [];
async function start(...args: Parameters<typeof createTestHub>) {
  const hub = await createTestHub(...args);
  hubs.push(hub);
  return hub;
}
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close().catch(() => {});
});

async function modules(hub: TestHub): Promise<Record<string, ModuleInfo>> {
  const { body } = await hub.request<ModuleInfo[]>('GET', '/api/core/modules');
  return Object.fromEntries(body.map((m) => [m.id, m]));
}

describe('module loader', () => {
  it('mounts module routes under /api/modules/<id>/', async () => {
    const hub = await start({
      modules: [
        fakeModule('alpha', {
          backend: { register: (ctx) => ctx.routes.get('/ping', () => ({ pong: ctx.id })) },
        }),
      ],
    });
    const { body } = await hub.request('GET', '/api/modules/alpha/ping');
    expect(body).toEqual({ pong: 'alpha' });
  });

  it('isolates a module whose register() throws', async () => {
    const hub = await start({
      modules: [
        fakeModule('broken', {
          backend: {
            register: (ctx) => {
              ctx.routes.get('/x', () => 'never');
              throw new Error('boom');
            },
          },
        }),
        fakeModule('healthy', {
          backend: { register: (ctx) => ctx.routes.get('/ok', () => ({ ok: true })) },
        }),
      ],
    });
    const state = await modules(hub);
    expect(state.broken?.status).toBe('failed');
    expect(state.broken?.error).toMatch(/boom/);
    expect(state.healthy?.status).toBe('loaded');
    expect((await hub.request('GET', '/api/modules/broken/x')).status).toBe(404);
    expect((await hub.request('GET', '/api/modules/healthy/ok')).status).toBe(200);
  });

  it('refuses a module whose dependency is missing, with a clear message', async () => {
    const hub = await start({
      modules: [fakeModule('consumer', { manifest: { dependsOn: { modules: ['provider'] } } })],
    });
    const state = await modules(hub);
    expect(state.consumer?.status).toBe('missing-dependencies');
    expect(state.consumer?.error).toMatch(/« provider » est absent/);
  });

  it('reports invalid manifests without stopping the hub', async () => {
    const hub = await start({
      modules: [fakeModule('bad', { manifest: { version: 'one' } }), fakeModule('good')],
    });
    const state = await modules(hub);
    expect(state.bad?.status).toBe('failed');
    expect(state.good?.status).toBe('loaded');
  });

  it('shares services between modules, only when declared', async () => {
    const hub = await start({
      modules: [
        fakeModule('consumer', {
          manifest: { dependsOn: { services: ['counter'] } },
          backend: {
            register: (ctx) => {
              const counter = ctx.services.get<{ next(): number }>('counter');
              ctx.routes.get('/next', () => ({ value: counter.next() }));
              expect(() => ctx.services.get('undeclared')).toThrow(/non déclaré/);
            },
          },
        }),
        fakeModule('provider', {
          manifest: { provides: { services: ['counter'] } },
          backend: {
            register: (ctx) => {
              let n = 0;
              ctx.services.provide('counter', { next: () => ++n });
            },
          },
        }),
      ],
    });
    expect((await hub.request('GET', '/api/modules/consumer/next')).body).toEqual({ value: 1 });
  });

  it('marks consumers unavailable when their provider fails', async () => {
    const hub = await start({
      modules: [
        fakeModule('provider', {
          manifest: { provides: { services: ['svc'] } },
          backend: {
            register: () => {
              throw new Error('provider down');
            },
          },
        }),
        fakeModule('consumer', { manifest: { dependsOn: { services: ['svc'] } } }),
      ],
    });
    const state = await modules(hub);
    expect(state.provider?.status).toBe('failed');
    expect(state.consumer?.status).toBe('missing-dependencies');
  });

  it('turns route errors into JSON errors without crashing', async () => {
    const hub = await start({
      modules: [
        fakeModule('errors', {
          backend: {
            register: (ctx) => {
              ctx.routes.get('/crash', () => {
                throw new Error('kaboom');
              });
              ctx.routes.get('/teapot', () => {
                throw new HttpError(418, 'Je suis une théière');
              });
            },
          },
        }),
      ],
    });
    const crash = await hub.request<{ error: string }>('GET', '/api/modules/errors/crash');
    expect(crash.status).toBe(500);
    expect(crash.body.error).toMatch(/kaboom/);
    const teapot = await hub.request<{ error: string }>('GET', '/api/modules/errors/teapot');
    expect(teapot).toEqual({ status: 418, body: { error: 'Je suis une théière' } });
  });

  it('lets modules talk through namespaced events', async () => {
    const received: unknown[] = [];
    const hub = await start({
      modules: [
        fakeModule('listener', {
          backend: {
            register: (ctx) => void ctx.events.on('emitter:hello', (p) => void received.push(p)),
          },
        }),
        fakeModule('emitter', {
          backend: {
            register: (ctx) => {
              ctx.routes.post('/say', () => {
                ctx.events.emit('hello', { from: ctx.id });
                return { ok: true };
              });
              expect(() => ctx.events.emit('other:hello')).toThrow(/préfixe/);
            },
          },
        }),
      ],
    });
    await hub.request('POST', '/api/modules/emitter/say');
    expect(received).toEqual([{ from: 'emitter' }]);
  });

  it('refuses schema changes outside migrations at runtime', async () => {
    const hub = await start({
      modules: [
        fakeModule('sneaky', {
          backend: {
            register: (ctx) =>
              ctx.routes.post('/drop', () => ctx.db.prepare('DROP TABLE core__settings').run()),
          },
        }),
      ],
    });
    const response = await hub.request<{ error: string }>('POST', '/api/modules/sneaky/drop');
    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/migration/);
  });

  it('keeps module files inside their own folder', async () => {
    let files: { dataDir: string; dataPath(...s: string[]): string } | undefined;
    const hub = await start({
      modules: [fakeModule('files', { backend: { register: (ctx) => void (files = ctx.files) } })],
    });
    expect(files!.dataDir).toBe(path.join(hub.dataDir, 'modules', 'files'));
    expect(files!.dataPath('covers', 'a.png')).toBe(path.join(files!.dataDir, 'covers', 'a.png'));
    expect(() => files!.dataPath('..', 'other', 'x')).toThrow(/hors du dossier/);
  });

  it('skips example modules unless asked', async () => {
    const hub = await start({
      modules: [fakeModule('_demo'.slice(1)), { ...fakeModule('demo2'), folder: '_demo2' }],
      loadExamples: false,
    });
    expect(Object.keys(await modules(hub))).toEqual(['demo']);
  });

  it('can disable and re-enable a module (applied at next start)', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'toolbox-enable-'));
    const first = await createTestHub({ dataDir, modules: [fakeModule('toggle')] });
    await first.request('PUT', '/api/core/modules/toggle/enabled', { enabled: false });
    await first.close({ keepData: true });

    const second = await start({ dataDir, modules: [fakeModule('toggle')] });
    expect((await modules(second)).toggle?.status).toBe('disabled');
  });
});

describe('migrations with automatic backups', () => {
  const table = (version: number) => ({
    version,
    description: `v${version}`,
    up: `CREATE TABLE notes__v${version} (x); INSERT INTO notes__v${version} VALUES (${version});`,
  });

  it('backs up hub.db before migrating and restores it when a migration fails', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'toolbox-migrate-'));

    // First run: version 1 of the module, with some user data.
    const first = await createTestHub({
      dataDir,
      modules: [fakeModule('notes', { backend: { migrations: [table(1)] } })],
    });
    expect((await modules(first)).notes?.status).toBe('loaded');
    await first.close({ keepData: true });

    // Second run: a new version whose migration 3 fails after 2 succeeded.
    const second = await createTestHub({
      dataDir,
      modules: [
        fakeModule('notes', {
          backend: {
            migrations: [
              table(1),
              table(2),
              { version: 3, description: 'broken', up: 'THIS IS NOT SQL' },
            ],
          },
        }),
        fakeModule('other'),
      ],
    });
    const state = await modules(second);
    expect(state.notes?.status).toBe('failed');
    expect(state.notes?.disabled).toBe(true);
    expect(state.notes?.error).toMatch(/migration 3.*a échoué/);
    expect(state.other?.status).toBe('loaded');

    // Restored: v2 is rolled back too, original data is intact.
    const db = second.hub.handle.db;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'notes__%'").all();
    expect(tables).toEqual([{ name: 'notes__v1' }]);
    expect(db.prepare('SELECT x FROM notes__v1').get()).toEqual({ x: 1 });

    // A timestamped backup exists in userData/backups.
    expect(
      readdirSync(path.join(dataDir, 'backups')).some((f) => f.includes('avant-notes-v3')),
    ).toBe(true);
    await second.close({ keepData: true });

    // Third run: the module stays disabled until re-enabled.
    const third = await start({
      dataDir,
      modules: [fakeModule('notes', { backend: { migrations: [table(1)] } })],
    });
    expect((await modules(third)).notes?.status).toBe('disabled');
  });

  it('keeps only the 10 most recent automatic backups', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'toolbox-rotate-'));
    const migrations = [table(1)];
    // Fresh database: no backup is taken (nothing to protect yet).
    await (await createTestHub({ dataDir, modules: [] })).close({ keepData: true });
    for (let version = 1; version <= 12; version++) {
      migrations[version - 1] = table(version);
      const hub = await createTestHub({
        dataDir,
        modules: [fakeModule('notes', { backend: { migrations: [...migrations] } })],
      });
      await hub.close({ keepData: true });
    }
    const backups = readdirSync(path.join(dataDir, 'backups'));
    expect(backups).toHaveLength(10);
    expect(backups.some((f) => f.includes('avant-notes-v12'))).toBe(true);
    expect(backups.some((f) => f.includes('avant-notes-v1.'))).toBe(false);
  });
});
