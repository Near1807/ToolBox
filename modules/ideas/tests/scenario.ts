// The scenario of the Boîte à idées' non-regression reference
// (regression.test.ts), shared by the PC (better-sqlite3, Fastify) and the
// phone (sqlite-wasm, its mini router: regression-phone.test.ts) — the same
// requests, in the same order, on the same frozen clock.
import path from 'node:path';

export const MODULES = path.resolve(__dirname, '..', '..');
export const REFERENCE = path.join(__dirname, 'fixtures', 'regression.json');
export const NOW = new Date(2026, 10, 4, 10, 0, 0);
const API = '/api/modules/ideas';

/** A music library with two tracks (only what the Boîte à idées uses). */
export function fakeLibrary() {
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

export interface ScenarioEnv {
  request<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }>;
  /** Moves the frozen clock forward. */
  later(minutes: number): void;
}

/** Every request of the reference (the exports go through the platform's « Enregistrer sous »). */
export async function runScenario(env: ScenarioEnv) {
  const steps: [string, unknown][] = [];
  const call = async <T>(method: string, url: string, body?: unknown) => {
    const r = await env.request<T>(method, `${API}${url}`, body);
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
    env.later(7);
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
  env.later(30);
  await call('PATCH', `/ideas/${pochette.id}`, {
    body: 'Photo argentique',
    tags: ['visuel', 'photo'],
  });
  env.later(1); // never two edits at the same instant (the order of « modifiée » would be the ids')
  await call('PATCH', `/ideas/${live.id}`, { trackId: 2 });
  env.later(5);
  await call('PATCH', `/ideas/${vieux.id}`, { archived: true });
  await call('PATCH', `/ideas/${clip.id}`, { archived: true });
  env.later(5);
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
  env.later(2);
  await call('POST', `/ideas/${cordes.id}/to-task`);
  await call('POST', `/ideas/${cordes.id}/to-task`);
  // Reads: search without accents, tags, sorts, archives; at random; home.
  env.later(60);
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
  await env.request('GET', '/api/modules/todo/tasks').then((r) => steps.push(['todo', r.body]));
  // Export (with and without the archives), its contents.
  await call('POST', '/export', {});
  await call('POST', '/export', { archives: true });
  return steps;
}
