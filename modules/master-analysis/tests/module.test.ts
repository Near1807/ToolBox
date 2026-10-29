// The module on a real hub (MODULES.md §8): versions imported and analysed in
// the background, cached by content, sections edited, versions compared,
// references, export, quick check, assistant (read only), watched folder (read
// only, off by default), attaching a free project to a track — with and
// without the Library.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { precheckTrack, type ModuleContext } from '@hub/sdk/backend';
import {
  createTestHost,
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

/** Reads a zip (central directory; stored or deflated entries) into texts. */
function unzip(file: string): Promise<Record<string, string>> {
  const buf = readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    at += 46 + nameLength + extra + comment;
  }
  return Promise.resolve(out);
}

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
        summary: { integrated: number; truePeak: number; clips: number } | null;
      }[];
    }[];
    profiles: { id: number; refs: { id: number; status: string }[] }[];
  };
  let consumer: ModuleContext | null = null;
  let saveTarget: string | null = null;
  const asked: { title: string; defaultPath?: string }[] = [];
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
      // « Enregistrer sous »: the test answers like the user (a path, or cancel).
      host: createTestHost({
        selectSaveFile: (options) => {
          asked.push(options);
          return Promise.resolve(saveTarget);
        },
      }),
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

  // Bug of v0.20: « Exporter (HTML) » wrote a file in the output folder and answered
  // nothing visible (no dialog, no message). Now: « Enregistrer sous », the path back.
  it('export: the HTML report goes through « Enregistrer sous », self-contained', async () => {
    const p = await state();
    const project = p.projects.find((x) => x.trackId === 1)!;
    const v = project.versions[1]!;
    const profile = p.profiles.find((x) => x.refs.some((r) => r.status === 'done'))!;
    const outputsBefore = (await hub.request<unknown[]>('GET', '/api/core/outputs')).body.length;
    saveTarget = path.join(dir, 'exports-user', 'rapport.html');
    const out = await hub.request<{ path?: string }>('POST', `${API}/versions/${v.id}/export`, {
      format: 'html',
      profileId: profile.id,
    });
    expect(out.status).toBe(200);
    expect(out.body.path).toBe(saveTarget);
    expect(asked.at(-1)!.title).toMatch(/rapport/);
    expect(path.basename(asked.at(-1)!.defaultPath!)).toBe(
      `Analyse - Obsidian - ${v.name.replace('/', '_')}.html`,
    );
    const html = readFileSync(saveTarget, 'utf8');
    // Self-contained: no script, no external resource, PNG images embedded.
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script|<canvas|<link |src="http|url\(/i);
    const images = [...html.matchAll(/<img src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/g)];
    expect(images.length).toBeGreaterThanOrEqual(7);
    for (const [, b64] of images)
      expect(Buffer.from(b64!, 'base64').subarray(1, 4).toString()).toBe('PNG');
    // Every number as text, with the comparisons.
    const m = v.summary!;
    const fr1 = (x: number, sign = false) =>
      `${sign && x > 0 ? '+' : ''}${x.toFixed(1).replace('.', ',').replace('-', '−')}`;
    expect(html).toContain(`${fr1(m.integrated)} LUFS`);
    expect(html).toContain(`${fr1(m.truePeak, true)} dBTP`);
    for (const title of [
      'Chiffres clés',
      'Normalisation des plateformes',
      'Repères',
      'Contrastes entre sections',
      `Écarts avec ${project.versions[0]!.name}`,
      'Écarts avec les références',
    ])
      expect(html).toContain(title);
    expect(html).toMatch(/Écrêtage[^<]*<\/td><td class="n">0:12/);
    // Not a file of the project: nothing added to ctx.outputs.
    expect((await hub.request<unknown[]>('GET', '/api/core/outputs')).body.length).toBe(
      outputsBefore,
    );
  });

  it('export: cancelling the dialog writes nothing', async () => {
    const v = (await state()).projects.find((p) => p.trackId === 1)!.versions[1]!;
    saveTarget = null;
    const out = await hub.request<{ cancelled?: boolean }>(
      'POST',
      `${API}/versions/${v.id}/export`,
      {
        format: 'html',
      },
    );
    expect(out.body).toEqual({ cancelled: true });
  });

  it('export: the Markdown summary has every key number', async () => {
    const p = await state();
    const v = p.projects.find((x) => x.trackId === 1)!.versions[1]!;
    const profile = p.profiles.find((x) => x.refs.some((r) => r.status === 'done'))!;
    const { text } = (
      await hub.request<{ text: string }>(
        'GET',
        `${API}/versions/${v.id}/summary?profile=${profile.id}`,
      )
    ).body;
    for (const part of [
      new RegExp(`^# Analyse du master — Obsidian — ${v.name}`),
      /Sonie intégrée -?−?\d+,\d LUFS · LRA/,
      /Crête vraie [+−]?\d+,\d dBTP/,
      /\d+ dépassement\(s\)/,
      /## Plateformes/,
      /## Bandes/,
      /## Sections/,
      /## Contrastes/,
      /- Écrêtage \(\d+\) : 0:12/,
      `## Écarts avec ${p.projects.find((x) => x.trackId === 1)!.versions[0]!.name}`,
      /## Écarts avec les références/,
    ])
      expect(text).toMatch(part);
    // Without anything to compare with: no such part.
    const alone = (
      await hub.request<{ text: string }>(
        'GET',
        `${API}/versions/${p.projects.find((x) => x.trackId === 1)!.versions[0]!.id}/summary`,
      )
    ).body.text;
    expect(alone).not.toMatch(/## Écarts/);
  });

  it('export: complete data (CSV + JSON) agree with the measures', async () => {
    const v = (await state()).projects.find((p) => p.trackId === 1)!.versions[1]!;
    saveTarget = path.join(dir, 'exports-user', 'données.zip');
    const out = await hub.request<{ path?: string }>('POST', `${API}/versions/${v.id}/export`, {
      format: 'data',
    });
    expect(out.body.path).toBe(saveTarget);
    expect(existsSync(saveTarget)).toBe(true);
    const files = await unzip(saveTarget);
    expect(Object.keys(files).sort()).toEqual(['LISEZMOI.txt', 'analyse.json', 'courbes.csv']);
    const json = JSON.parse(files['analyse.json']!) as {
      measures: { integrated: number; truePeak: number };
      durationSec: number;
      versions: { other: string } | null;
      sections: unknown[];
      markers: { kind: string }[];
    };
    const analysis = v.summary!;
    expect(json.measures.integrated).toBeCloseTo(analysis.integrated, 6);
    expect(json.measures.truePeak).toBeCloseTo(analysis.truePeak, 6);
    expect(json.versions?.other).toBe(
      (await state()).projects.find((p) => p.trackId === 1)!.versions[0]!.name,
    );
    expect(json.markers.some((x) => x.kind === 'clip')).toBe(true);
    const rows = files['courbes.csv']!.trim().split('\n');
    const head = rows[0]!.split(';');
    expect(head[0]).toBe('temps_s');
    expect(head).toContain('sonie_court_terme_lufs');
    // One row per 100 ms block.
    expect(rows.length - 1).toBe(Math.round(json.durationSec * 10));
    // The loudest true peak of the curve is the global one.
    const tp = head.indexOf('crete_vraie_dbtp');
    const peaks = rows.slice(1).map((r) => Number(r.split(';')[tp]) || -Infinity);
    expect(Math.max(...peaks)).toBeCloseTo(json.measures.truePeak, 2);
  });

  it('export: « virgule décimale » writes 1,5 instead of 1.5 (separator « ; »)', async () => {
    const v = (await state()).projects.find((p) => p.trackId === 1)!.versions[1]!;
    await hub.request('PUT', '/api/core/settings/master-analysis', { csvDecimalComma: true });
    saveTarget = path.join(dir, 'exports-user', 'données-fr.zip');
    await hub.request('POST', `${API}/versions/${v.id}/export`, { format: 'data' });
    await hub.request('PUT', '/api/core/settings/master-analysis', { csvDecimalComma: false });
    const files = await unzip(saveTarget);
    const row = files['courbes.csv']!.split('\n')[11]!.split(';');
    expect(row[0]).toBe('1,0');
    expect(row.every((cell) => !cell.includes('.'))).toBe(true);
    expect(row.some((cell) => /^-?\d+,\d{3}$/.test(cell))).toBe(true);
    expect(files['LISEZMOI.txt']).toContain('virgule décimale');
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
