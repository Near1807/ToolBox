// End-to-end test of the release planner against a mock of Google (OAuth +
// YouTube Data API): connection with PKCE, plan, anti-congestion, uploads,
// scheduling, moving a date, status, quota exceeded, expired token, network cut.
// The youtube-video / instagram-video / video-engine services are small fakes
// (as MODULES.md §8 suggests): no rendering needed here.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleContext, OutputRecord } from '@hub/sdk/backend';
import {
  createTestHost,
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { CustomReel, CustomReelsService } from '../../custom-reels/contract';
import type { InstagramPackService, PackItem } from '../../instagram-video/contract';
import type { YouTubeVideoService } from '../../youtube-video/contract';
import type { ReleasePlannerService } from '../contract';
import { addDays } from '../backend/time';
import { MockGoogle } from './mock-google';

const MODULES = path.resolve(import.meta.dirname, '../..');
const API = '/api/modules/release-planner';

interface Item {
  id: number;
  kind: string;
  position: number;
  label: string;
  date: string;
  time: string;
  scheduledAt: string;
  state: string;
  status: string;
  warning: string | null;
  error: string | null;
  youtube: { id: string; publishAt: string | null } | null;
  source: { exists: boolean };
}
interface Release {
  id: number;
  items: Item[];
}

/** Fake providers of the services the planner uses, with real files on disk. */
function fakeProviders(
  dir: string,
  calls: {
    uploaded: [number, string | null][];
    published: Map<number, string | null>;
    captions: Map<number, string | null>;
  },
) {
  const file = (name: string, bytes: number) => {
    const target = path.join(dir, name);
    writeFileSync(target, Buffer.alloc(bytes, 3));
    return target;
  };
  const video = file('video.mp4', 300_000);
  const reels = [1, 2, 3, 4].map((n) => file(`reel${n}.mp4`, 120_000));
  const post = file('post.jpg', 20_000);
  const manifest = (id: string, services: string[]) => ({
    id,
    name: id,
    description: 'fake',
    version: '1.0.0',
    section: 'Tests',
    icon: '🧪',
    provides: { services },
  });
  const packItem = (trackId: number, position: number): PackItem => ({
    id: trackId * 10 + position,
    kind: position === 0 ? 'post' : 'reel',
    position,
    label: position === 0 ? 'Post' : `Reel ${position}`,
    filePath: position === 0 ? post : reels[position - 1]!,
    thumbnailPath: null,
    caption: `Légende ${position}`,
    state: 'ready',
    startSec: position === 0 ? null : 20,
    durationSec: position === 0 ? null : 28,
    publishedAt: calls.published.get(trackId * 10 + position) ?? null,
  });
  const youtubeVideo: DiscoveredModule = {
    folder: 'youtube-video',
    manifest: manifest('youtube-video', ['youtubeVideo']),
    backend: {
      register(ctx: ModuleContext) {
        const service: YouTubeVideoService = {
          listVideos: (trackId) => [service.getVideo(trackId)!],
          getVideo: (id) => {
            ctx.outputs.register({
              path: video,
              ref: `video:${id}`,
              subject: `music-library:track:${id}`,
              label: 'Vidéo YouTube',
            });
            return {
              id,
              trackId: id,
              filePath: video,
              exists: true,
              createdAt: '2026-10-01T00:00:00Z',
              youtubeVideoId: null,
              uploadedAt: null,
            };
          },
          texts: () => ({
            videoTitle: 'Thomas - Drop',
            description: 'Le son.\nSpotify : https://example.com',
            tags: ['lofi', 'chill'],
            custom: false,
          }),
          setTexts: () => {
            throw new Error('not used');
          },
          render: () => ({ jobId: 'none' }),
          setUploaded: (videoId, youtubeId) => calls.uploaded.push([videoId, youtubeId]),
        };
        ctx.services.provide('youtubeVideo', service);
      },
    },
  };
  const instagram: DiscoveredModule = {
    folder: 'instagram-video',
    manifest: manifest('instagram-video', ['instagramPack']),
    backend: {
      register(ctx: ModuleContext) {
        const service: InstagramPackService = {
          getPack: (trackId) => ({
            id: trackId,
            trackId,
            caption: 'Légende',
            items: [0, 1, 2, 3, 4].map((p) => packItem(trackId, p)),
          }),
          getItem: (itemId) => ({
            ...packItem(Math.floor(itemId / 10), itemId % 10),
            trackId: Math.floor(itemId / 10),
          }),
          setPublished: (itemId, published) => {
            calls.published.set(itemId, published ? new Date().toISOString() : null);
            return packItem(Math.floor(itemId / 10), itemId % 10);
          },
          setCaption: (itemId, caption) => {
            calls.captions.set(itemId, caption);
            return packItem(Math.floor(itemId / 10), itemId % 10);
          },
          renderItem: () => ({ jobId: 'none' }),
        };
        ctx.services.provide('instagramPack', service);
      },
    },
  };
  const engine: DiscoveredModule = {
    folder: 'video-engine',
    manifest: manifest('video-engine', ['videoEngine']),
    backend: {
      register(ctx: ModuleContext) {
        ctx.services.provide('videoEngine', {
          renderThumbnail: async ({ outputPath }: { outputPath: string }) => {
            mkdirSync(path.dirname(outputPath), { recursive: true });
            writeFileSync(outputPath, Buffer.alloc(5000, 1));
            return { file: outputPath, width: 1280, height: 720 };
          },
        });
      },
    },
  };
  // One Reel perso per track (custom-reels), id = 500 + track.
  const customFile = file('custom1.mp4', 100_000);
  const customReel = (id: number): CustomReel => ({
    id,
    trackId: id - 500,
    position: 1,
    label: 'Reel perso 1',
    startSec: 30,
    durationSec: 28,
    effect: 'rhythm',
    intensity: 'medium',
    audioMode: 'track',
    state: 'ready',
    filePath: customFile,
    exists: true,
    thumbnailPath: null,
    caption: 'Légende perso',
    publishedAt: calls.published.get(id) ?? null,
  });
  const custom: DiscoveredModule = {
    folder: 'custom-reels',
    manifest: manifest('custom-reels', ['customReels']),
    backend: {
      register(ctx: ModuleContext) {
        const service: CustomReelsService = {
          listReels: (trackId) => [customReel(500 + trackId)],
          getReel: (id) => (id > 500 ? customReel(id) : null),
          setPublished: (id, published) => {
            calls.published.set(id, published ? new Date().toISOString() : null);
            return customReel(id);
          },
          setCaption: (id, caption) => {
            calls.captions.set(id, caption);
            return customReel(id);
          },
          renderReel: () => ({ jobId: 'none' }),
        };
        ctx.services.provide('customReels', service);
      },
    },
  };
  return [youtubeVideo, instagram, engine, custom];
}

describe('release-planner (mock YouTube)', () => {
  let hub: TestHub;
  let google: MockGoogle;
  let dir: string;
  const opened: string[] = [];
  const notifications: { title: string; body: string; target?: string }[] = [];
  const calls = {
    uploaded: [] as [number, string | null][],
    published: new Map<number, string | null>(),
    captions: new Map<number, string | null>(),
  };
  const trackIds: number[] = [];
  let plannerService: ReleasePlannerService | null = null;

  const waitFor = async <T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = await read();
      if (done(value)) return value;
      if (Date.now() > end) throw new Error(`Timeout: ${JSON.stringify(value).slice(0, 2000)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  const release = async (id: number) =>
    (await hub.request<Release>('GET', `${API}/releases/${id}`)).body;
  const youtubeItems = (r: Release) =>
    r.items.filter((i) => i.kind === 'youtube' || i.kind === 'short');

  beforeAll(async () => {
    google = await new MockGoogle().start();
    dir = mkdtempSync(path.join(tmpdir(), 'toolbox-rp-'));
    const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ['-v', 'error', '-y', ...args]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=40', path.join(dir, 'song.wav')]);
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=200x200',
      '-frames:v',
      '1',
      path.join(dir, 'cover.png'),
    ]);

    hub = await createTestHub({
      modules: [
        await loadModuleFolder(path.join(MODULES, 'music-library')),
        ...fakeProviders(dir, calls),
        await loadModuleFolder(path.join(MODULES, 'release-planner')),
        // Reads the planner's quota like youtube-stats does.
        {
          folder: 'quota-reader',
          manifest: {
            id: 'quota-reader',
            name: 'quota-reader',
            description: 'fake',
            version: '1.0.0',
            section: 'Tests',
            icon: '🧪',
            dependsOn: { optionalServices: ['releasePlanner'] },
          },
          backend: {
            register(ctx: ModuleContext) {
              plannerService =
                ctx.services.optional<ReleasePlannerService>('releasePlanner') ?? null;
            },
          },
        } as DiscoveredModule,
      ],
      host: createTestHost({
        getDefaultOutputRoot: () => path.join(dir, 'out'),
        openExternal: async (url) => {
          opened.push(url);
        },
        notify: (notification) => notifications.push(notification),
      }),
      accountProviders: { google: google.provider },
    });
    for (const title of ['Drop', 'Nuit', 'Aube']) {
      const { body } = await hub.request<{ id: number }>(
        'POST',
        '/api/modules/music-library/tracks',
        {
          audioPath: path.join(dir, 'song.wav'),
          coverPath: path.join(dir, 'cover.png'),
        },
      );
      await hub.request('PATCH', `/api/modules/music-library/tracks/${body.id}`, {
        title,
        artist: 'Thomas',
      });
      trackIds.push(body.id);
    }
  }, 60_000);

  afterAll(async () => {
    await hub.close();
    await google.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and needs a configured Google account before uploading', async () => {
    const modules = (
      await hub.request<{ id: string; status: string; error?: string }[]>(
        'GET',
        '/api/core/modules',
      )
    ).body;
    expect(modules.find((m) => m.id === 'release-planner')).toMatchObject({ status: 'loaded' });
    const account = await hub.request<{ status: { configured: boolean; connected: boolean } }>(
      'GET',
      `${API}/account`,
    );
    expect(account.body.status).toMatchObject({ configured: false, connected: false });
    const refused = await hub.request<{ error: string }>('POST', `${API}/account/connect`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('Réglages > Comptes connectés');
  });

  it('connects the Google account (browser consent, PKCE, encrypted tokens)', async () => {
    const saved = await hub.request('PUT', '/api/core/settings/accounts', {
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
    });
    expect(saved.status).toBe(200);
    // Refused in the browser first.
    let pending = hub.request<{ error: string }>('POST', `${API}/account/connect`);
    await waitFor(
      async () => opened.length,
      (n) => n === 1,
    );
    expect(await google.consent(opened[0]!, false)).toBe(200);
    expect((await pending).body.error).toContain('refusée');

    pending = hub.request('POST', `${API}/account/connect`);
    await waitFor(
      async () => opened.length,
      (n) => n === 2,
    );
    const authUrl = new URL(opened[1]!);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('access_type')).toBe('offline');
    expect(authUrl.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube');
    expect(authUrl.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await google.consent(opened[1]!)).toBe(200);
    const connected = (await pending) as unknown as {
      status: number;
      body: { status: { connected: boolean }; channel: { title: string } };
    };
    expect(connected.status).toBe(200);
    expect(connected.body.status.connected).toBe(true);
    expect(connected.body.channel.title).toBe('GrosKaillou');
    // Tokens never stored in clear.
    const row = hub.hub.handle.db.prepare('SELECT * FROM core__accounts').get() as Record<
      string,
      string
    >;
    expect(row.refresh_token).not.toContain('refresh-1');
    expect(Buffer.from(row.refresh_token!, 'base64').toString()).toBe('enc:refresh-1');
    const accounts = await hub.request<{ connected: boolean; scopes: string[] }[]>(
      'GET',
      '/api/core/accounts',
    );
    expect(accounts.body[0]).toMatchObject({
      connected: true,
      scopes: ['https://www.googleapis.com/auth/youtube'],
    });
  });

  let first: Release;

  it('proposes the default plan and creates the release (Brussels time)', async () => {
    const plan = await hub.request<{
      items: { label: string; date: string; title: string; description: string }[];
      shifts: unknown[];
    }>('POST', `${API}/plan`, { trackId: trackIds[0], date: '2030-01-14', time: '18:00' });
    expect(plan.status).toBe(200);
    expect(plan.body.items.map((i) => `${i.date} ${i.label}`)).toEqual([
      '2030-01-14 Vidéo YouTube',
      '2030-01-14 Post Insta',
      '2030-01-15 Reel 1',
      '2030-01-15 Short 1',
      '2030-01-16 Reel 2',
      '2030-01-16 Short 2',
      '2030-01-17 Reel 3',
      '2030-01-17 Short 3',
      '2030-01-18 Reel 4',
      '2030-01-18 Short 4',
    ]);
    // « J tombe toujours un lundi » (on by default): a Thursday becomes the next Monday.
    const thursday = await hub.request<{ releaseDate: string; warnings: string[] }>(
      'POST',
      `${API}/plan`,
      { trackId: trackIds[0], date: '2030-01-10', time: '18:00' },
    );
    expect(thursday.body.releaseDate).toBe('2030-01-14');
    expect(thursday.body.warnings.join(' ')).toContain('lundi 14/01/2030');
    expect(plan.body.shifts).toEqual([]);
    const short = plan.body.items.find((i) => i.label === 'Short 2')!;
    expect(short.title).toBe('Drop — Thomas (2/4)');
    expect(short.description).toContain('{lien_video}');

    const created = await hub.request<{ release: Release }>('POST', `${API}/releases`, {
      trackId: trackIds[0],
      date: '2030-01-14',
      time: '18:00',
    });
    expect(created.status).toBe(200);
    first = created.body.release;
    expect(first.items).toHaveLength(10);
    const video = first.items.find((i) => i.kind === 'youtube')!;
    expect(video.scheduledAt).toBe('2030-01-14T17:00:00.000Z');
    expect(video).toMatchObject({ date: '2030-01-14', time: '18:00', status: 'planned' });
    const again = await hub.request('POST', `${API}/releases`, {
      trackId: trackIds[0],
      date: '2030-02-01',
    });
    expect(again.status).toBe(409);
  });

  it('answers the assistant: agenda, a release, and never uploads', async () => {
    const run = (id: string, params: object = {}) =>
      hub.hub.assistant.run(`release-planner.${id}`, params);
    expect(await run('release', { track: 'drop' })).toMatchObject({
      status: 'done',
      message: expect.stringMatching(
        /^Sortie de Drop : à venir : .+\. Jour J : lundi 14 janvier\.$/,
      ),
    });
    const agenda = await run('agenda', { period: 'next7' });
    expect(agenda).toMatchObject({
      status: 'done',
      message: 'Rien de prévu les 7 prochains jours.',
    });
    // « cette semaine » = the calendar week; « Rien de prévu » here too (sortie en 2030).
    expect(await run('agenda', { period: 'week' })).toMatchObject({
      message: 'Rien de prévu cette semaine.',
    });
    expect(await run('upload', {})).toMatchObject({
      status: 'refused',
      open: '/m/release-planner',
    });
    expect(await run('move', {})).toMatchObject({ status: 'refused' });
  });

  it('spreads an overlapping second track and reports it', async () => {
    const plan = await hub.request<{
      items: { label: string; date: string }[];
      shifts: { label: string; from: string; to: string }[];
    }>('POST', `${API}/plan`, { trackId: trackIds[1], date: '2030-01-12', time: '18:00' });
    expect(plan.body.shifts.length).toBeGreaterThan(0);
    expect(plan.body.shifts).toContainEqual({
      label: 'Post Insta',
      from: '2030-01-14',
      to: '2030-01-21',
      reason: 'full',
    });
  });

  it('lets texts follow the templates until edited, in place', async () => {
    type T = Item & { title: string; description: string; tags: string[]; textsCustom: boolean };
    const items = async () =>
      (await hub.request<{ items: T[] }>('GET', `${API}/releases/${first.id}`)).body.items;
    const short1 = (await items()).find((i) => i.kind === 'short' && i.position === 1)!;
    expect(short1).toMatchObject({ title: 'Drop — Thomas (1/4)', textsCustom: false });

    // A template changed in the settings: elements not edited follow it.
    await hub.request('PUT', '/api/core/settings/release-planner', { shortTitle: '{titre} #{n}' });
    expect((await items()).find((i) => i.id === short1.id)!.title).toBe('Drop #1');

    // Edited under the element: frozen, marked as custom.
    await hub.request('PATCH', `${API}/items/${short1.id}`, { title: 'Mon Short', tags: 'a, #b' });
    await hub.request('PUT', '/api/core/settings/release-planner', { shortTitle: null });
    let edited = (await items()).find((i) => i.id === short1.id)!;
    expect(edited).toMatchObject({ title: 'Mon Short', tags: ['a', 'b'], textsCustom: true });

    // « Enregistrer comme modèle par défaut »: values become placeholders.
    await hub.request('POST', `${API}/items/${short1.id}/texts/template`, {
      title: 'Drop par Thomas (1/4)',
    });
    edited = (await items()).find((i) => i.id === short1.id)!;
    expect(edited).toMatchObject({ title: 'Drop par Thomas (1/4)', textsCustom: false });
    const short2 = (await items()).find((i) => i.kind === 'short' && i.position === 2)!;
    expect(short2.title).toBe('Drop par Thomas (2/4)');
    await hub.request('PUT', '/api/core/settings/release-planner', { shortTitle: null });

    // « Rétablir le modèle ».
    await hub.request('PATCH', `${API}/items/${short1.id}`, { title: 'X' });
    await hub.request('PATCH', `${API}/items/${short1.id}`, { resetTexts: true });
    expect((await items()).find((i) => i.id === short1.id)!).toMatchObject({
      title: 'Drop — Thomas (1/4)',
      textsCustom: false,
    });

    // Instagram caption: edited in the pack through its service.
    const post = (await items()).find((i) => i.kind === 'insta-post')!;
    const caption = await hub.request('PATCH', `${API}/items/${post.id}/caption`, {
      caption: 'Nouvelle légende',
    });
    expect(caption.status).toBe(200);
    expect([...calls.captions.values()]).toContain('Nouvelle légende');
  });

  it('uploads and schedules the video and the Shorts (resume after a network cut)', async () => {
    await hub.request('PUT', '/api/core/settings/release-planner', {
      playlist: 'GrosKaillou – Sons',
    });
    google.cutAfterBytes = 100_000; // the first upload loses its connection
    const queued = await hub.request<{ queued: number; quotaMessage: string | null }>(
      'POST',
      `${API}/releases/${first.id}/upload`,
    );
    expect(queued.body).toMatchObject({ queued: 5, quotaMessage: null });
    first = await waitFor(
      () => release(first.id),
      (r) => youtubeItems(r).every((i) => i.state === 'scheduled' || i.state === 'failed'),
    );
    // An item reads « scheduled » before its thumbnail and playlist are done: the
    // checks below wait for the upload jobs to finish.
    await waitFor(
      async () =>
        (await hub.request<{ status: string }[]>('GET', '/api/core/jobs?module=release-planner'))
          .body,
      (jobs) => jobs.every((j) => j.status !== 'queued' && j.status !== 'running'),
    );
    first = await release(first.id);
    expect(youtubeItems(first).map((i) => [i.label, i.state, i.error])).toEqual(
      youtubeItems(first).map((i) => [i.label, 'scheduled', null]),
    );
    expect(google.cutAfterBytes).toBeNull();
    const video = first.items.find((i) => i.kind === 'youtube')!;
    const uploaded = google.videos.get(video.youtube!.id)!;
    expect(uploaded.bytes).toBe(300_000);
    expect(uploaded.status).toMatchObject({
      privacyStatus: 'private',
      publishAt: '2030-01-14T17:00:00.000Z',
    });
    expect(uploaded.snippet).toMatchObject({
      title: 'Thomas - Drop',
      categoryId: '10',
      defaultLanguage: 'fr',
    });
    // The Shorts link to the full video, uploaded first.
    const short = first.items.find((i) => i.label === 'Short 1')!;
    const shortVideo = google.videos.get(short.youtube!.id)!;
    expect(shortVideo.snippet.description).toContain(
      `https://www.youtube.com/watch?v=${video.youtube!.id}`,
    );
    expect(shortVideo.status.publishAt).toBe('2030-01-15T17:00:00.000Z');
    expect(google.thumbnails).toEqual([video.youtube!.id]);
    expect(google.playlistItems).toHaveLength(5);
    expect(google.playlistItems.every((p) => p.playlistId === 'PLsons')).toBe(true);
    expect(calls.uploaded).toEqual([[trackIds[0], video.youtube!.id]]);
    const outputs = await hub.request<{ label: string }[]>(
      'GET',
      '/api/core/outputs?module=release-planner',
    );
    expect(outputs.body.map((o) => o.label)).toEqual(['Miniature YouTube']);
  });

  it('moves a scheduled Short: publishAt updated on YouTube', async () => {
    const short = first.items.find((i) => i.label === 'Short 2')!;
    const moved = await hub.request<{ item: Item; warnings: string[] }>(
      'PATCH',
      `${API}/items/${short.id}`,
      {
        date: '2030-04-01',
        time: '18:00',
      },
    );
    expect(moved.status).toBe(200);
    // Summer time in Brussels from 31 March 2030: 18:00 = 16:00 UTC.
    expect(moved.body.item.scheduledAt).toBe('2030-04-01T16:00:00.000Z');
    expect(google.videos.get(short.youtube!.id)!.status.publishAt).toBe('2030-04-01T16:00:00.000Z');
    expect(moved.body.item.state).toBe('scheduled');
    // Metadata of a video already sent: changed in YouTube Studio only.
    const refused = await hub.request('PATCH', `${API}/items/${short.id}`, { title: 'Autre' });
    expect(refused.status).toBe(409);
  });

  it('reads the status on YouTube (published, deleted), refreshing an expired token', async () => {
    const video = first.items.find((i) => i.kind === 'youtube')!;
    google.videos.get(video.youtube!.id)!.status.privacyStatus = 'public';
    google.expireToken();
    const short4 = first.items.find((i) => i.label === 'Short 4')!;
    google.videos.delete(short4.youtube!.id);
    const checked = await hub.request<{ checked: number }>('POST', `${API}/check-now`);
    expect(checked.body.checked).toBe(5);
    first = await release(first.id);
    expect(first.items.find((i) => i.kind === 'youtube')!.status).toBe('published');
    expect(first.items.find((i) => i.label === 'Short 4')).toMatchObject({ status: 'failed' });
    expect(first.items.find((i) => i.label === 'Short 4')!.error).toContain(
      'introuvable sur YouTube',
    );
  });

  it('ticks Instagram elements as published in the pack', async () => {
    const post = first.items.find((i) => i.kind === 'insta-post')!;
    const ticked = await hub.request<Item>('POST', `${API}/items/${post.id}/published`, {
      published: true,
    });
    expect(ticked.body.status).toBe('published');
    expect(calls.published.get(trackIds[0]! * 10)).toBeTruthy();
    const refused = await hub.request(
      'POST',
      `${API}/items/${first.items.find((i) => i.kind === 'youtube')!.id}/published`,
      { published: true },
    );
    expect(refused.status).toBe(400);
  });

  it('never deletes an online video without an explicit choice', async () => {
    const short1 = first.items.find((i) => i.label === 'Short 1')!;
    const asked = await hub.request<{ error: string }>('DELETE', `${API}/items/${short1.id}`);
    expect(asked.status).toBe(409);
    expect(asked.body.error).toContain('Supprimer aussi sur YouTube');
    expect((await hub.request('DELETE', `${API}/items/${short1.id}?online=keep`)).status).toBe(200);
    expect(google.videos.has(short1.youtube!.id)).toBe(true);
    const short3 = first.items.find((i) => i.label === 'Short 3')!;
    expect((await hub.request('DELETE', `${API}/items/${short3.id}?online=delete`)).status).toBe(
      200,
    );
    expect(google.videos.has(short3.youtube!.id)).toBe(false);
  });

  let second: Release;

  it('defers uploads when the YouTube quota is exceeded', async () => {
    const created = await hub.request<{ release: Release; shifts: unknown[] }>(
      'POST',
      `${API}/releases`,
      {
        trackId: trackIds[1],
        date: '2030-01-12',
        time: '19:30',
      },
    );
    second = created.body.release;
    expect(created.body.shifts.length).toBeGreaterThan(0);
    google.quotaExceeded = true;
    await hub.request('POST', `${API}/releases/${second.id}/upload`);
    second = await waitFor(
      () => release(second.id),
      (r) =>
        youtubeItems(r).every((i) => i.state === 'queued') &&
        youtubeItems(r).some((i) => i.warning),
    );
    const video = second.items.find((i) => i.kind === 'youtube')!;
    expect(video.warning).toContain('quota YouTube du jour dépassé');
    const summary = await hub.request<{
      quota: { exhausted: boolean };
      quotaMessage: string | null;
      queue: number;
    }>('GET', `${API}/summary`);
    expect(summary.body.quota.exhausted).toBe(true);
    expect(summary.body.queue).toBe(5);
    expect(summary.body.quotaMessage).toContain('5 envoi(s) reporté(s)');
    // What another module (youtube-stats) sees: uploads waiting, quota exhausted by the Planning.
    const outlook = plannerService!.youtubeQuota();
    expect(outlook).toMatchObject({
      exhausted: true,
      exhaustedBy: 'release-planner',
      uploadsActive: 5,
      unitsPerDay: 10_000,
    });
    plannerService!.recordYouTubeQuota('youtube-stats', 7);
    expect(plannerService!.youtubeQuota().used.byModule).toEqual({ 'youtube-stats': 7 });
    expect(plannerService!.youtubeQuota().used.total).toBe(outlook.used.total + 7);
    expect(plannerService!.quotaOrigin()).toMatch(
      /^Consommation du jour : \d+ envoi\(s\) du Planning et \d+ unité\(s\) pour leurs suites, 7 unité\(s\) pour Stats YouTube\. Quota épuisé lors d’un appel de le Planning\.$/,
    );
    // The warning of the deferred upload says who consumed the quota.
    expect(video.warning).toContain('Consommation du jour');
    google.quotaExceeded = false;
    // Cancelled while waiting: back to « planned », nothing on YouTube.
    await hub.request('POST', `${API}/items/${video.id}/cancel`);
    expect((await release(second.id)).items.find((i) => i.kind === 'youtube')!.state).toBe(
      'planned',
    );
  });

  it('keeps uploads waiting when the authorization expires (7 days in « Test » mode)', async () => {
    // Expired on Google's side, not yet noticed by the app: the upload discovers it.
    hub.hub.handle.db.prepare('DELETE FROM release_planner__quota').run(); // new quota day
    google.expireToken();
    google.refreshInvalid = true;
    const before = notifications.length;
    const video = second.items.find((i) => i.kind === 'youtube')!;
    const queued = await hub.request('POST', `${API}/items/${video.id}/upload`);
    expect(queued.status).toBe(200);
    second = await waitFor(
      () => release(second.id),
      (r) => {
        const item = r.items.find((i) => i.kind === 'youtube')!;
        return item.state === 'queued' && Boolean(item.warning);
      },
    );
    const waiting = second.items.find((i) => i.kind === 'youtube')!;
    expect(waiting.warning).toContain('Reconnecte le compte');
    expect(waiting.error).toBeNull();
    // Clearly shown, and one notification (not one per attempt).
    const account = await hub.request<{ status: { needsReconnect: boolean } }>(
      'GET',
      `${API}/account`,
    );
    expect(account.body.status.needsReconnect).toBe(true);
    const today = await hub.request<{ account: { needsReconnect: boolean } }>(
      'GET',
      `${API}/today`,
    );
    expect(today.body.account.needsReconnect).toBe(true);
    const sent = notifications.slice(before);
    expect(sent).toEqual([
      expect.objectContaining({
        title: 'Compte Google à reconnecter',
        target: '/m/release-planner/?tab=compte',
      }),
    ]);
    // Nothing is checked on YouTube until reconnection (no error loop, no new notification).
    const checked = await hub.request<{ checked: number }>('POST', `${API}/check-now`);
    expect(checked.body).toEqual({ checked: 0 });
    expect(notifications.length).toBe(before + 1);
    // New uploads wait too, instead of failing.
    const short = second.items.find((i) => i.label === 'Short 1')!;
    const more = await hub.request('POST', `${API}/items/${short.id}/upload`);
    expect(more.status).toBe(200);
    const after = await release(second.id);
    expect(after.items.find((i) => i.id === short.id)).toMatchObject({ state: 'queued' });
    expect(after.items.find((i) => i.id === short.id)!.warning).toContain('Reconnecte');
    await hub.request('POST', `${API}/items/${short.id}/cancel`);
    google.refreshInvalid = false;
  });

  it('flags a video kept private by YouTube (project restricted): to schedule in Studio', async () => {
    // Reconnect (the user clicks « Reconnecter »).
    const pending = hub.request('POST', '/api/core/accounts/google/reconnect');
    await waitFor(
      async () => opened.length,
      (n) => n === 3,
    );
    await google.consent(opened[2]!);
    expect((await pending).status).toBe(200);
    google.restrictToPrivate = true;
    // Reset the exhausted day of the earlier test.
    hub.hub.handle.db.prepare('DELETE FROM release_planner__quota').run();
    const video = second.items.find((i) => i.kind === 'youtube')!;
    await hub.request('POST', `${API}/items/${video.id}/upload`);
    const done = await waitFor(
      () => release(second.id),
      (r) => r.items.find((i) => i.kind === 'youtube')!.state === 'to-schedule',
    );
    const item = done.items.find((i) => i.kind === 'youtube')!;
    expect(item.warning).toContain('YouTube Studio');
    // C. Notified at once, with the direct link to YouTube Studio.
    const studio = notifications.find((n) => n.title === 'À programmer dans YouTube Studio');
    expect(studio?.body).toContain('studio.youtube.com');
    google.restrictToPrivate = false;
  });

  it('lists today, the calendar and the YouTube links', async () => {
    const calendar = await hub.request<{ items: Item[] }>(
      'GET',
      `${API}/calendar?from=2030-01-01&to=2030-01-31`,
    );
    expect(calendar.body.items.length).toBeGreaterThan(10);
    const today = await hub.request<{ date: string; today: unknown[]; late: unknown[] }>(
      'GET',
      `${API}/today`,
    );
    expect(today.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(notifications.every((n) => n.target?.startsWith('/m/release-planner'))).toBe(true);
  });

  it('« Ajouter un Reel perso » to a planned release: Reel and/or Short, on an allowed day', async () => {
    await hub.request('PUT', '/api/core/settings/release-planner', { allowedDays: '1,2,3,4,5' });
    type Options = {
      allowedDays: number[];
      options: {
        customReelId: number;
        planned: { 'insta-reel': boolean; short: boolean };
        date: string;
      }[];
    };
    const options = async () =>
      (await hub.request<Options>('GET', `${API}/releases/${first.id}/custom-reels`)).body;
    const current = await options();
    expect(current.allowedDays).toEqual([0, 1, 2, 3, 4]);
    const [option] = current.options;
    expect(option).toMatchObject({
      customReelId: 500 + trackIds[0]!,
      planned: { 'insta-reel': false, short: false },
    });
    // Proposed on an allowed day, after the last element of the plan.
    const last = (await release(first.id)).items
      .map((i) => i.date)
      .sort()
      .at(-1)!;
    expect(option!.date > last).toBe(true);
    expect([1, 2, 3, 4, 5]).toContain(new Date(`${option!.date}T00:00:00Z`).getUTCDay());

    const add = (kinds: string[], date: string) =>
      hub.request<{ release: Release; warnings: string[]; error?: string }>(
        'POST',
        `${API}/releases/${first.id}/items`,
        { customReelId: option!.customReelId, kinds, date, time: '19:00' },
      );
    // A Saturday: refused, with the allowed days.
    const saturday = addDays(
      option!.date,
      (6 - new Date(`${option!.date}T00:00:00Z`).getUTCDay() + 7) % 7,
    );
    const refused = await add(['short'], saturday);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(
      /samedi : jour non autorisé.*lundi, mardi, mercredi, jeudi, vendredi/,
    );

    const added = await add(['short'], option!.date);
    expect(added.status).toBe(200);
    const short = added.body.release.items.find((i) => i.label === 'Short perso 1')!;
    expect(short).toMatchObject({ date: option!.date, time: '19:00', state: 'planned' });
    expect((await options()).options[0]!.planned).toEqual({ 'insta-reel': false, short: true });
    expect((await add(['short'], option!.date)).status).toBe(409);
    expect((await add([], option!.date)).status).toBe(400);
    expect((await add(['insta-reel'], option!.date)).status).toBe(200);
    // Both planned: not offered any more.
    expect((await options()).options).toEqual([]);
    await hub.request('PUT', '/api/core/settings/release-planner', { allowedDays: null });
  });

  it('removes a whole release, keeping what is online when asked', async () => {
    const refused = await hub.request('DELETE', `${API}/releases/${second.id}`);
    expect(refused.status).toBe(409);
    expect((await hub.request('DELETE', `${API}/releases/${second.id}?online=keep`)).status).toBe(
      200,
    );
    expect((await hub.request('GET', `${API}/releases/${second.id}`)).status).toBe(404);
  });

  it('reminds what is due or late (Windows notification opening the item)', async () => {
    const created = await hub.request<{ release: Release; warnings: string[] }>(
      'POST',
      `${API}/releases`,
      {
        trackId: trackIds[1],
        date: '2026-01-05',
        time: '18:00',
      },
    );
    expect(created.body.warnings.join(' ')).toContain('passée');
    const before = notifications.length;
    // Next run of the « dispatch » task (every minute) is due now.
    hub.hub.handle.db
      .prepare(
        `UPDATE core__schedules SET last_success_at = '2000-01-01T00:00:00Z', last_attempt_at = '2000-01-01T00:00:00Z' WHERE module_id = 'release-planner' AND name = 'dispatch'`,
      )
      .run();
    await hub.hub.scheduler.tick();
    const sent = notifications.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: 'Planning de sortie', target: '/m/release-planner' });
    expect(sent[0]!.body).toContain('10 publications');
    // Already reminded: no second notification at the next run.
    hub.hub.handle.db
      .prepare(
        `UPDATE core__schedules SET last_success_at = '2000-01-01T00:00:00Z', last_attempt_at = '2000-01-01T00:00:00Z' WHERE module_id = 'release-planner' AND name = 'dispatch'`,
      )
      .run();
    await hub.hub.scheduler.tick();
    expect(notifications.length).toBe(before + 1);
    const today = await hub.request<{ late: Item[] }>('GET', `${API}/today`);
    expect(today.body.late.length).toBeGreaterThanOrEqual(10);
  });

  // --- v0.12: planner improvements ------------------------------------------------

  const tick = async () => {
    hub.hub.handle.db
      .prepare(
        `UPDATE core__schedules SET last_success_at = '2000-01-01T00:00:00Z', last_attempt_at = '2000-01-01T00:00:00Z' WHERE module_id = 'release-planner' AND name = 'dispatch'`,
      )
      .run();
    await hub.hub.scheduler.tick();
  };
  /** Local date and time (Brussels) `hours` from now. */
  const inHours = (hours: number) => {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Brussels',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(Date.now() + hours * 3_600_000));
    const [date, time] = parts.split(' ');
    return { date: date!, time: time! };
  };
  let third: Release;

  it('E. moving the date of a video sent as « Privée » only changes the calendar', async () => {
    const release = (await hub.request<Release[]>('GET', `${API}/releases`)).body.find((r) =>
      r.items.some((i) => i.date === '2026-01-05'),
    )!;
    const video = release.items.find((i) => i.kind === 'youtube')!;
    await hub.request('PATCH', `${API}/items/${video.id}`, { visibility: 'private' });
    hub.hub.handle.db.prepare('DELETE FROM release_planner__quota').run();
    await hub.request('POST', `${API}/items/${video.id}/upload`);
    const sent = await waitFor(
      async () =>
        (await hub.request<{ items: Item[] }>('GET', `${API}/releases/${release.id}`)).body,
      (r) =>
        ['to-schedule', 'scheduled', 'published'].includes(
          r.items.find((i) => i.id === video.id)!.state,
        ),
    );
    const online = sent.items.find((i) => i.id === video.id)!;
    const before = { ...google.videos.get(online.youtube!.id)!.status };
    const moved = await hub.request<{ item: Item }>('PATCH', `${API}/items/${video.id}`, {
      date: '2030-06-03',
    });
    expect(moved.status).toBe(200);
    expect(moved.body.item.date).toBe('2030-06-03');
    // Nothing sent to YouTube: still private, no publication date.
    expect(google.videos.get(online.youtube!.id)!.status).toEqual(before);
    expect(moved.body.item.state).not.toBe('scheduled');
  });

  it('proposes only the elements « inclus dans la sortie », and the Reels perso on request', async () => {
    await hub.request('PUT', '/api/core/settings/release-planner', {
      mondayRelease: false,
      allowedDays: '1,2,3,4,5,6,7',
      uploadsPerDay: 50,
    });
    const trackId = trackIds[2]!;
    // Reel 2 of the pack excluded on the project page (library).
    await hub.request('PUT', `/api/modules/music-library/tracks/${trackId}/project/included`, {
      moduleId: 'instagram-video',
      ref: `item:${trackId * 10 + 2}`,
      included: false,
    });
    const when = inHours(48);
    type Proposal = {
      items: { label: string }[];
      warnings: string[];
      customReels: { customReelId: number; label: string; date: string }[];
    };
    const plan = await hub.request<Proposal>('POST', `${API}/plan`, {
      trackId,
      date: when.date,
      time: when.time,
    });
    const labels = plan.body.items.map((i) => i.label);
    expect(labels).not.toContain('Reel 2');
    expect(labels).not.toContain('Short 2');
    expect(labels).toContain('Reel 3');
    expect(plan.body.warnings.join(' ')).toContain('Exclus de la sortie');
    expect(plan.body.customReels).toEqual([
      expect.objectContaining({ customReelId: 500 + trackId, label: 'Reel perso 1' }),
    ]);

    const created = await hub.request<{ release: Release }>('POST', `${API}/releases`, {
      trackId,
      date: when.date,
      time: when.time,
      custom: [{ customReelId: 500 + trackId, kinds: ['insta-reel', 'short'] }],
    });
    expect(created.status).toBe(200);
    third = created.body.release;
    const perso = third.items.filter((i) => i.label.includes('perso')).map((i) => i.label);
    expect(perso.sort()).toEqual(['Reel perso 1', 'Short perso 1']);
    const reelPerso = third.items.find((i) => i.label === 'Reel perso 1')!;
    await hub.request('POST', `${API}/items/${reelPerso.id}/published`, { published: true });
    expect(calls.published.get(500 + trackId)).toBeTruthy();
  });

  it('A. alerts at J-3 then J-1 for YouTube videos not sent yet (once each)', async () => {
    const summary = await hub.request<{ alerts: { releaseId: number; level: string }[] }>(
      'GET',
      `${API}/summary`,
    );
    expect(summary.body.alerts).toContainEqual(
      expect.objectContaining({ releaseId: third.id, level: 'J-3' }),
    );
    const before = notifications.length;
    await tick();
    await tick();
    const j3 = notifications.slice(before).filter((n) => n.title.startsWith('J-3'));
    expect(j3).toHaveLength(1);
    expect(j3[0]!.body).toContain('Aube');
    // The video now tomorrow morning: J-1.
    const video = third.items.find((i) => i.kind === 'youtube')!;
    const soon = inHours(12);
    await hub.request('PATCH', `${API}/items/${video.id}`, soon);
    await tick();
    await tick();
    expect(notifications.slice(before).filter((n) => n.title.startsWith('J-1'))).toHaveLength(1);
  });

  it('G. automatic upload (off by default): starts X days before, then says when it is done', async () => {
    const before = notifications.length;
    await tick();
    // Off: nothing sent.
    let current = await release(third.id);
    expect(youtubeItems(current).every((i) => i.state === 'planned')).toBe(true);
    await hub.request('PUT', '/api/core/settings/release-planner', { autoUpload: true });
    await tick();
    const started = notifications
      .slice(before)
      .find((n) => n.title === 'Envoi automatique sur YouTube');
    expect(started?.body).toContain('Aube');
    current = await waitFor(
      () => release(third.id),
      (r) => youtubeItems(r).every((i) => ['scheduled', 'to-schedule', 'failed'].includes(i.state)),
    );
    expect(youtubeItems(current).every((i) => i.state === 'scheduled')).toBe(true);
    await tick();
    await tick();
    const done = notifications.slice(before).filter((n) => n.title === 'Envoi automatique terminé');
    expect(done).toHaveLength(1);
    await hub.request('PUT', '/api/core/settings/release-planner', {
      autoUpload: null,
      mondayRelease: null,
      allowedDays: null,
      uploadsPerDay: null,
    });
  });

  it('« Sans projet » > Rattacher: the thumbnail leaves its old release for the chosen track’s', async () => {
    const thumbnails = async () =>
      (await hub.request<OutputRecord[]>('GET', '/api/core/outputs?module=release-planner')).body;
    const old = await hub.request<Release & { trackId: number; thumbnailUrl: string | null }>(
      'GET',
      `${API}/releases/${third.id}`,
    );
    const record = (await thumbnails()).find((r) => r.ref === `thumbnail:${third.id}`)!;
    expect(record.exists).toBe(true);
    const { body: track } = await hub.request<{ id: number }>(
      'POST',
      '/api/modules/music-library/tracks',
      { audioPath: path.join(dir, 'song.wav') },
    );
    const planned = await hub.request<{ release: Release }>('POST', `${API}/releases`, {
      trackId: track.id,
      date: '2031-06-02',
    });
    await hub.request('DELETE', `/api/modules/music-library/tracks/${old.body.trackId}`);
    const attached = await hub.request('POST', '/api/modules/music-library/orphans/attach', {
      ids: [record.id],
      trackId: track.id,
    });
    expect(attached.status).toBe(200);
    const moved = (await thumbnails()).find((r) => r.id === record.id)!;
    expect(moved).toMatchObject({
      ref: `thumbnail:${planned.body.release.id}`,
      parent: `release:${planned.body.release.id}`,
      subject: `music-library:track:${track.id}`,
    });
    const adopted = await hub.request<{ thumbnailUrl: string | null }>(
      'GET',
      `${API}/releases/${planned.body.release.id}`,
    );
    expect(adopted.body.thumbnailUrl).not.toBeNull();
    const left = await hub.request<{ thumbnailUrl: string | null }>(
      'GET',
      `${API}/releases/${third.id}`,
    );
    expect(left.body.thumbnailUrl).toBeNull();
  });
});

describe('release-planner without the optional generators', () => {
  it('loads with the library only, and plans what the present modules provide', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-rp-alone-'));
    const ffmpeg = (args: string[]) => execFileSync(ffmpegPath!, ['-v', 'error', '-y', ...args]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', path.join(dir, 'song.wav')]);
    const calls = { uploaded: [], published: new Map(), captions: new Map() };
    const [youtubeVideo] = fakeProviders(dir, calls);
    const library = await loadModuleFolder(path.join(MODULES, 'music-library'));
    const planner = await loadModuleFolder(path.join(MODULES, 'release-planner'));
    const host = () => createTestHost({ getDefaultOutputRoot: () => path.join(dir, 'out') });
    const status = async (hub: TestHub) =>
      (await hub.request<{ id: string; status: string }[]>('GET', '/api/core/modules')).body.find(
        (m) => m.id === 'release-planner',
      )?.status;
    const newTrack = async (hub: TestHub) => {
      const { body } = await hub.request<{ id: number }>(
        'POST',
        '/api/modules/music-library/tracks',
        {
          audioPath: path.join(dir, 'song.wav'),
        },
      );
      return body.id;
    };

    // Library only: loaded, nothing to plan, said clearly.
    const alone = await createTestHub({ modules: [library, planner], host: host() });
    try {
      expect(await status(alone)).toBe('loaded');
      const summary = await alone.request<{ features: Record<string, boolean> }>(
        'GET',
        `${API}/summary`,
      );
      expect(summary.body.features).toEqual({
        youtubeVideo: false,
        instagramPack: false,
        customReels: false,
      });
      const trackId = await newTrack(alone);
      const plan = await alone.request<{
        items: unknown[];
        customReels: unknown[];
        warnings: string[];
      }>('POST', `${API}/plan`, { trackId, date: '2030-03-04' });
      expect(plan.body.items).toEqual([]);
      expect(plan.body.customReels).toEqual([]);
      expect(plan.body.warnings.join('\n')).toMatch(/« Vidéo YouTube » absent/);
      expect(plan.body.warnings.join('\n')).toMatch(/« Pack Instagram » absent/);
      expect(
        (await alone.request('POST', `${API}/releases`, { trackId, date: '2030-03-04' })).status,
      ).toBe(400);
    } finally {
      await alone.close();
    }

    // With the YouTube video only (no pack, no Reels perso, no engine).
    const partial = await createTestHub({
      modules: [library, youtubeVideo!, planner],
      host: host(),
    });
    try {
      expect(await status(partial)).toBe('loaded');
      const trackId = await newTrack(partial);
      const created = await partial.request<{ release: Release }>('POST', `${API}/releases`, {
        trackId,
        date: '2030-03-04',
      });
      expect(created.status).toBe(200);
      expect(created.body.release.items.map((i) => i.kind)).toEqual(['youtube']);
      const added = await partial.request(
        'POST',
        `${API}/releases/${created.body.release.id}/items`,
        {
          customReelId: 501,
          kinds: ['insta-reel'],
          date: '2030-03-05',
        },
      );
      expect(added.status).toBe(400);
    } finally {
      await partial.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
