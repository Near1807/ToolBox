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

  it('returns its default setting', async () => {
    const { body } = await hub.request<{ greeting: string }>(
      'GET',
      '/api/modules/template/summary',
    );
    expect(body.greeting).toBe('Bonjour !');
  });
});
