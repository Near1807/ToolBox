// The module on a real hub (MODULES.md §8): versions imported and analysed in
// the background, cached by content, sections edited, versions compared,
// references, export, quick check, assistant (read only), watched folder (read
// only, off by default), attaching a free project to a track — with and
// without the Library.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { precheckTrack, type ModuleContext } from '@hub/sdk/backend';
import {
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { MasterAnalysisService } from '../contract';
import { decodeAnalysis } from '../shared/codec';
import { baseName } from '../backend/index';
import { noise, seconds, sine, writeWav } from './signals';

const API = '/api/modules/master-analysis';

function fakeLibrary(tracks: Track[]): DiscoveredModule {
  return {
    folder: 'music-library',
    manifest: {
      id: 'music-library',
      name: 'Bibliothèque',
      description: 'fake',
      version: '1.0.0',
      section: 'Tests',
      icon: '🧪',
      provides: { services: ['musicLibrary'] },
    },
    backend: {
      register: (ctx: ModuleContext) =>
        ctx.services.provide<Partial<MusicLibraryService>>('musicLibrary', {
          listTracks: () => tracks,
          getTrack: (id) => tracks.find((t) => t.id === id) ?? null,
          trackIdOf: (subject) => {
            const m = /^music-library:track:(\d+)$/.exec(subject);
            return m && tracks.some((t) => t.id === Number(m[1])) ? Number(m[1]) : null;
          },
          registerTrackInfo: () => () => {},
        }),
    },
  } as DiscoveredModule;
}

/** A small « master »: noise with a drop, optionally louder (dB) and with clipping. */
function master(file: string, options: { gain?: number; clip?: boolean } = {}) {
  const n = seconds(20);
  const g = 10 ** ((options.gain ?? 0) / 20);
  const l = noise(n, 1, true);
  const r = noise(n, 2, true);
  const sub = sine(n, 50, 0.3);
  for (let i = 0; i < n; i++) {
    const loud = i > seconds(8) ? 1 : 0.2;
    l[i] = (l[i]! * 0.3 * loud + sub[i]! * (loud === 1 ? 1 : 0)) * g;
    r[i] = (r[i]! * 0.3 * loud + sub[i]! * (loud === 1 ? 1 : 0)) * g;
  }
  if (options.clip) for (let i = seconds(12); i < seconds(12) + 30; i++) l[i] = r[i] = 1;
  writeWav(file, [l, r]);
}

describe('master-analysis on a hub', () => {
  let hub: TestHub;
  let dir: string;
  const tracks: Track[] = [];

  const waitJobs = async () => {
    for (let i = 0; i < 600; i++) {
      const jobs = (
        await hub.request<{ status: string }[]>('GET', '/api/core/jobs?module=master-analysis')
      ).body;
      if (jobs.every((j) => !['queued', 'running'].includes(j.status))) return jobs;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Analyse trop longue');
  };
  type State = {
    library: boolean;
    projects: {
      groupId: number;
      trackId: number | null;
      title: string;
      kind: string;
      suggestedTrack: { id: number } | null;
      versions: {
        id: number;
        name: string;
        status: string;
        identicalTo: string | null;
        summary: { integrated: number; clips: number } | null;
      }[];
    }[];
    profiles: { id: number; refs: { id: number; status: string }[] }[];
  };
  let consumer: ModuleContext | null = null;
  /** The service as another module sees it (ctx.services.optional). */
  const masterService = () => consumer!.services.optional<MasterAnalysisService>('masterAnalysis')!;
  const state = async () => (await hub.request<State>('GET', `${API}/state`)).body;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'toolbox-ma-'));
    master(path.join(dir, 'Obsidian v1.wav'));
    master(path.join(dir, 'Obsidian v2.wav'), { gain: 2, clip: true });
    tracks.push({
      id: 1,
      title: 'Obsidian',
      artist: 'Thomas',
      nicknames: [],
      audioPath: path.join(dir, 'Obsidian v1.wav'),
      coverPath: null,
    } as unknown as Track);
    hub = await createTestHub({
      modules: [
        fakeLibrary(tracks),
        await loadModuleFolder(path.resolve(import.meta.dirname, '..')),
        {
          folder: 'consumer',
          manifest: {
            id: 'consumer',
            name: 'consumer',
            description: 'fake',
            version: '1.0.0',
            section: 'Tests',
            icon: '🧪',
            dependsOn: { optionalServices: ['masterAnalysis'] },
          },
          backend: { register: (ctx: ModuleContext) => void (consumer = ctx) },
        } as DiscoveredModule,
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await hub.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a free analysis: copied, analysed in the background, measured', async () => {
    const res = await hub.request<{ groupId: number; versions: { id: number }[] }>(
      'POST',
      `${API}/versions`,
      {
        path: path.join(dir, 'Obsidian v1.wav'),
        groupName: 'Essai libre',
      },
    );
    expect(res.status).toBe(200);
    await waitJobs();
    const project = (await state()).projects.find((p) => p.groupId === res.body.groupId)!;
    expect(project).toMatchObject({ kind: 'free', title: 'Essai libre' });
    expect(project.versions[0]!.status).toBe('done');
    expect(project.versions[0]!.name).toMatch(/^v1 — \d\d\/\d\d$/);
    const analysis = await hub.request<{
      text: string;
      sections: { label: string }[];
      platforms: { name: string }[];
    }>('GET', `${API}/versions/${res.body.versions[0]!.id}/analysis`);
    const a = decodeAnalysis(analysis.body.text);
    expect(a.blocks).toBe(200);
    expect(analysis.body.sections.length).toBeGreaterThan(0);
    expect(analysis.body.platforms.map((p) => p.name)).toContain('Spotify');
  });

  it('a library track: « Analyser », same file = same version (no new analysis)', async () => {
    const service = masterService();
    const first = await service.analyseTrack(1);
    expect(first.reused).toBe(false);
    await waitJobs();
    const again = await service.analyseTrack(1);
    expect(again).toMatchObject({ reused: true, versionId: first.versionId });
    expect(service.trackStatus(1)).toMatchObject({
      versionName: expect.stringMatching(/^v1/),
      badge: expect.stringMatching(/LUFS · .* dBTP$/),
    });
    // The new file of the track: version 2, compared to version 1.
    tracks[0]!.audioPath = path.join(dir, 'Obsidian v2.wav');
    const second = await service.analyseTrack(1);
    expect(second.reused).toBe(false);
    await waitJobs();
    const project = (await state()).projects.find((p) => p.trackId === 1)!;
    expect(project.versions.map((v) => v.status)).toEqual(['done', 'done']);
    expect(project.versions[1]!.summary!.clips).toBeGreaterThan(0);
    const c = await hub.request<{
      offset: number;
      global: { integrated: number };
      map: { seconds: number };
    }>('GET', `${API}/compare?a=${first.versionId}&b=${second.versionId}`);
    expect(c.status).toBe(200);
    expect(c.body.offset).toBe(0);
    expect(c.body.global.integrated).toBeCloseTo(2, 0);
    expect(c.body.map.seconds).toBe(20);
    // The offset can be set by hand, and is kept.
    await hub.request('PUT', `${API}/versions/${second.versionId}/offset`, { offset: 0.25 });
    expect(
      (
        await hub.request<{ offset: number; manual: boolean }>(
          'GET',
          `${API}/compare?a=${first.versionId}&b=${second.versionId}`,
        )
      ).body,
    ).toMatchObject({ offset: 0.25, manual: true });
  });

  it('sections edited by hand, and back to the automatic ones', async () => {
    const v = (await state()).projects.find((p) => p.trackId === 1)!.versions[0]!;
    const edited = await hub.request<{ sections: { start: number; end: number; label: string }[] }>(
      'PUT',
      `${API}/versions/${v.id}/sections`,
      {
        sections: [
          { start: 0, end: 5, label: 'Intro' },
          { start: 9, end: 20, label: 'Drop' },
          { start: 5, end: 9, label: '' },
        ],
      },
    );
    expect(edited.body.sections).toEqual([
      { start: 0, end: 5, label: 'Intro' },
      { start: 5, end: 9, label: 'Partie' },
      { start: 9, end: 20, label: 'Drop' },
    ]);
    const reset = await hub.request<{ sections: unknown[] }>(
      'POST',
      `${API}/versions/${v.id}/sections/reset`,
    );
    expect(reset.body.sections.length).toBeGreaterThan(0);
  });

  it('quick check before a generation: facts, never blocking, cached', async () => {
    const service = masterService();
    const check = await service.quickCheck(path.join(dir, 'Obsidian v2.wav'), 1);
    expect(check.ok).toBe(false);
    expect(check.issues.map((i: { kind: string }) => i.kind)).toContain('clipping');
    expect(check.versionId).not.toBeNull();
    const started = Date.now();
    await service.quickCheck(path.join(dir, 'Obsidian v2.wav'), 1);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(
      (await service.quickCheck(path.join(dir, 'Obsidian v1.wav'))).issues.map(
        (i: { kind: string }) => i.kind,
      ),
    ).not.toContain('clipping');
  });

  it('generators: the check through the SDK, off with the setting, never an error', async () => {
    const track = { id: 1, audioPath: path.join(dir, 'Obsidian v2.wav') };
    const result = await precheckTrack(consumer!, track);
    expect(result.ok).toBe(false);
    expect(result.path).toMatch(/^\?project=\d+$/);
    await hub.request('PUT', '/api/core/settings/master-analysis', { precheck: false });
    expect(await precheckTrack(consumer!, track)).toMatchObject({ ok: true, issues: [] });
    await hub.request('PUT', '/api/core/settings/master-analysis', { precheck: true });
    // Without the module: nothing to say, the generation goes on.
    const alone = {
      services: { optional: () => undefined },
      logger: { warn: () => {} },
    } as unknown as ModuleContext;
    expect(await precheckTrack(alone, track)).toEqual({ ok: true, issues: [], path: null });
  });

  it('references: a profile, A/B gain at equal loudness, tonal balance per band', async () => {
    const profile = await hub.request<{ id: number }>('POST', `${API}/profiles`, { name: 'Club' });
    const ref = path.join(dir, 'Ref.wav');
    master(ref, { gain: -4 });
    await hub.request('POST', `${API}/profiles/${profile.body.id}/references`, { path: ref });
    await waitJobs();
    const v = (await state()).projects.find((p) => p.trackId === 1)!.versions[0]!;
    const c = await hub.request<{
      references: { gain: number }[];
      bands: { difference: number | null }[];
    }>('GET', `${API}/references/compare?version=${v.id}&profile=${profile.body.id}`);
    expect(c.status).toBe(200);
    // Same music 4 dB quieter: +4 dB for the reference's playback, same tonal balance.
    expect(c.body.references[0]!.gain).toBeCloseTo(4, 0);
    for (const b of c.body.bands) expect(Math.abs(b.difference ?? 0)).toBeLessThan(0.3);
    // The reference file itself is never touched.
    expect(statSync(ref).size).toBeGreaterThan(0);
  });

  it('export: an HTML report registered as a file of the project', async () => {
    const v = (await state()).projects.find((p) => p.trackId === 1)!.versions[1]!;
    const out = await hub.request<{ path: string; subject: string }>(
      'POST',
      `${API}/versions/${v.id}/export`,
    );
    expect(out.status).toBe(200);
    expect(out.body.subject).toBe('music-library:track:1');
    expect(path.basename(out.body.path)).toMatch(/^Analyse - Obsidian - v2.*\.html$/);
  });

  it('the assistant reads the measures (read only)', async () => {
    const status = await hub.hub.assistant.run('master-analysis.master-status', {
      track: 'obsidian',
    });
    expect(status).toMatchObject({
      status: 'done',
      message: expect.stringMatching(/^Obsidian, v2 — .* LUFS intégrés, crête vraie/),
    });
    expect(await hub.hub.assistant.run('master-analysis.master-peaks', {})).toMatchObject({
      status: 'done',
    });
    const compare = await hub.hub.assistant.run('master-analysis.master-compare', {
      track: 'Obsidian',
    });
    expect(compare).toMatchObject({
      status: 'done',
      message: expect.stringContaining('par rapport à v1'),
    });
    const actions = hub.hub.assistant.list().filter((a) => a.moduleId === 'master-analysis');
    expect(actions.every((a) => a.risk === 'read')).toBe(true);
  });

  it('a free project attached to the track: its versions follow (ctx.outputs)', async () => {
    const free = (await state()).projects.find((p) => p.kind === 'free')!;
    const res = await hub.request('POST', `${API}/groups/${free.groupId}/attach`, { trackId: 1 });
    expect(res.status).toBe(200);
    const after = await state();
    expect(after.projects.some((p) => p.groupId === free.groupId)).toBe(false);
    expect(after.projects.find((p) => p.trackId === 1)!.versions).toHaveLength(3);
  });

  it('watched folder: off by default; on, new files analysed as new versions, folder untouched', async () => {
    const watched = path.join(dir, 'exports');
    mkdirSync(watched);
    // (A content of its own: a file identical to one already analysed is skipped.)
    master(path.join(watched, 'Nuit v1.wav'), { gain: -1 });
    const before = readdirSync(watched).map((f) => [f, statSync(path.join(watched, f)).mtimeMs]);
    // Off: nothing happens.
    await hub.request('POST', `${API}/watch/scan`);
    expect((await state()).projects.some((p) => p.title.startsWith('Nuit'))).toBe(false);
    await hub.request('PUT', '/api/core/settings/master-analysis', {
      watchEnabled: true,
      watchFolder: watched,
    });
    await hub.request('POST', `${API}/watch/scan`);
    await waitJobs();
    master(path.join(watched, 'Nuit v2.wav'), { gain: 1 });
    utimesSync(path.join(watched, 'Nuit v2.wav'), new Date(), new Date(Date.now() + 1000));
    await hub.request('POST', `${API}/watch/scan`);
    await waitJobs();
    const nuit = (await state()).projects.find((p) => p.title.startsWith('Nuit'))!;
    expect(nuit.versions.map((v) => v.status)).toEqual(['done', 'done']);
    // The same file again: no new version.
    await hub.request('POST', `${API}/watch/scan`);
    expect((await state()).projects.find((p) => p.groupId === nuit.groupId)!.versions).toHaveLength(
      2,
    );
    // Read only: the first file is as it was, nothing added or removed.
    const now = readdirSync(watched).map((f) => [f, statSync(path.join(watched, f)).mtimeMs]);
    expect(now.filter(([f]) => f === 'Nuit v1.wav')).toEqual(before);
    expect(now.map(([f]) => f).sort()).toEqual(['Nuit v1.wav', 'Nuit v2.wav']);
    await hub.request('PUT', '/api/core/settings/master-analysis', { watchEnabled: false });
  });

  it('deleting a version sends its copy to the Recycle Bin and forgets it', async () => {
    const project = (await state()).projects.find((p) => p.trackId === 1)!;
    const last = project.versions.at(-1)!;
    expect((await hub.request('DELETE', `${API}/versions/${last.id}`)).status).toBe(200);
    expect((await state()).projects.find((p) => p.trackId === 1)!.versions).toHaveLength(2);
  });

  it('names of watched files', () => {
    expect(baseName('Obsidian v3 (master final).wav')).toBe('obsidian');
    expect(baseName('GrosKaillou_v12.flac')).toBe('groskaillou');
    expect(baseName('Nuit - 2026-10-24.wav')).toBe('nuit');
  });
});

describe('without the Library', () => {
  it('works on its own: free analyses only', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-ma2-'));
    const hub = await createTestHub({
      modules: [await loadModuleFolder(path.resolve(import.meta.dirname, '..'))],
    });
    try {
      master(path.join(dir, 'Seul.wav'));
      const res = await hub.request<{ groupId: number }>('POST', `${API}/versions`, {
        path: path.join(dir, 'Seul.wav'),
      });
      expect(res.status).toBe(200);
      for (let i = 0; i < 400; i++) {
        const jobs = (
          await hub.request<{ status: string }[]>('GET', '/api/core/jobs?module=master-analysis')
        ).body;
        if (jobs.every((j) => !['queued', 'running'].includes(j.status))) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const s = (
        await hub.request<{ library: boolean; projects: { versions: { status: string }[] }[] }>(
          'GET',
          `${API}/state`,
        )
      ).body;
      expect(s.library).toBe(false);
      expect(s.projects[0]!.versions[0]!.status).toBe('done');
    } finally {
      await hub.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
