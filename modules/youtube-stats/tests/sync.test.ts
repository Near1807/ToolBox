// End-to-end: youtube-stats against a fake Google (OAuth, Data API, Analytics
// API), with small fakes of the library, the release planner and the pack
// (MODULES.md §8): incremental authorization, sync, linking to the tracks,
// incremental re-sync, Studio CSV import, manual link, quota, expired token.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleContext } from '@hub/sdk/backend';
import {
  createTestHost,
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { InstagramPackService } from '../../instagram-video/contract';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { ReleasePlannerService } from '../../release-planner/contract';
import { FakeGoogle } from './fake-google';

const API = '/api/modules/youtube-stats';

const day = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

function fakeModule(
  id: string,
  services: string[],
  provide: (ctx: ModuleContext) => void,
): DiscoveredModule {
  return {
    folder: id,
    manifest: {
      id,
      name: id,
      description: 'fake',
      version: '1.0.0',
      section: 'Tests',
      icon: '🧪',
      provides: { services },
    },
    backend: { register: provide },
  } as DiscoveredModule;
}

describe('youtube-stats with a fake Google', () => {
  let google: FakeGoogle;
  let hub: TestHub;
  let dir: string;
  const opened: string[] = [];
  /** The quota as the fake Planning sees it (uploads first). */
  const quota = { uploadsActive: 0, uploadsSoon: 0, used: 0, exhausted: false };
  const recorded: { units: number; exhausted: boolean }[] = [];

  const waitJob = async () => {
    for (let i = 0; i < 300; i++) {
      const jobs = (
        await hub.request<{ status: string; error: string | null }[]>(
          'GET',
          '/api/core/jobs?module=youtube-stats',
        )
      ).body;
      if (jobs.length && jobs.every((j) => !['queued', 'running'].includes(j.status)))
        return jobs[0]!;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Synchronisation trop longue');
  };
  const sync = async () => {
    const started = await hub.request('POST', `${API}/sync`);
    expect(started.status).toBe(200);
    return waitJob();
  };

  beforeAll(async () => {
    google = await new FakeGoogle().start();
    process.env.TOOLBOX_YT_ANALYTICS_URL = `${google.base}/v2/reports`;
    dir = mkdtempSync(path.join(tmpdir(), 'toolbox-ys-'));
    const daily = (values: number[], from: number) =>
      Object.fromEntries(values.map((views, i) => [day(from + i), views]));
    google.videos = [
      {
        id: 'longvideo01',
        title: 'Thomas — Drop (clip)',
        publishedAt: `${day(-40)}T17:00:00Z`,
        durationSec: 200,
        shorts: false,
        daily: daily(Array(38).fill(20), -40),
      },
      {
        id: 'shortvideo1',
        title: 'Drop (1/4) #shorts',
        publishedAt: `${day(-39)}T17:00:00Z`,
        durationSec: 28,
        shorts: true,
        daily: daily(Array(37).fill(50), -39),
      },
      {
        id: 'outsideapp1',
        title: 'Nuit — session live',
        publishedAt: `${day(-20)}T17:00:00Z`,
        durationSec: 400,
        shorts: false,
        daily: daily(Array(18).fill(5), -20),
      },
    ];
    const track = (id: number, title: string): Track =>
      ({
        id,
        title,
        artist: 'Thomas',
        durationSec: 200,
        audioPath: path.join(dir, 'x.wav'),
        coverPath: null,
      }) as unknown as Track;
    const tracks = [track(1, 'Drop'), track(2, 'Nuit')];
    const library = fakeModule('music-library', ['musicLibrary'], (ctx) =>
      ctx.services.provide<Partial<MusicLibraryService>>('musicLibrary', {
        listTracks: () => tracks,
        getTrack: (id) => tracks.find((t) => t.id === id) ?? null,
      }),
    );
    const planner = fakeModule('release-planner', ['releasePlanner'], (ctx) =>
      ctx.services.provide<ReleasePlannerService>('releasePlanner', {
        listYouTubeItems: () => [
          {
            itemId: 1,
            trackId: 1,
            kind: 'video',
            position: 0,
            label: 'Vidéo YouTube',
            youtubeVideoId: 'longvideo01',
            scheduledAt: `${day(-40)}T17:00:00Z`,
            publishedAt: null,
            source: { type: 'video', videoId: 1 },
          },
          {
            itemId: 2,
            trackId: 1,
            kind: 'short',
            position: 1,
            label: 'Short 1',
            youtubeVideoId: 'shortvideo1',
            scheduledAt: `${day(-39)}T17:00:00Z`,
            publishedAt: null,
            source: { type: 'cover-reel', packItemId: 11 },
          },
        ],
        youtubeQuota: () => ({
          day: '2026-10-23',
          unitsPerDay: 10_000,
          used: {
            planner: quota.used,
            uploads: 2,
            byModule: { 'youtube-stats': recorded.reduce((s, r) => s + r.units, 0) },
            total: quota.used + recorded.reduce((s, r) => s + r.units, 0),
          },
          exhausted: quota.exhausted,
          exhaustedBy: null,
          uploadsActive: quota.uploadsActive,
          uploadsSoon: quota.uploadsSoon,
        }),
        recordYouTubeQuota: (moduleId, units, exhausted = false) => {
          expect(moduleId).toBe('youtube-stats');
          recorded.push({ units, exhausted });
        },
        quotaOrigin: () =>
          'Consommation du jour : 2 envoi(s) du Planning et 9500 unité(s) pour leurs suites, 3 unité(s) pour Stats YouTube.',
      }),
    );
    const packs = fakeModule('instagram-video', ['instagramPack'], (ctx) =>
      ctx.services.provide<Partial<InstagramPackService>>('instagramPack', {
        getItem: (id) => (id === 11 ? ({ id, startSec: 42, durationSec: 28 } as never) : null),
      }),
    );
    hub = await createTestHub({
      modules: [
        library,
        planner,
        packs,
        await loadModuleFolder(path.resolve(import.meta.dirname, '..')),
      ],
      host: createTestHost({ openExternal: async (url) => void opened.push(url) }),
      accountProviders: { google: google.provider },
    });
    await hub.request('PUT', '/api/core/settings/accounts', {
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
    });
  }, 60_000);

  afterAll(async () => {
    await hub.close();
    await google.stop();
    delete process.env.TOOLBOX_YT_ANALYTICS_URL;
    rmSync(dir, { recursive: true, force: true });
  });

  it('asks for the read-only statistics scopes, added to the existing ones', async () => {
    const before = await hub.request<{ account: { connected: boolean } }>('GET', `${API}/state`);
    expect(before.body.account.connected).toBe(false);
    expect((await hub.request<{ error: string }>('POST', `${API}/sync`)).body.error).toContain(
      'Connecte',
    );
    const pending = hub.request('POST', `${API}/account/connect`);
    for (let i = 0; i < 100 && opened.length === 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    const auth = new URL(opened[0]!);
    expect(auth.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    );
    expect(auth.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/youtube.readonly',
    );
    expect(auth.searchParams.get('include_granted_scopes')).toBe('true');
    expect(await google.consent(opened[0]!)).toBe(200);
    expect((await pending).status).toBe(200);
  });

  it('synchronises the channel and links the videos to the tracks', async () => {
    const job = await waitJob(); // the connection starts a sync by itself
    expect(job.error).toBeNull();
    expect(job.status).toBe('succeeded');
    const state = (
      await hub.request<{
        lastSync: { ok: boolean; message: string | null };
        channel: { title: string };
        reach: string;
      }>('GET', `${API}/state`)
    ).body;
    expect(state.lastSync.ok).toBe(true);
    expect(state.channel.title).toBe('Thomas');
    // Impressions refused by the API: said, and the CSV import is proposed.
    expect(state.reach).toBe('unavailable');
    expect(state.lastSync.message).toContain('CSV');

    const list = (
      await hub.request<{
        videos: {
          video: {
            id: string;
            kind: string;
            kindSource: string;
            origin: { trackId: number | null; label: string | null; excerptStart: number | null };
          };
        }[];
      }>('GET', `${API}/videos`)
    ).body.videos;
    const byId = Object.fromEntries(list.map((v) => [v.video.id, v.video]));
    expect(byId.shortvideo1).toMatchObject({
      kind: 'short',
      kindSource: 'api',
      origin: { trackId: 1, label: 'Short 1', excerptStart: 42 },
    });
    expect(byId.longvideo01!.origin.trackId).toBe(1);
    expect(byId.outsideapp1!.origin.trackId).toBeNull();

    const sheet = (
      await hub.request<{
        totals: Record<string, number | null>;
        retention: unknown[];
        breakdowns: Record<string, { key: string }[]>;
      }>('GET', `${API}/videos/shortvideo1`)
    ).body;
    expect(sheet.totals.views).toBeGreaterThan(1000);
    expect(sheet.totals.engagedViews).toBeGreaterThan(0);
    expect(sheet.retention).toHaveLength(100);
    expect(sheet.breakdowns.traffic!.map((b) => b.key)).toContain('SHORTS');
    expect(sheet.breakdowns.age_gender).toHaveLength(2);

    const track = (await hub.request<{ elements: { label: string }[] }>('GET', `${API}/tracks/1`))
      .body;
    expect(track.elements.map((e) => e.label)).toEqual(['Vidéo YouTube', 'Short 1']);
    const overview = (
      await hub.request<{ key: { subscribers: number; videos: number } }>('GET', `${API}/overview`)
    ).body;
    expect(overview.key).toMatchObject({ subscribers: 120, videos: 3 });
  });

  it('the next sync only fetches the last days again', async () => {
    const before = google.reports.length;
    await sync();
    const dayQueries = google.reports
      .slice(before)
      .filter((p) => p.get('dimensions') === 'day' && p.get('filters'));
    expect(dayQueries.length).toBeGreaterThan(0);
    for (const q of dayQueries) expect(q.get('startDate')! >= day(-10)).toBe(true);
    // Retention and breakdowns are not asked again before a week.
    expect(
      google.reports.slice(before).some((p) => p.get('dimensions') === 'elapsedVideoTimeRatio'),
    ).toBe(false);
  });

  it('Planning first: waits while uploads run, does the minimum when some are due soon', async () => {
    const lastSync = async () =>
      (
        await hub.request<{ lastSync: { ok: boolean; message: string; postponed?: boolean } }>(
          'GET',
          `${API}/state`,
        )
      ).body.lastSync;
    // Uploads running: no call to Google at all, tried again at the next tick.
    quota.uploadsActive = 1;
    const calls = google.reports.length;
    recorded.length = 0;
    await sync();
    expect(await lastSync()).toMatchObject({ ok: true, postponed: true });
    expect((await lastSync()).message).toMatch(
      /^Synchronisation reportée : 1 envoi\(s\) YouTube en cours/,
    );
    expect(google.reports.length).toBe(calls);
    expect(recorded).toEqual([]);
    quota.uploadsActive = 0;

    // Uploads due within 24 h: channel and list only, no per-video statistics.
    quota.uploadsSoon = 2;
    await sync();
    expect((await lastSync()).message).toMatch(/^Synchronisation minimale/);
    expect(
      google.reports.slice(calls).some((p) => (p.get('filters') ?? '').startsWith('video==')),
    ).toBe(false);
    quota.uploadsSoon = 0;
    // Every YouTube Data call is counted in the shared quota (1 unit each).
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.every((r) => r.units === 1 && !r.exhausted)).toBe(true);
  });

  it('never spends the reserve kept for the uploads, and says who used the quota', async () => {
    // 9,500 units used by the Planning, reserve 1,000: nothing left for the stats.
    quota.used = 9_500;
    recorded.length = 0;
    const job = await sync();
    expect(job.status).toBe('failed');
    const state = (
      await hub.request<{ lastSync: { ok: boolean; message: string } }>('GET', `${API}/state`)
    ).body;
    expect(state.lastSync.message).toMatch(
      /^Synchronisation arrêtée pour garder la réserve de quota des envois YouTube \(1000 unités\)\. Consommation du jour : 2 envoi\(s\) du Planning/,
    );
    expect(recorded).toEqual([]);
    // A smaller reserve lets it run.
    await hub.request('PUT', '/api/core/settings/youtube-stats', { quotaReserve: 0 });
    expect((await sync()).status).toBe('succeeded');
    await hub.request('PUT', '/api/core/settings/youtube-stats', { quotaReserve: 1000 });
    quota.used = 0;
  });

  it('imports impressions and click-through rate from a Studio export', async () => {
    const file = path.join(dir, 'Table data.csv');
    writeFileSync(
      file,
      'Contenu,Titre de la vidéo,Impressions,Taux de clics des impressions (%)\nTotal,,999,3\nlongvideo01,Drop,4000,"6,5"\nunknownvid1,X,5,1\n',
    );
    const result = await hub.request<{ report: { rows: number; matched: number }[] }>(
      'POST',
      `${API}/import`,
      { path: file },
    );
    expect(result.status).toBe(200);
    expect(result.body.report[0]).toMatchObject({ rows: 2, matched: 1 });
    const sheet = (
      await hub.request<{ totals: Record<string, number | null>; reach: string }>(
        'GET',
        `${API}/videos/longvideo01`,
      )
    ).body;
    expect(sheet.totals).toMatchObject({ impressions: 4000, ctr: 6.5 });
    expect(sheet.reach).toBe('csv');
    const bad = path.join(dir, 'autre.csv');
    writeFileSync(bad, 'Foo,Bar\n1,2\n');
    expect(
      (await hub.request<{ error: string }>('POST', `${API}/import`, { path: bad })).body.error,
    ).toContain('Contenu');
  });

  it('links a video published outside the app by hand (title suggestion)', async () => {
    const links = (
      await hub.request<{ videos: { id: string; suggestion: { id: number } | null }[] }>(
        'GET',
        `${API}/links`,
      )
    ).body;
    expect(links.videos.find((v) => v.id === 'outsideapp1')?.suggestion?.id).toBe(2);
    expect(
      (await hub.request('PUT', `${API}/videos/outsideapp1/link`, { trackId: 2 })).status,
    ).toBe(200);
    const sheet = (
      await hub.request<{ video: { origin: { link: string; trackId: number } } }>(
        'GET',
        `${API}/videos/outsideapp1`,
      )
    ).body;
    expect(sheet.video.origin).toMatchObject({ link: 'manual', trackId: 2 });
    expect(
      (await hub.request('PUT', `${API}/videos/outsideapp1/link`, { trackId: 99 })).status,
    ).toBe(404);
    await hub.request('PUT', `${API}/videos/outsideapp1/link`, { trackId: null });
  });

  it('stops cleanly on the quota and on an expired authorization', async () => {
    google.quotaExceeded = true;
    let job = await sync();
    expect(job.status).toBe('failed');
    let state = (
      await hub.request<{ lastSync: { ok: boolean; message: string } }>('GET', `${API}/state`)
    ).body;
    expect(state.lastSync).toMatchObject({ ok: false });
    expect(state.lastSync.message).toContain('Quota');
    // Who consumed the quota, and the Planning told it is exhausted.
    expect(state.lastSync.message).toContain('Consommation du jour : 2 envoi(s) du Planning');
    expect(recorded.at(-1)).toEqual({ units: 0, exhausted: true });
    google.quotaExceeded = false;

    google.refreshInvalid = true;
    google.expireToken();
    job = await sync();
    expect(job.status).toBe('failed');
    state = (
      await hub.request<{ lastSync: { ok: boolean; message: string } }>('GET', `${API}/state`)
    ).body;
    expect(state.lastSync.message.toLowerCase()).toMatch(/reconnect|expiré|autorisation/);
    google.refreshInvalid = false;
    // Data already synchronised is still there.
    expect(
      (await hub.request<{ videos: unknown[] }>('GET', `${API}/videos`)).body.videos,
    ).toHaveLength(3);
  });

  it('answers the assistant from the stored statistics, demo announced as such', async () => {
    const summary = await hub.hub.assistant.run('youtube-stats.channel-summary', { days: '28' });
    expect(summary).toMatchObject({
      status: 'done',
      message: expect.stringMatching(/^sur les 28 derniers jours, \d/),
    });
    expect(await hub.hub.assistant.run('youtube-stats.highlights', {})).toMatchObject({
      status: 'done',
    });
    await hub.request('PUT', '/api/core/settings/youtube-stats', { demoMode: true });
    const demo = await hub.hub.assistant.run('youtube-stats.channel-summary', {});
    expect(demo).toMatchObject({
      message: expect.stringMatching(/^Données de démo : /),
      data: { demo: true },
    });
    const track = await hub.hub.assistant.run('youtube-stats.track-stats', { track: 'aube' });
    expect(track).toMatchObject({
      status: 'done',
      message: expect.stringMatching(/^Données de démo : Aube : [\d ]+ vues en tout/),
    });
    await hub.request('PUT', '/api/core/settings/youtube-stats', { demoMode: false });
  });

  it('starts the sync by voice only with its own right (off by default)', async () => {
    expect(await hub.hub.assistant.run('youtube-stats.sync', {})).toMatchObject({
      status: 'forbidden',
      right: { id: 'youtube-stats.sync' },
    });
    hub.hub.assistant.setRight('youtube-stats.sync', true);
    try {
      // The account needs reconnecting after the previous test: said plainly.
      expect(await hub.hub.assistant.run('youtube-stats.sync', {})).toEqual({
        status: 'error',
        id: 'youtube-stats.sync',
        message: 'L’autorisation Google a expiré : reconnecte le compte.',
      });
    } finally {
      hub.hub.assistant.setRight('youtube-stats.sync', false);
    }
  });

  it('the demo is separate from the real data', async () => {
    await hub.request('PUT', '/api/core/settings/youtube-stats', { demoMode: true });
    const demo = (await hub.request<{ mode: string; videos: unknown[] }>('GET', `${API}/videos`))
      .body;
    expect(demo.mode).toBe('demo');
    expect(demo.videos.length).toBeGreaterThan(30);
    expect((await hub.request('POST', `${API}/import`, { path: 'x.csv' })).status).toBe(409);
    await hub.request('PUT', '/api/core/settings/youtube-stats', { demoMode: false });
    expect(
      (await hub.request<{ videos: unknown[] }>('GET', `${API}/videos`)).body.videos,
    ).toHaveLength(3);
  });
});
