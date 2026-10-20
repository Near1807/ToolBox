import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleContext, OutputRecord } from '@hub/sdk/backend';
import { createTestHost, createTestHub, type TestHub } from '@hub/sdk/testing';
import { fakeModule } from '../helpers/fake-modules';

const hubs: TestHub[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close().catch(() => {});
});

/** Two modules writing files; `removed` collects what their handlers received. */
async function start() {
  const contexts: Record<string, ModuleContext> = {};
  const removed: { module: string; refs: string[]; reason: string }[] = [];
  const trashed: string[] = [];
  const module = (id: string) =>
    fakeModule(id, {
      backend: {
        register: (ctx) => {
          contexts[id] = ctx;
          ctx.outputs.onRemoved((records, reason) =>
            removed.push({ module: id, refs: records.map((r) => r.ref), reason }),
          );
        },
      },
    });
  const hub = await createTestHub({
    modules: [module('alpha'), module('beta')],
    host: createTestHost({
      trashItem: async (file) => {
        trashed.push(file);
        rmSync(file, { force: true });
      },
    }),
  });
  hubs.push(hub);
  const write = (ctx: ModuleContext, name: string) => {
    const file = path.join(ctx.files.outputDir(), name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'x');
    return file;
  };
  return { hub, contexts, removed, trashed, write };
}

describe('ctx.outputs (generated files)', () => {
  it('registers files once per path and lists them with their state on disk', async () => {
    const { hub, contexts, write } = await start();
    const alpha = contexts.alpha!;
    const file = write(alpha, 'a.mp4');
    alpha.outputs.register({ path: file, ref: 'video:1', label: 'Vidéo', parent: 'track:1' });
    // Re-registering the same path (regeneration) updates the record.
    alpha.outputs.register({ path: file, ref: 'video:1', label: 'Vidéo (bis)', parent: 'track:1' });
    const [record] = alpha.outputs.list();
    expect(alpha.outputs.list()).toHaveLength(1);
    expect(record).toMatchObject({ ref: 'video:1', label: 'Vidéo (bis)', exists: true });
    expect(record!.url).toMatch(/^\/api\/media\//);

    // Deleted in the Explorer: reported missing at the next read, and by the sync.
    rmSync(file);
    expect(alpha.outputs.list()[0]).toMatchObject({ exists: false, url: null });
    const { body } = await hub.request<OutputRecord[]>('GET', '/api/core/outputs?missing=1');
    expect(body.map((r) => r.ref)).toEqual(['video:1']);
    expect(hub.hub.outputs.sync()).toBe(1);
  });

  it('deletes to the Recycle Bin and lets the owner clean its data', async () => {
    const { contexts, removed, trashed, write } = await start();
    const alpha = contexts.alpha!;
    const files = ['1.mp4', '2.mp4', '3.jpg'].map((name) => write(alpha, name));
    files.forEach((file, i) =>
      alpha.outputs.register({ path: file, ref: `item:${i}`, label: 'x', parent: 'pack:1' }),
    );
    expect(await alpha.outputs.delete({ ref: 'item:0' })).toBe(1);
    expect(trashed).toEqual([files[0]]);
    // A whole group (a pack): every file of it.
    expect(await alpha.outputs.delete({ parent: 'pack:1' })).toBe(2);
    expect(files.every((file) => !existsSync(file))).toBe(true);
    expect(removed).toEqual([
      { module: 'alpha', refs: ['item:0'], reason: 'deleted' },
      { module: 'alpha', refs: expect.arrayContaining(['item:1', 'item:2']), reason: 'deleted' },
    ]);
  });

  it('refuses a deletion without any criterion', async () => {
    const { contexts } = await start();
    await expect(contexts.alpha!.outputs.delete({})).rejects.toThrow(/sans critère/);
    expect(() => contexts.alpha!.outputs.forget({})).toThrow(/sans critère/);
  });

  it('only sees its own files, except by subject (files about the same track)', async () => {
    const { hub, contexts, removed, write } = await start();
    const { alpha, beta } = contexts as Record<string, ModuleContext>;
    alpha!.outputs.register({
      path: write(alpha!, 'a.mp4'),
      ref: 'video:1',
      label: 'a',
      subject: 'music-library:track:7',
    });
    beta!.outputs.register({
      path: write(beta!, 'b.mp4'),
      ref: 'reel:1',
      label: 'b',
      subject: 'music-library:track:7',
    });
    expect(alpha!.outputs.list().map((r) => r.ref)).toEqual(['video:1']);
    expect(alpha!.outputs.bySubject('music-library:track:7')).toHaveLength(2);
    expect(await alpha!.outputs.deleteBySubject('music-library:track:7')).toBe(2);
    // Each owner was told about its own files.
    expect(removed.map((r) => r.module).sort()).toEqual(['alpha', 'beta']);
    expect((await hub.request<unknown[]>('GET', '/api/core/outputs')).body).toEqual([]);
  });

  it('removes missing files from the lists without touching anything else', async () => {
    const { hub, contexts, removed, trashed, write } = await start();
    const alpha = contexts.alpha!;
    const kept = write(alpha, 'kept.mp4');
    const gone = write(alpha, 'gone.mp4');
    alpha.outputs.register({ path: kept, ref: 'video:1', label: 'x' });
    alpha.outputs.register({ path: gone, ref: 'video:2', label: 'x' });
    rmSync(gone);
    const { body } = await hub.request<{ forgotten: number }>(
      'POST',
      '/api/core/outputs/clean-missing',
      {},
    );
    expect(body.forgotten).toBe(1);
    expect(removed).toEqual([{ module: 'alpha', refs: ['video:2'], reason: 'forgotten' }]);
    expect(trashed).toEqual([]);
    expect(alpha.outputs.list().map((r) => r.ref)).toEqual(['video:1']);
    expect(existsSync(kept)).toBe(true);
  });

  it('opens, reveals and deletes through the core routes', async () => {
    const { hub, contexts, write } = await start();
    const record = contexts.alpha!.outputs.register({
      path: write(contexts.alpha!, 'a.mp4'),
      ref: 'video:1',
      label: 'x',
    });
    expect((await hub.request('POST', `/api/core/outputs/${record.id}/open`)).status).toBe(200);
    expect((await hub.request('POST', `/api/core/outputs/${record.id}/reveal`)).status).toBe(200);
    expect((await hub.request('POST', '/api/core/outputs/delete', { ids: [] })).status).toBe(400);
    const { body } = await hub.request<{ deleted: number }>('POST', '/api/core/outputs/delete', {
      ids: [record.id],
    });
    expect(body.deleted).toBe(1);
    expect((await hub.request('POST', `/api/core/outputs/${record.id}/open`)).status).toBe(404);
  });
});
