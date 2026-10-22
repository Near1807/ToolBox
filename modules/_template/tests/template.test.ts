import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';

const MODULE_DIR = path.resolve(__dirname, '..');

describe('template module', () => {
  let hub: TestHub;

  beforeEach(async () => {
    hub = await createTestHub({ modules: [await loadModuleFolder(MODULE_DIR)] });
  });

  afterEach(async () => {
    await hub.close();
  });

  it('loads without errors', async () => {
    const { body } = await hub.request<{ id: string; status: string }[]>(
      'GET',
      '/api/core/modules',
    );
    expect(body).toEqual([expect.objectContaining({ id: 'template', status: 'loaded' })]);
  });

  it('creates, lists and deletes notes', async () => {
    const created = await hub.request<{ id: number }>('POST', '/api/modules/template/notes', {
      text: 'Première note',
    });
    expect(created.status).toBe(200);

    const list = await hub.request<{ text: string }[]>('GET', '/api/modules/template/notes');
    expect(list.body.map((n) => n.text)).toEqual(['Première note']);

    const removed = await hub.request('DELETE', `/api/modules/template/notes/${created.body.id}`);
    expect(removed.status).toBe(200);
  });

  it('rejects an empty note with a clear message', async () => {
    const response = await hub.request<{ error: string }>('POST', '/api/modules/template/notes', {
      text: '  ',
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/obligatoire/);
  });

  it('registers its exports in ctx.outputs, deletable from the core API', async () => {
    const created = await hub.request<{ id: number }>('POST', '/api/modules/template/notes', {
      text: 'À exporter',
    });
    const exported = await hub.request<{ id: number; path: string; exists: boolean }>(
      'POST',
      `/api/modules/template/notes/${created.body.id}/export`,
    );
    expect(exported.body.exists).toBe(true);
    const list = await hub.request<{ id: number }[]>('GET', '/api/core/outputs?module=template');
    expect(list.body.map((r) => r.id)).toEqual([exported.body.id]);

    const deleted = await hub.request<{ deleted: number }>('POST', '/api/core/outputs/delete', {
      ids: [exported.body.id],
    });
    expect(deleted.body.deleted).toBe(1);
    expect(existsSync(exported.body.path)).toBe(false);
    expect((await hub.request<unknown[]>('GET', '/api/core/outputs?module=template')).body).toEqual(
      [],
    );
  });

  it('follows when its exports are attached to another project (onReattach)', async () => {
    const created = await hub.request<{ id: number }>('POST', '/api/modules/template/notes', {
      text: 'À rattacher',
    });
    const exported = await hub.request<{ id: number }>(
      'POST',
      `/api/modules/template/notes/${created.body.id}/export`,
    );
    // Without onReattach, the core would refuse (MODULES.md §5.13).
    expect(hub.hub.outputs.attach([exported.body.id], 'autre:projet:1')).toBe(1);
    const list = await hub.request<{ subject: string }[]>(
      'GET',
      '/api/core/outputs?module=template',
    );
    expect(list.body[0]?.subject).toBe('autre:projet:1');
  });

  it('returns its default setting', async () => {
    const { body } = await hub.request<{ greeting: string }>(
      'GET',
      '/api/modules/template/summary',
    );
    expect(body.greeting).toBe('Bonjour !');
  });
});
