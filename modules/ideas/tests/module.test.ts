// The Boîte à idées on a real hub (MODULES.md §8): CRUD, tags (filter, rename,
// merge, colour), search, random within the filter, archives, deletion with
// « Annuler », « Transformer en tâche » with and without the To-do, Markdown
// export, the assistant (adding under its own right, off by default; reading free).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost, createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { IdeaDto, IdeasResponse } from '../shared';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/ideas';

async function open(options: { todo?: boolean; saveTo?: string } = {}) {
  const ids = options.todo === false ? ['ideas'] : ['todo', 'ideas'];
  return createTestHub({
    modules: await Promise.all(ids.map((id) => loadModuleFolder(path.join(MODULES, id)))),
    host: createTestHost({ selectSaveFile: () => Promise.resolve(options.saveTo ?? null) }),
  });
}

describe('ideas', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
  });
  const list = async (query = '') =>
    (await hub.request<IdeasResponse>('GET', `${API}/ideas?${query}`)).body;
  const add = async (body: Record<string, unknown>) =>
    (await hub.request<IdeaDto>('POST', `${API}/ideas`, body)).body;

  it('notes, edits, archives, deletes with « Annuler »', async () => {
    hub = await open();
    expect((await hub.request('POST', `${API}/ideas`, { title: '  ' })).status).toBe(400);
    const idea = await add({
      title: 'Break avec des cordes',
      body: 'Vers **1:30**\n- violons\n- altos',
      tags: ['#Arrangement', 'cordes', 'cordes'],
    });
    expect(idea).toMatchObject({ tags: ['arrangement', 'cordes'], archived: false, task: null });
    expect(idea.createdAt).toBe(idea.updatedAt);
    await new Promise((r) => setTimeout(r, 5));
    const edited = (
      await hub.request<IdeaDto>('PATCH', `${API}/ideas/${idea.id}`, { title: 'Break de cordes' })
    ).body;
    expect(edited.title).toBe('Break de cordes');
    expect(edited.updatedAt > edited.createdAt).toBe(true);
    // Archive: out of the list, in the archives; « modifiée » unchanged.
    const archived = (
      await hub.request<IdeaDto>('PATCH', `${API}/ideas/${idea.id}`, { archived: true })
    ).body;
    expect(archived.updatedAt).toBe(edited.updatedAt);
    expect((await list()).ideas).toHaveLength(0);
    expect((await list('archived=1')).ideas.map((i) => i.id)).toEqual([idea.id]);
    expect((await list()).counts).toEqual({ active: 0, archived: 1 });
    await hub.request('PATCH', `${API}/ideas/${idea.id}`, { archived: false });
    expect((await list()).ideas).toHaveLength(1);
    // Delete, then « Annuler »: back with its dates.
    await hub.request('DELETE', `${API}/ideas/${idea.id}`);
    expect((await list()).ideas).toHaveLength(0);
    const back = (await hub.request<IdeaDto>('POST', `${API}/ideas/${idea.id}/restore`)).body;
    expect(back).toMatchObject({
      id: idea.id,
      title: 'Break de cordes',
      createdAt: idea.createdAt,
    });
  });

  it('search without accents, several tags, sort', async () => {
    hub = await open();
    const a = await add({ title: 'Élan des cordes', tags: ['musique', 'arrangement'] });
    const b = await add({ title: 'Clip de nuit', body: 'métro, lumières', tags: ['clip'] });
    const c = await add({ title: 'Pochette', body: 'photo de nuit', tags: ['musique', 'visuel'] });
    expect((await list('q=elan')).ideas.map((i) => i.id)).toEqual([a.id]);
    expect((await list('q=metro')).ideas.map((i) => i.id)).toEqual([b.id]);
    expect((await list('q=nuit')).ideas.map((i) => i.id).sort()).toEqual([b.id, c.id].sort());
    expect((await list('q=visuel')).ideas.map((i) => i.id)).toEqual([c.id]);
    expect((await list('tags=musique')).ideas).toHaveLength(2);
    expect((await list('tags=musique,visuel')).ideas.map((i) => i.id)).toEqual([c.id]);
    expect((await list('sort=old')).ideas.map((i) => i.id)).toEqual([a.id, b.id, c.id]);
    expect((await list('sort=recent')).ideas.map((i) => i.id)).toEqual([c.id, b.id, a.id]);
    await new Promise((r) => setTimeout(r, 5));
    await hub.request('PATCH', `${API}/ideas/${a.id}`, { body: 'modifiée' });
    expect((await list('sort=modified')).ideas[0]!.id).toBe(a.id);
    expect((await list()).tags.find((t) => t.name === 'musique')).toEqual({
      name: 'musique',
      count: 2,
      color: 0,
    });
  });

  it('one idea at random, within the tag filter, never an archived one', async () => {
    hub = await open();
    const clip = await add({ title: 'Clip', tags: ['clip'] });
    const old = await add({ title: 'Ancien clip', tags: ['clip'] });
    await add({ title: 'Autre', tags: ['musique'] });
    await hub.request('PATCH', `${API}/ideas/${old.id}`, { archived: true });
    for (let i = 0; i < 15; i++) {
      const { idea } = (await hub.request<{ idea: IdeaDto }>('GET', `${API}/random?tags=clip`))
        .body;
      expect(idea.id).toBe(clip.id);
    }
    expect(
      (await hub.request<{ idea: null }>('GET', `${API}/random?tags=rien`)).body.idea,
    ).toBeNull();
  });

  it('tags: colour, rename, merge (archives included)', async () => {
    hub = await open();
    const a = await add({ title: 'A', tags: ['mix'] });
    const b = await add({ title: 'B', tags: ['mixage', 'studio'] });
    await hub.request('PATCH', `${API}/ideas/${b.id}`, { archived: true });
    await hub.request('PUT', `${API}/tags/mixage`, { color: 3 });
    expect((await hub.request('PUT', `${API}/tags/mixage`, { color: 12 })).status).toBe(400);
    // Rename: the colour follows.
    await hub.request('PUT', `${API}/tags/studio`, { name: 'Enregistrement' });
    expect((await list('archived=1')).ideas[0]!.tags).toEqual(['mixage', 'enregistrement']);
    // Merge « mixage » into « mix »: one tag, both ideas.
    const { tags } = (
      await hub.request<{ tags: { name: string; count: number; color: number }[] }>(
        'PUT',
        `${API}/tags/mixage`,
        { name: 'mix' },
      )
    ).body;
    expect(tags.find((t) => t.name === 'mix')).toEqual({ name: 'mix', count: 2, color: 3 });
    expect(tags.some((t) => t.name === 'mixage')).toBe(false);
    expect((await list()).ideas.find((i) => i.id === a.id)!.tags).toEqual(['mix']);
    expect((await hub.request('PUT', `${API}/tags/inconnu`, { color: 1 })).status).toBe(404);
  });

  it('« Transformer en tâche » with the To-do: a task, the idea stays, marked', async () => {
    hub = await open();
    const idea = await add({ title: 'Appeler Léa pour le feat', tags: ['feat'] });
    expect((await list()).todo).toBe(true);
    const { body } = await hub.request<{ idea: IdeaDto; task: { id: number; title: string } }>(
      'POST',
      `${API}/ideas/${idea.id}/to-task`,
    );
    expect(body.idea.task).toEqual({ id: body.task.id, title: 'Appeler Léa pour le feat' });
    const tasks = (
      await hub.request<{ tasks: { title: string; tags: string[] }[] }>(
        'GET',
        '/api/modules/todo/tasks',
      )
    ).body.tasks;
    expect(tasks).toEqual([
      expect.objectContaining({ title: 'Appeler Léa pour le feat', tags: ['feat'] }),
    ]);
    expect((await list()).ideas).toHaveLength(1);
    // Once only.
    expect((await hub.request('POST', `${API}/ideas/${idea.id}/to-task`)).status).toBe(409);
  });

  it('without the To-do: everything works, no « Transformer en tâche »', async () => {
    hub = await open({ todo: false });
    const idea = await add({ title: 'Idée seule' });
    expect((await list()).todo).toBe(false);
    const r = await hub.request<{ error: string }>('POST', `${API}/ideas/${idea.id}/to-task`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/To-do n’est pas disponible/);
  });

  it('exports in Markdown through « Enregistrer sous » (nothing without a choice)', async () => {
    const target = path.join(mkdtempSync(path.join(tmpdir(), 'toolbox-ideas-')), 'idees.md');
    hub = await open({ saveTo: target });
    await add({ title: 'Une', body: 'texte **gras**', tags: ['a'] });
    const r = await hub.request<{ path: string; count: number }>('POST', `${API}/export`, {
      archives: true,
    });
    expect(r.body).toEqual({ path: target, count: 1 });
    expect(readFileSync(target, 'utf8')).toContain('## Une');
    await hub.close();
    hub = await open();
    expect((await hub.request('POST', `${API}/export`, {})).body).toEqual({ cancelled: true });
  });

  it('assistant: adding needs its own right (off by default); reading is free', async () => {
    hub = await open();
    const rights = hub.hub.assistant.rights();
    expect(rights.find((r) => r.id === 'ideas.add-ideas')).toMatchObject({
      label: 'L’assistant peut ajouter des idées',
      granted: false,
    });
    const refused = await hub.hub.assistant.run('ideas.add-idea', { text: 'un break' });
    expect(refused.status).toBe('forbidden');
    expect((await list()).ideas).toHaveLength(0);
    hub.hub.assistant.setRight('ideas.add-ideas', true);
    const added = await hub.hub.assistant.run('ideas.add-idea', {
      text: 'un break avec des cordes',
      tags: ['arrangement'],
    });
    expect(added).toMatchObject({
      status: 'done',
      message: 'Idée notée : « un break avec des cordes » (#arrangement).',
    });
    await add({ title: 'Clip de nuit', tags: ['clip'] });
    expect(await hub.hub.assistant.run('ideas.list-ideas', { tag: 'arrangement' })).toMatchObject({
      status: 'done',
      message: '1 idée avec le tag arrangement : « un break avec des cordes ».',
    });
    expect(await hub.hub.assistant.run('ideas.random-idea', { tag: 'clip' })).toMatchObject({
      status: 'done',
      message: 'Une idée au hasard : « Clip de nuit ».',
    });
    // « Annuler » removes the idea added by voice.
    if (added.status === 'done' && added.undoId) await hub.hub.assistant.undo(added.undoId);
    expect((await list()).ideas.map((i) => i.title)).toEqual(['Clip de nuit']);
  });
});
