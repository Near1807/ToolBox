// Non-regression of the Boîte à idées (step 2 of the phone version, ADR
// 0044): a realistic base built through the API on a frozen clock
// (Wednesday 2026-11-04, 10:00 local time, then moved forward), with the
// To-do and a music library present, then the answers of every route (reads
// with search, tags and sorts, writes, archives, restores, tags renamed,
// merged and coloured, « Transformer en tâche », the export, the home card,
// an idea at random), the assistant's reading and every stored row. The
// reference (fixtures/regression.json) was written by the v0.29.0 code,
// before the code was made portable.
//
// To rewrite the reference (only on purpose): TOOLBOX_WRITE_REFERENCE=1.
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestHost,
  createTestHub,
  dumpTables,
  loadModuleFolder,
  readReference,
  referenceShape,
  type TestHub,
} from '@hub/sdk/testing';

const MODULES = path.resolve(__dirname, '..', '..');
const API = '/api/modules/ideas';
const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
const NOW = new Date(2026, 10, 4, 10, 0, 0);

/** A music library with two tracks (only what the Boîte à idées uses). */
function fakeLibrary() {
  const tracks = [
    { id: 1, title: 'Nuit blanche' },
    { id: 2, title: 'Aube' },
  ];
  return {
    folder: 'music-library',
    manifest: {
      id: 'music-library',
      name: 'Bibliothèque',
      description: 'fake',
      version: '1.0.0',
      section: 'Musique',
      icon: 'music',
      provides: { services: ['musicLibrary'] },
    },
    backend: {
      register: (ctx: { services: { provide: (n: string, s: object) => void } }) =>
        ctx.services.provide('musicLibrary', {
          listTracks: () => tracks,
          getTrack: (id: number) => tracks.find((t) => t.id === id) ?? null,
          trackIdOf: (subject: string) => {
            const m = /^music-library:track:(\d+)$/.exec(subject);
            return m ? Number(m[1]) : null;
          },
          registerTrackInfo: () => () => {},
        }),
    },
  };
}

describe('non-regression of the Boîte à idées (reference: v0.29.0)', () => {
  let hub: TestHub;
  afterEach(async () => {
    await hub?.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('same answers of every route, same export, same stored rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * 60_000);
    const out = mkdtempSync(path.join(os.tmpdir(), 'ideas-reg-'));
    const saves: { name: string; data?: string }[] = [];
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({
        selectSaveFile: (o) => {
          saves.push({ name: path.basename(o.defaultPath ?? '') });
          return Promise.resolve(path.join(out, `export-${saves.length}`));
        },
      }),
      modules: [
        fakeLibrary() as never,
        ...(await Promise.all(
          ['todo', 'ideas'].map((id) => loadModuleFolder(path.join(MODULES, id))),
        )),
      ],
    });
    const steps: [string, unknown][] = [];
    const call = async <T>(method: string, url: string, body?: unknown) => {
      const r = await hub.request<T>(method, `${API}${url}`, body);
      // The export's path is in a temporary folder: only its name is compared.
      const answer = r.body as { path?: unknown } | null;
      const shown =
        answer && typeof answer.path === 'string'
          ? { ...answer, path: path.basename(answer.path) }
          : answer;
      steps.push([`${method} ${url}`, { status: r.status, body: shown }]);
      return r.body;
    };
    const idea = async (body: object) => {
      later(7);
      return call<{ id: string }>('POST', '/ideas', body);
    };

    await call('GET', '/ideas');
    await call('GET', '/home');
    const cordes = await idea({
      title: 'Un break avec des cordes',
      body: 'Pizzicati sur le 2e couplet.\nEssayer en ré mineur.',
      tags: ['#Arrangement', 'cordes'],
      trackId: 1,
    });
    const pochette = await idea({ title: 'Pochette en noir et blanc', tags: ['visuel'] });
    const live = await idea({
      title: 'Version live acoustique',
      body: 'Guitare + voix, « une prise »',
      tags: ['arrangement', 'live'],
    });
    const clip = await idea({
      title: 'Clip tourné à l’Été',
      body: 'Plage, 16 mm',
      tags: ['visuel'],
    });
    const vieux = await idea({ title: 'Vieux projet', tags: ['archives'] });
    await idea({ title: '' }); // refused
    await idea({ title: 'Morceau absent', trackId: 99 }); // refused
    // Edits: text, tags, track; archived and back; deleted and restored.
    later(30);
    await call('PATCH', `/ideas/${pochette.id}`, {
      body: 'Photo argentique',
      tags: ['visuel', 'photo'],
    });
    later(1); // never two edits at the same instant (the order of « modifiée » would be the ids')
    await call('PATCH', `/ideas/${live.id}`, { trackId: 2 });
    later(5);
    await call('PATCH', `/ideas/${vieux.id}`, { archived: true });
    await call('PATCH', `/ideas/${clip.id}`, { archived: true });
    later(5);
    await call('PATCH', `/ideas/${clip.id}`, { archived: false });
    await call('DELETE', `/ideas/${live.id}`);
    await call('POST', `/ideas/${live.id}/restore`);
    await call('POST', `/ideas/${live.id}/restore`);
    // Tags: coloured, renamed, merged into another, refused.
    await call('PUT', '/tags/visuel', { color: 3 });
    await call('PUT', '/tags/cordes', { name: 'Orchestre' });
    await call('PUT', `/tags/${encodeURIComponent('photo')}`, { name: 'visuel' });
    await call('PUT', '/tags/inconnu', { color: 1 });
    await call('PUT', '/tags/live', { color: 12 });
    // « Transformer en tâche », twice.
    later(2);
    await call('POST', `/ideas/${cordes.id}/to-task`);
    await call('POST', `/ideas/${cordes.id}/to-task`);
    // Reads: search without accents, tags, sorts, archives; at random; home.
    later(60);
    await call('GET', '/ideas');
    await call('GET', '/ideas?q=ete');
    await call('GET', '/ideas?q=CORDES');
    await call('GET', '/ideas?tags=visuel');
    await call('GET', '/ideas?tags=arrangement,live&sort=old');
    await call('GET', '/ideas?sort=modified');
    await call('GET', '/ideas?archived=1');
    await call('GET', '/random');
    await call('GET', '/random?tags=visuel');
    await call('GET', '/random?tags=rien');
    await call('GET', '/home');
    await hub.request('GET', '/api/modules/todo/tasks').then((r) => steps.push(['todo', r.body]));
    // Export (with and without the archives), its contents.
    await call('POST', '/export', {});
    await call('POST', '/export', { archives: true });
    for (const [i, s] of saves.entries())
      s.data = readFileSync(path.join(out, `export-${i + 1}`), 'utf8');
    const assistant = {
      list: await hub.hub.assistant.run('ideas.list-ideas', {}),
      tag: await hub.hub.assistant.run('ideas.list-ideas', { tag: 'visuel' }),
      random: await hub.hub.assistant.run('ideas.random-idea', {}),
      add: await hub.hub.assistant.run('ideas.add-idea', { text: 'Interdit' }),
    };

    const snapshot = referenceShape(
      { steps, saves, assistant, tables: dumpTables(hub.dataDir, 'ideas') },
      NOW.getTime(),
    );
    expect(snapshot).toEqual(readReference(REFERENCE, snapshot));
  });
});
