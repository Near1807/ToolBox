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
import type { ModuleContext } from '@hub/sdk/backend';
import {
  createTestHost,
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { InstagramPackService, PackItem } from '../../instagram-video/contract';
import type { YouTubeVideoService } from '../../youtube-video/contract';
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
  calls: { uploaded: [number, string | null][]; published: Map<number, string | null> },
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
          }),
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
  return [youtubeVideo, instagram, engine];
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
  };
  const trackIds: number[] = [];

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
    for (const title of ['Drop', 'Nuit']) {
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
    }>('POST', `${API}/plan`, { trackId: trackIds[0], date: '2030-01-10', time: '18:00' });
    expect(plan.status).toBe(200);
    expect(plan.body.items.map((i) => `${i.date} ${i.label}`)).toEqual([
      '2030-01-10 Vidéo YouTube',
      '2030-01-10 Post Insta',
      '2030-01-12 Reel 1',
      '2030-01-13 Short 1',
      '2030-01-15 Reel 2',
      '2030-01-16 Short 2',
      '2030-01-19 Reel 3',
      '2030-01-20 Short 3',
      '2030-01-23 Reel 4',
      '2030-01-24 Short 4',
    ]);
    expect(plan.body.shifts).toEqual([]);
    const short = plan.body.items.find((i) => i.label === 'Short 2')!;
    expect(short.title).toBe('Drop — Thomas (2/4)');
    expect(short.description).toContain('{lien_video}');

    const created = await hub.request<{ release: Release }>('POST', `${API}/releases`, {
      trackId: trackIds[0],
      date: '2030-01-10',
      time: '18:00',
    });
    expect(created.status).toBe(200);
    first = created.body.release;
    expect(first.items).toHaveLength(10);
    const video = first.items.find((i) => i.kind === 'youtube')!;
    expect(video.scheduledAt).toBe('2030-01-10T17:00:00.000Z');
    expect(video).toMatchObject({ date: '2030-01-10', time: '18:00', status: 'planned' });
    const again = await hub.request('POST', `${API}/releases`, {
      trackId: trackIds[0],
      date: '2030-02-01',
    });
    expect(again.status).toBe(409);
  });

  it('spreads an overlapping second track and reports it', async () => {
    const plan = await hub.request<{
      items: { label: string; date: string }[];
      shifts: { label: string; from: string; to: string }[];
    }>('POST', `${API}/plan`, { trackId: trackIds[1], date: '2030-01-12', time: '18:00' });
    expect(plan.body.shifts.length).toBeGreaterThan(0);
    expect(plan.body.shifts).toContainEqual({
      label: 'Post Insta',
      from: '2030-01-12',
      to: '2030-01-13',
    });
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
    expect(youtubeItems(first).map((i) => [i.label, i.state, i.error])).toEqual(
      youtubeItems(first).map((i) => [i.label, 'scheduled', null]),
    );
    expect(google.cutAfterBytes).toBeNull();
    const video = first.items.find((i) => i.kind === 'youtube')!;
    const uploaded = google.videos.get(video.youtube!.id)!;
    expect(uploaded.bytes).toBe(300_000);
    expect(uploaded.status).toMatchObject({
      privacyStatus: 'private',
      publishAt: '2030-01-10T17:00:00.000Z',
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
    expect(shortVideo.status.publishAt).toBe('2030-01-13T17:00:00.000Z');
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
    google.quotaExceeded = false;
    // Cancelled while waiting: back to « planned », nothing on YouTube.
    await hub.request('POST', `${API}/items/${video.id}/cancel`);
    expect((await release(second.id)).items.find((i) => i.kind === 'youtube')!.state).toBe(
      'planned',
    );
  });

  it('asks to reconnect when the authorization was revoked', async () => {
    google.expireToken();
    google.refreshInvalid = true;
    const failed = await hub.request<{ error: string; account: string }>(
      'POST',
      `${API}/check-now`,
    );
    expect(failed.status).toBe(409);
    expect(failed.body.account).toBe('reauth-required');
    const account = await hub.request<{ status: { needsReconnect: boolean } }>(
      'GET',
      `${API}/account`,
    );
    expect(account.body.status.needsReconnect).toBe(true);
    const upload = await hub.request<{ error: string }>(
      'POST',
      `${API}/items/${second.items[0]!.id}/upload`,
    );
    expect(upload.status).toBe(409);
    expect(upload.body.error).toContain('reconnecté');
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
});
