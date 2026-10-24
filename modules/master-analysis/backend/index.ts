// « Analyse du master »: measures a master while it is being produced, never
// modifies it. Versions of a track (or of a free project) are copied into the
// module's folder, analysed in the background (cached by file content), and
// compared; references grouped in profiles; an optional watched folder (read
// only, off by default). Everything works without the other modules.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defineBackendModule,
  extractName,
  HttpError,
  matchByName,
  NotFoundError,
  requestBody,
  type ModuleContext,
  type OutputRecord,
} from '@hub/sdk/backend';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { MasterAnalysisService, MasterTrackStatus } from '../contract';
import { decodeAnalysis, encodeAnalysis } from '../shared/codec';
import { fr } from '../shared/format';
import {
  align,
  compareReferences,
  compareVersions,
  DEFAULT_PLATFORMS,
  loudnessCurve,
  measures,
  normalisation,
  parsePlatforms,
} from '../shared/measures';
import { normaliseSections } from '../shared/sections';
import {
  ANALYZER_VERSION,
  BLOCK,
  type Analysis,
  type QuickCheck,
  type Section,
} from '../shared/types';
import { analyseFile } from './analyze';
import { buildReport } from './report';
import { MasterStore, MIGRATION_V1, type GroupRow, type RefRow, type VersionRow } from './store';
import {
  badgeOf,
  describe,
  describeDifference,
  describePeaks,
  quickIssues,
  summaryOf,
} from './summary';

export const AUDIO_EXTENSIONS = ['.wav', '.flac', '.aif', '.aiff', '.mp3'];

const isAudio = (file: string) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase());

export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}

/** « Obsidian v3 (master final).wav » → « obsidian »: the name a watched file is grouped by. */
export function baseName(file: string): string {
  return path
    .basename(file, path.extname(file))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_.]+/g, ' ')
    .replace(/[([].*?[)\]]/g, ' ')
    .replace(/\b(?:v|version|mix|master|final|bounce|export|take)\s*\d*\b/g, ' ')
    .replace(/\b\d{4}[-_.]?\d{2}[-_.]?\d{2}\b/g, ' ')
    .replace(/[-_.]+\d+$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const subjectOf = (group: GroupRow) =>
  group.track_id !== null
    ? `music-library:track:${group.track_id}`
    : `master-analysis:group:${group.id}`;

export default defineBackendModule({
  migrations: [
    {
      version: 1,
      description: 'projects, versions, analyses, references, watched folder',
      up: MIGRATION_V1,
    },
  ],

  register(ctx: ModuleContext) {
    const store = new MasterStore(ctx);
    // Looked up at each use: the Library may load after this module (each one
    // uses the other's service, optionally).
    const lib = () => ctx.services.optional<MusicLibraryService>('musicLibrary');
    const threshold = () => ctx.settings.get<number>('overThreshold') ?? -1;
    const platforms = () => {
      const parsed = parsePlatforms(ctx.settings.get<string>('platforms') ?? DEFAULT_PLATFORMS);
      return parsed.length ? parsed : parsePlatforms(DEFAULT_PLATFORMS);
    };
    const ffmpeg = ctx.binaries.ffmpeg;
    const ffprobe = ctx.binaries.ffprobe;

    // Analyses on disk (recomputable cache, left out of the backups) ------------

    const analysisPath = (hash: string) => ctx.files.dataPath('analyses', `${hash}.json`);
    const decoded = new Map<string, Analysis>();
    const loadAnalysis = (hash: string): Analysis | null => {
      const cached = decoded.get(hash);
      if (cached) return cached;
      const file = analysisPath(hash);
      if (!existsSync(file)) return null;
      try {
        const analysis = decodeAnalysis(readFileSync(file, 'utf8'));
        if (analysis.analyzer !== ANALYZER_VERSION) return null;
        decoded.set(hash, analysis);
        // A few in memory (each is a few MB).
        if (decoded.size > 6) decoded.delete(decoded.keys().next().value!);
        return analysis;
      } catch (error) {
        ctx.logger.warn(`Analyse illisible (${hash.slice(0, 8)}) : elle sera refaite`, error);
        return null;
      }
    };
    const analysisText = (hash: string): string | null => {
      const file = analysisPath(hash);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    };
    /** The analysis of a file content: from the cache, or made now. */
    const analyse = async (
      file: string,
      hash: string,
      signal?: AbortSignal,
      progress?: (f: number) => void,
    ) => {
      const known = store.analysis(hash);
      const cached = known && known.analyzer === ANALYZER_VERSION ? loadAnalysis(hash) : null;
      if (cached) return { analysis: cached, reused: true };
      const analysis = await analyseFile({ ffmpeg, ffprobe, file, signal, onProgress: progress });
      mkdirSync(path.dirname(analysisPath(hash)), { recursive: true });
      writeFileSync(analysisPath(hash), encodeAnalysis(analysis));
      store.saveAnalysis(
        hash,
        ANALYZER_VERSION,
        summaryOf(analysis, threshold()),
        analysis.analysisMs,
      );
      decoded.set(hash, analysis);
      ctx.logger.info(
        `Analyse de ${path.basename(file)} : ${fr(analysis.blocks * BLOCK, 0)} s d’audio en ${fr(analysis.analysisMs / 1000)} s`,
      );
      return { analysis, reused: false };
    };
    const dropAnalysisIfUnused = (hash: string) => {
      if (store.hashUsed(hash)) return;
      store.forgetAnalysis(hash);
      decoded.delete(hash);
      rmSync(analysisPath(hash), { force: true });
    };

    // Files: copies of the imports (kind « source »), registered in ctx.outputs --

    const trackOf = (id: number | null): Track | null =>
      id === null ? null : (lib()?.getTrack(id) ?? null);
    const registerVersion = (v: VersionRow) => {
      const group = store.group(v.group_id);
      if (!group || !existsSync(v.file_path)) return;
      ctx.outputs.register({
        path: v.file_path,
        ref: `version:${v.id}`,
        parent: `group:${group.id}`,
        subject: subjectOf(group),
        label: `Master importé — ${v.name}`,
        kind: 'source',
        createdAt: v.created_at,
      });
    };
    const registerRef = (r: RefRow) => {
      if (!existsSync(r.file_path)) return;
      ctx.outputs.register({
        path: r.file_path,
        ref: `ref:${r.id}`,
        parent: `profile:${r.profile_id}`,
        subject: `master-analysis:profile:${r.profile_id}`,
        label: `Référence — ${r.name}`,
        kind: 'source',
        createdAt: r.created_at,
      });
    };
    for (const v of store.versions()) registerVersion(v);
    for (const r of store.refs()) registerRef(r);

    const copyIn = async (source: string, folder: 'files' | 'references') => {
      if (!existsSync(source)) throw new HttpError(400, 'Fichier introuvable');
      if (!isAudio(source))
        throw new HttpError(400, 'Format non pris en charge : WAV, FLAC, AIFF ou MP3.');
      const dir = ctx.files.dataPath(folder);
      mkdirSync(dir, { recursive: true });
      const stamp = Date.now().toString(36);
      const target = path.join(
        dir,
        `${stamp}-${path.basename(source).replace(/[^\w.\- ()]+/g, '_')}`,
      );
      await copyFile(source, target);
      return { target, hash: await hashFile(target), size: statSync(target).size };
    };

    // Analysis job ------------------------------------------------------------

    type JobInput = { target: 'version' | 'ref'; id: number; notify?: boolean };
    ctx.jobs.define<JobInput, { reused: boolean }>('analyse', async (job) => {
      const { target, id } = job.input;
      const row = target === 'version' ? store.version(id) : store.ref(id);
      if (!row) throw new Error('Élément supprimé entre-temps');
      const set = (fields: Partial<Pick<VersionRow, 'status' | 'error' | 'sections'>>) =>
        target === 'version' ? store.setVersion(id, fields) : store.setRef(id, fields);
      set({ status: 'running', error: null });
      try {
        const { analysis, reused } = await analyse(row.file_path, row.hash, job.signal, (f) =>
          job.progress(f, `Analyse de « ${row.name} »…`),
        );
        set({
          status: 'done',
          ...(row.sections ? {} : { sections: JSON.stringify(analysis.sectionsAuto) }),
        });
        if (target === 'version' && job.input.notify) notifyWatched(store.version(id)!);
        return { reused };
      } catch (error) {
        const cancelled = job.signal.aborted;
        set({
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? null : error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });

    const enqueue = (input: JobInput, name: string) => {
      const job = ctx.jobs.enqueue('analyse', input, { title: `Analyse du master — ${name}` });
      if (input.target === 'version')
        store.setVersion(input.id, { job_id: job.id, status: 'queued' });
      else store.setRef(input.id, { job_id: job.id, status: 'queued' });
      return job;
    };
    // Analyses interrupted by a closing of the app start again (reading only).
    const running = new Set(
      ctx.jobs
        .list()
        .filter((j) => ['queued', 'running'].includes(j.status))
        .map((j) => j.id),
    );
    for (const v of store.versions())
      if ((v.status === 'queued' || v.status === 'running') && !(v.job_id && running.has(v.job_id)))
        enqueue({ target: 'version', id: v.id }, v.name);
    for (const r of store.refs())
      if ((r.status === 'queued' || r.status === 'running') && !(r.job_id && running.has(r.job_id)))
        enqueue({ target: 'ref', id: r.id }, r.name);

    // DTOs ----------------------------------------------------------------------

    const versionDto = (v: VersionRow) => {
      const cached = store.analysis(v.hash);
      const same = store
        .versions(v.group_id)
        .find((o) => o.id !== v.id && o.hash === v.hash && o.number < v.number);
      return {
        id: v.id,
        groupId: v.group_id,
        number: v.number,
        name: v.name,
        originalName: v.original_name,
        source: v.source,
        status: v.status,
        error: v.error,
        jobId: v.job_id,
        createdAt: v.created_at,
        offset: v.align_offset,
        identicalTo: same ? same.name : null,
        exists: existsSync(v.file_path),
        audioUrl: ctx.files.mediaUrlIfExists(v.file_path),
        summary: v.status === 'done' && cached ? cached.summary : null,
        analysisMs: cached?.analysis_ms ?? null,
      };
    };
    const projectDto = (group: GroupRow) => {
      const track = trackOf(group.track_id);
      const suggested = trackOf(group.suggested_track_id);
      return {
        groupId: group.id,
        trackId: group.track_id,
        title: track?.title ?? group.name,
        artist: track?.artist ?? '',
        coverUrl: track ? ctx.files.mediaUrlIfExists(track.coverPath ?? '') : null,
        kind: group.track_id !== null ? ('track' as const) : ('free' as const),
        missingTrack: group.track_id !== null && Boolean(lib()) && !track,
        suggestedTrack: suggested ? { id: suggested.id, title: suggested.title } : null,
        versions: store.versions(group.id).map(versionDto),
      };
    };
    const refDto = (r: RefRow) => ({
      id: r.id,
      profileId: r.profile_id,
      name: r.name,
      originalName: r.original_name,
      status: r.status,
      error: r.error,
      jobId: r.job_id,
      exists: existsSync(r.file_path),
      audioUrl: ctx.files.mediaUrlIfExists(r.file_path),
      summary: r.status === 'done' ? (store.analysis(r.hash)?.summary ?? null) : null,
    });

    ctx.routes.get('/state', () => {
      const groups = store.groups();
      const withGroup = new Set(groups.map((g) => g.track_id).filter((id) => id !== null));
      return {
        library: Boolean(lib()),
        projects: groups.map(projectDto),
        // Library tracks not analysed yet (« Analyser »).
        tracks: (lib()?.listTracks() ?? [])
          .filter((t) => !withGroup.has(t.id))
          .map((t) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            coverUrl: ctx.files.mediaUrlIfExists(t.coverPath ?? ''),
          })),
        profiles: store.profiles().map((p) => ({ ...p, refs: store.refs(p.id).map(refDto) })),
        settings: { overThreshold: threshold(), platforms: platforms() },
        watch: watchState(),
      };
    });

    // Imports -----------------------------------------------------------------------

    const groupFor = (
      body: { groupId?: unknown; trackId?: unknown; groupName?: unknown },
      fallbackName: string,
    ) => {
      if (typeof body.groupId === 'number') {
        const group = store.group(body.groupId);
        if (!group) throw new HttpError(404, 'Projet introuvable');
        return group;
      }
      if (typeof body.trackId === 'number') {
        const track = trackOf(body.trackId);
        if (!track) throw new HttpError(404, 'Morceau introuvable');
        return store.ensureTrackGroup(track.id, track.title);
      }
      const name =
        typeof body.groupName === 'string' && body.groupName.trim()
          ? body.groupName.trim()
          : fallbackName;
      return store.createFreeGroup(name.slice(0, 80));
    };

    const addVersion = async (options: {
      source: string;
      group: GroupRow;
      origin: VersionRow['source'];
      name?: string;
      notify?: boolean;
    }) => {
      const copy = await copyIn(options.source, 'files');
      const version = store.addVersion({
        group_id: options.group.id,
        name: options.name,
        file_path: copy.target,
        original_name: path.basename(options.source),
        original_path: options.source,
        hash: copy.hash,
        size: copy.size,
        source: options.origin,
      });
      registerVersion(version);
      enqueue({ target: 'version', id: version.id, notify: options.notify }, version.name);
      return store.version(version.id)!;
    };

    ctx.routes.post('/versions', async (request) => {
      const body = requestBody(request);
      const files = (Array.isArray(body.paths) ? body.paths : [body.path]).filter(
        (p): p is string => typeof p === 'string' && p.length > 0,
      );
      if (files.length === 0) throw new HttpError(400, 'Choisis un fichier audio');
      const group = groupFor(body, path.basename(files[0]!, path.extname(files[0]!)));
      const added = [];
      for (const file of files)
        added.push(versionDto(await addVersion({ source: file, group, origin: 'import' })));
      return { groupId: group.id, versions: added };
    });

    /** The current file of a library track: a new version only when it changed. */
    const analyseTrack = async (trackId: number) => {
      const track = trackOf(trackId);
      if (!track) throw new HttpError(404, 'Morceau introuvable');
      if (!existsSync(track.audioPath))
        throw new HttpError(409, 'Le fichier audio du morceau est introuvable');
      const group = store.ensureTrackGroup(track.id, track.title);
      const hash = await hashFile(track.audioPath);
      const last = store.versions(group.id).at(-1);
      if (last && last.hash === hash)
        return { versionId: last.id, jobId: last.job_id, reused: true };
      const version = await addVersion({ source: track.audioPath, group, origin: 'library' });
      return { versionId: version.id, jobId: version.job_id, reused: false };
    };
    ctx.routes.post('/tracks/:id/analyse', (request) =>
      analyseTrack(Number((request.params as { id: string }).id)),
    );

    const versionParam = (request: { params: unknown }) => {
      const v = store.version(Number((request.params as { id: string }).id));
      if (!v) throw new HttpError(404, 'Version introuvable');
      return v;
    };

    ctx.routes.put('/versions/:id', (request) => {
      const v = versionParam(request);
      const { name } = requestBody(request);
      if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Nom vide');
      store.setVersion(v.id, { name: name.trim().slice(0, 80) });
      registerVersion(store.version(v.id)!);
      return versionDto(store.version(v.id)!);
    });

    ctx.routes.post('/versions/:id/retry', (request) => {
      const v = versionParam(request);
      if (!existsSync(v.file_path)) throw new HttpError(409, 'La copie du fichier a été supprimée');
      return enqueue({ target: 'version', id: v.id }, v.name);
    });

    ctx.routes.delete('/versions/:id', async (request) => {
      const v = versionParam(request);
      // The copy goes to the Recycle Bin; onRemoved forgets the version.
      const count = await ctx.outputs.delete({ ref: `version:${v.id}` });
      if (count === 0) forgetVersion(v);
      return { ok: true };
    });

    const forgetVersion = (v: VersionRow) => {
      store.deleteVersion(v.id);
      dropAnalysisIfUnused(v.hash);
      store.deleteGroupIfEmpty(v.group_id);
    };

    // Analysis, sections, comparison ---------------------------------------------------

    const loadVersion = (v: VersionRow): Analysis => {
      if (v.status !== 'done') throw new HttpError(409, 'Analyse pas encore terminée');
      const a = loadAnalysis(v.hash);
      if (!a) {
        enqueue({ target: 'version', id: v.id }, v.name);
        throw new HttpError(
          409,
          'Analyse à refaire (nouvelle version de l’outil) : elle est relancée.',
        );
      }
      return a;
    };
    const sectionsOf = (row: VersionRow | RefRow, a: Analysis): Section[] =>
      store.sectionsOf(row) ?? a.sectionsAuto;

    ctx.routes.get('/versions/:id/analysis', (request) => {
      const v = versionParam(request);
      const a = loadVersion(v);
      return {
        text: analysisText(v.hash),
        sections: sectionsOf(v, a),
        autoSections: a.sectionsAuto,
        version: versionDto(v),
        platforms: normalisation(measures(a), platforms()),
        threshold: threshold(),
      };
    });

    ctx.routes.put('/versions/:id/sections', (request) => {
      const v = versionParam(request);
      const a = loadVersion(v);
      const { sections } = requestBody(request);
      if (!Array.isArray(sections)) throw new HttpError(400, 'Sections invalides');
      const clean = normaliseSections(sections as Section[], a.blocks * BLOCK);
      store.setVersion(v.id, { sections: JSON.stringify(clean) });
      return { sections: clean };
    });
    ctx.routes.post('/versions/:id/sections/reset', (request) => {
      const v = versionParam(request);
      const a = loadVersion(v);
      store.setVersion(v.id, { sections: JSON.stringify(a.sectionsAuto) });
      return { sections: a.sectionsAuto };
    });

    /** Short-term loudness of both versions every 0.5 s, b moved by the offset (overlaid curves). */
    const overlay = (a: Analysis, b: Analysis, offset: number) => {
      const la = loudnessCurve(a, 'short');
      const lb = loudnessCurve(b, 'short');
      const shift = Math.round(offset / BLOCK);
      const out: { t: number; a: number | null; b: number | null }[] = [];
      for (let i = 0; i < la.length; i += 5)
        out.push({ t: i * BLOCK, a: la[i] ?? null, b: lb[i + shift] ?? null });
      return out;
    };
    /** b against a; the offset stored on b when a is its previous version. */
    const comparison = (a: VersionRow, b: VersionRow, forced: number | null) => {
      const aa = loadVersion(a);
      const bb = loadVersion(b);
      const auto = align(aa, bb);
      const previous = store
        .versions(b.group_id)
        .filter((x) => x.number < b.number)
        .at(-1);
      const stored = previous?.id === a.id ? b.align_offset : null;
      const offset = forced ?? stored ?? auto.offset;
      return {
        a: versionDto(a),
        b: versionDto(b),
        auto,
        manual: forced !== null || stored !== null,
        measures: { a: measures(aa), b: measures(bb) },
        overlay: overlay(aa, bb, forced ?? stored ?? auto.offset),
        ...compareVersions(aa, bb, offset, sectionsOf(a, aa)),
      };
    };
    ctx.routes.get('/compare', (request) => {
      const q = request.query as { a?: string; b?: string; offset?: string };
      const a = store.version(Number(q.a));
      const b = store.version(Number(q.b));
      if (!a || !b) throw new HttpError(404, 'Version introuvable');
      const offset = q.offset !== undefined && q.offset !== '' ? Number(q.offset) : null;
      if (offset !== null && !Number.isFinite(offset))
        throw new HttpError(400, 'Décalage invalide');
      return comparison(a, b, offset);
    });
    ctx.routes.put('/versions/:id/offset', (request) => {
      const v = versionParam(request);
      const { offset } = requestBody(request);
      if (
        offset !== null &&
        (typeof offset !== 'number' || !Number.isFinite(offset) || Math.abs(offset) > 120)
      )
        throw new HttpError(400, 'Décalage invalide (secondes, ±120 au plus)');
      store.setVersion(v.id, { align_offset: offset as number | null });
      return versionDto(store.version(v.id)!);
    });

    // Projects ---------------------------------------------------------------------------

    const groupParam = (request: { params: unknown }) => {
      const g = store.group(Number((request.params as { id: string }).id));
      if (!g) throw new HttpError(404, 'Projet introuvable');
      return g;
    };
    ctx.routes.put('/groups/:id', (request) => {
      const g = groupParam(request);
      const { name } = requestBody(request);
      if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Nom vide');
      store.renameGroup(g.id, name.trim().slice(0, 80));
      return projectDto(store.group(g.id)!);
    });
    /** A free project attached to a library track: through ctx.outputs (the « Rattacher » of the hub). */
    ctx.routes.post('/groups/:id/attach', (request) => {
      const g = groupParam(request);
      const { trackId } = requestBody(request);
      const track = typeof trackId === 'number' ? trackOf(trackId) : null;
      if (!track) throw new HttpError(404, 'Morceau introuvable');
      const ids = ctx.outputs.list({ parent: `group:${g.id}` }).map((r) => r.id);
      if (ids.length) ctx.outputs.attach(ids, `music-library:track:${track.id}`);
      else moveGroupToTrack(g, track.id);
      return { ok: true, groupId: store.groupOfTrack(track.id)?.id ?? null };
    });

    const moveGroupToTrack = (g: GroupRow, trackId: number) => {
      const target = store.groupOfTrack(trackId);
      if (target && target.id !== g.id) store.mergeGroups(g.id, target.id);
      else store.setGroupTrack(g.id, trackId);
    };

    // Rattachement (hub « Sans projet » or the button above): the module moves its rows.
    ctx.outputs.onReattach((records: OutputRecord[], subject: string) => {
      const trackId = lib()?.trackIdOf(subject) ?? null;
      const free = /^master-analysis:group:(\d+)$/.exec(subject);
      for (const record of records) {
        if (record.ref.startsWith('report:')) continue;
        if (record.ref.startsWith('ref:'))
          throw new HttpError(409, 'Une référence reste dans son profil de références.');
        const v = store.version(Number(record.ref.slice('version:'.length)));
        if (!v) continue;
        let target: GroupRow | null = null;
        if (trackId !== null)
          target = store.ensureTrackGroup(trackId, trackOf(trackId)?.title ?? `Morceau ${trackId}`);
        else if (free) target = store.group(Number(free[1]));
        if (!target)
          throw new HttpError(409, 'Un master se rattache à un morceau de la Bibliothèque.');
        const from = v.group_id;
        if (target.id !== from) {
          const number = store.nextNumber(target.id);
          ctx.db
            .prepare(`UPDATE ${store.t.versions} SET group_id = ?, number = ? WHERE id = ?`)
            .run(target.id, number, v.id);
        }
        ctx.outputs.register({
          path: record.path,
          ref: record.ref,
          parent: `group:${target.id}`,
          subject: subjectOf(target),
          label: record.label,
          kind: 'source',
        });
        if (target.id !== from) store.deleteGroupIfEmpty(from);
      }
    });

    ctx.outputs.onRemoved((records) => {
      for (const record of records) {
        if (record.ref.startsWith('version:')) {
          const v = store.version(Number(record.ref.slice('version:'.length)));
          if (v) forgetVersion(v);
        } else if (record.ref.startsWith('ref:')) {
          const r = store.ref(Number(record.ref.slice('ref:'.length)));
          if (r) {
            store.deleteRef(r.id);
            dropAnalysisIfUnused(r.hash);
          }
        }
      }
    });

    // References -------------------------------------------------------------------------

    ctx.routes.post('/profiles', (request) => {
      const { name } = requestBody(request);
      if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Nom du profil vide');
      if (store.profiles().some((p) => p.name.toLowerCase() === name.trim().toLowerCase()))
        throw new HttpError(409, 'Un profil porte déjà ce nom');
      return store.addProfile(name.trim().slice(0, 60));
    });
    const profileParam = (request: { params: unknown }) => {
      const p = store.profile(Number((request.params as { id: string }).id));
      if (!p) throw new HttpError(404, 'Profil introuvable');
      return p;
    };
    ctx.routes.put('/profiles/:id', (request) => {
      const p = profileParam(request);
      const { name } = requestBody(request);
      if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Nom du profil vide');
      store.renameProfile(p.id, name.trim().slice(0, 60));
      return store.profile(p.id);
    });
    ctx.routes.delete('/profiles/:id', async (request) => {
      const p = profileParam(request);
      // Its copies go to the Recycle Bin (the original files are never touched).
      await ctx.outputs.delete({ parent: `profile:${p.id}` });
      for (const r of store.refs(p.id)) {
        store.deleteRef(r.id);
        dropAnalysisIfUnused(r.hash);
      }
      store.deleteProfile(p.id);
      return { ok: true };
    });
    ctx.routes.post('/profiles/:id/references', async (request) => {
      const p = profileParam(request);
      const body = requestBody(request);
      const files = (Array.isArray(body.paths) ? body.paths : [body.path]).filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      );
      if (!files.length) throw new HttpError(400, 'Choisis un fichier audio');
      const added = [];
      for (const file of files) {
        const copy = await copyIn(file, 'references');
        const r = store.addRef({
          profile_id: p.id,
          name: path.basename(file, path.extname(file)).slice(0, 80),
          file_path: copy.target,
          original_name: path.basename(file),
          hash: copy.hash,
        });
        registerRef(r);
        enqueue({ target: 'ref', id: r.id }, r.name);
        added.push(refDto(store.ref(r.id)!));
      }
      return { references: added };
    });
    ctx.routes.delete('/references/:id', async (request) => {
      const r = store.ref(Number((request.params as { id: string }).id));
      if (!r) throw new HttpError(404, 'Référence introuvable');
      const count = await ctx.outputs.delete({ ref: `ref:${r.id}` });
      if (count === 0) {
        store.deleteRef(r.id);
        dropAnalysisIfUnused(r.hash);
      }
      return { ok: true };
    });
    ctx.routes.get('/references/compare', (request) => {
      const q = request.query as { version?: string; profile?: string };
      const v = store.version(Number(q.version));
      const p = store.profile(Number(q.profile));
      if (!v || !p) throw new HttpError(404, 'Version ou profil introuvable');
      const a = loadVersion(v);
      const refs = store
        .refs(p.id)
        .filter((r) => r.status === 'done')
        .flatMap((r) => {
          const analysis = loadAnalysis(r.hash);
          return analysis
            ? [{ row: r, name: r.name, analysis, sections: sectionsOf(r, analysis) }]
            : [];
        });
      if (!refs.length) throw new HttpError(409, 'Aucune référence analysée dans ce profil');
      const result = compareReferences({ analysis: a, sections: sectionsOf(v, a) }, refs);
      return {
        ...result,
        references: refs.map((r) => ({
          ...refDto(r.row),
          gain: result.gainToMatch.find((g) => g.name === r.name)?.gain ?? 0,
        })),
      };
    });

    // Export (HTML report, a generated file of the project) -------------------------------

    ctx.routes.post('/versions/:id/export', (request) => {
      const v = versionParam(request);
      const a = loadVersion(v);
      const group = store.group(v.group_id)!;
      const title = trackOf(group.track_id)?.title ?? group.name;
      const previous = store
        .versions(v.group_id)
        .filter((x) => x.number < v.number && x.status === 'done')
        .at(-1);
      const html = buildReport({
        title,
        version: v.name,
        analysis: a,
        sections: sectionsOf(v, a),
        threshold: threshold(),
        platforms: normalisation(measures(a), platforms()),
        previous: previous
          ? { name: previous.name, comparison: comparison(previous, v, null) }
          : null,
      });
      const safe = `${title} - ${v.name}`.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120);
      const file = path.join(ctx.files.outputDir(), `Analyse - ${safe}.html`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, html);
      return ctx.outputs.register({
        path: file,
        ref: `report:${v.id}`,
        parent: `group:${group.id}`,
        subject: subjectOf(group),
        label: `Rapport d’analyse — ${v.name}`,
      });
    });

    // Quick check before a generation (service) -----------------------------------------

    const quickCheck = async (
      audioPath: string,
      trackId: number | null = null,
    ): Promise<QuickCheck> => {
      if (ctx.settings.get<boolean>('precheck') === false)
        return { ok: true, issues: [], versionId: null, measuredAt: new Date().toISOString() };
      if (!existsSync(audioPath))
        return { ok: true, issues: [], versionId: null, measuredAt: new Date().toISOString() };
      const hash = await hashFile(audioPath);
      const { analysis } = await analyse(audioPath, hash);
      const issues = quickIssues(analysis);
      const group = trackId !== null ? store.groupOfTrack(trackId) : null;
      const version = group
        ? (store
            .versions(group.id)
            .filter((v) => v.hash === hash)
            .at(-1) ?? null)
        : null;
      return {
        ok: issues.length === 0,
        issues,
        versionId: version?.id ?? null,
        measuredAt: new Date().toISOString(),
      };
    };
    ctx.routes.post('/quick-check', async (request) => {
      const { path: file, trackId } = requestBody(request);
      if (typeof file !== 'string') throw new HttpError(400, 'Chemin manquant');
      return quickCheck(file, typeof trackId === 'number' ? trackId : null);
    });

    const trackStatus = (trackId: number): MasterTrackStatus | null => {
      const group = store.groupOfTrack(trackId);
      const v = group ? store.versions(group.id).at(-1) : null;
      if (!v) return null;
      const summary = v.status === 'done' ? store.analysis(v.hash)?.summary : null;
      return {
        versionId: v.id,
        versionName: v.name,
        status: v.status,
        analysedAt: v.created_at,
        badge: summary ? badgeOf(summary) : null,
        overs: summary?.overs.length ?? 0,
        clips: summary?.clips ?? 0,
      };
    };

    const pagePath = (trackId: number | null) => {
      const group = trackId !== null ? store.groupOfTrack(trackId) : null;
      return group ? `?project=${group.id}` : trackId !== null ? `?track=${trackId}` : '';
    };
    ctx.services.provide<MasterAnalysisService>('masterAnalysis', {
      analyseTrack,
      trackStatus,
      quickCheck,
      pagePath,
    });
    // Watched folder (off by default, read only) ------------------------------------------

    const watch = {
      lastScan: null as string | null,
      error: null as string | null,
      pending: new Map<string, { size: number; mtime: number }>(),
    };
    function watchState() {
      return {
        enabled: ctx.settings.get<boolean>('watchEnabled') === true,
        folder: ctx.settings.get<string>('watchFolder') ?? '',
        lastScan: watch.lastScan,
        error: watch.error,
      };
    }
    const groupForWatched = (file: string): GroupRow => {
      const key = baseName(file);
      const groups = store.groups();
      const fold = (s: string) => baseName(`${s}.x`);
      const same = groups.find(
        (g) => fold(g.name) === key || fold(trackOf(g.track_id)?.title ?? '') === key,
      );
      if (same) return same;
      const tracks = lib()?.listTracks() ?? [];
      const match = key ? matchByName(tracks, key, (t) => [t.title, ...(t.nicknames ?? [])]) : null;
      const suggested = match?.kind === 'match' ? match.item.id : null;
      return store.createFreeGroup(path.basename(file, path.extname(file)).slice(0, 80), suggested);
    };
    const scanFolder = async () => {
      const state = watchState();
      if (!state.enabled || !state.folder) return;
      watch.lastScan = new Date().toISOString();
      let names: string[];
      try {
        names = readdirSync(state.folder);
        watch.error = null;
      } catch (error) {
        watch.error = `Dossier illisible : ${error instanceof Error ? error.message : String(error)}`;
        return;
      }
      for (const name of names) {
        const file = path.join(state.folder, name);
        if (!isAudio(file)) continue;
        let stats;
        try {
          stats = statSync(file);
        } catch {
          continue;
        }
        if (!stats.isFile()) continue;
        const seen = store.seen(file);
        if (seen && seen.size === stats.size && seen.mtime === stats.mtimeMs) continue;
        // Still being written? Taken once it has not changed between two scans.
        const pending = watch.pending.get(file);
        if (!pending || pending.size !== stats.size || pending.mtime !== stats.mtimeMs) {
          watch.pending.set(file, { size: stats.size, mtime: stats.mtimeMs });
          continue;
        }
        watch.pending.delete(file);
        try {
          const hash = await hashFile(file);
          if (seen?.hash === hash || store.versionsWithHash(hash).length) {
            store.markSeen(file, stats.size, stats.mtimeMs, hash, seen?.version_id ?? null);
            continue;
          }
          const group = groupForWatched(file);
          const version = await addVersion({ source: file, group, origin: 'watch', notify: true });
          store.markSeen(file, stats.size, stats.mtimeMs, hash, version.id);
          ctx.logger.info(`Dossier surveillé : « ${name} » → ${version.name} (${group.name})`);
        } catch (error) {
          ctx.logger.warn(`Dossier surveillé : « ${name} » ignoré`, error);
        }
      }
    };
    ctx.scheduler.schedule('watch-folder', { everyMinutes: 1 }, scanFolder);
    ctx.routes.post('/watch/scan', async () => {
      await scanFolder();
      await scanFolder();
      return watchState();
    });

    function notifyWatched(v: VersionRow) {
      if (ctx.settings.get<boolean>('watchNotify') === false) return;
      const group = store.group(v.group_id);
      if (!group) return;
      const title = trackOf(group.track_id)?.title ?? group.name;
      const summary = store.analysis(v.hash)?.summary;
      const previous = store
        .versions(group.id)
        .filter((x) => x.number < v.number && x.status === 'done')
        .at(-1);
      let body = summary
        ? `${fr(summary.integrated)} LUFS, crête vraie ${fr(summary.truePeak, 1, true)} dBTP.`
        : 'Analyse terminée.';
      if (previous) {
        try {
          const c = comparison(previous, v, null);
          body = describeDifference(previous.name, v.name, c.global, c.offset);
        } catch {
          // Comparison unavailable: the summary is enough.
        }
      }
      ctx.notifications.notify({
        title: `${title} — ${v.name} analysée`,
        body,
        path: `?project=${group.id}&version=${v.id}`,
      });
    }

    // Assistant (read only) -----------------------------------------------------------------

    const latestDone = (g: GroupRow) => store.versions(g.id).filter((v) => v.status === 'done');
    const projectByName = (name: string | undefined) => {
      const groups = store.groups().filter((g) => latestDone(g).length > 0);
      if (!groups.length) throw new HttpError(409, 'Aucun master analysé pour l’instant.');
      if (!name) {
        // The most recently analysed.
        return groups.sort((a, b) =>
          latestDone(b).at(-1)!.created_at.localeCompare(latestDone(a).at(-1)!.created_at),
        )[0]!;
      }
      const names = (g: GroupRow) => {
        const track = trackOf(g.track_id);
        return track ? [track.title, ...(track.nicknames ?? []), g.name] : [g.name];
      };
      const found = matchByName(groups, name, names);
      if (found.kind === 'match') return found.item;
      if (found.kind === 'ambiguous')
        throw new HttpError(409, `Plusieurs projets ressemblent à « ${name} ».`);
      throw new NotFoundError(
        'track',
        'de master analysé pour',
        name,
        found.suggestions.map((g) => names(g)[0]!),
      );
    };
    const titleOf = (g: GroupRow) => trackOf(g.track_id)?.title ?? g.name;
    const PREFIXES = {
      status: [
        /(?:comment est|comment sonne|c[’']est comment|analyse|l[’']analyse|les mesures)(?: du| de| d[’'])?(?: le| la)? master(?: de| du| d[’'])?/iu,
      ],
      peaks: [
        /(?:o[uù] sont|montre|quelles sont)(?: les)? (?:cr[eê]tes|pics|d[eé]passements)(?: de| du| d[’']| dans| sur)?/iu,
      ],
      compare: [/compare(?:r)?(?: les)?(?: deux)? derni[eè]res versions(?: de| du| d[’'])?/iu],
    };
    const trackParam = {
      track: { type: 'string' as const, description: 'Morceau (facultatif : le dernier analysé)' },
    };
    ctx.assistant.define({
      name: 'master-status',
      label: 'Mesures du master d’un morceau',
      description:
        'Donne les mesures du dernier master analysé d’un morceau : sonie intégrée, crête vraie, PLR, LRA, dépassements, écrêtages, corrélation.',
      parameters: trackParam,
      examples: [
        'comment est le master d’Obsidian',
        'analyse du master',
        'comment sonne le master de Aube',
        'les mesures du master',
      ],
      extract: (u) => {
        if (!/master/i.test(u)) return null;
        const name = extractName(u, PREFIXES.status);
        return name ? { track: name } : {};
      },
      risk: 'read',
      run: (params) => {
        const g = projectByName(typeof params.track === 'string' ? params.track : undefined);
        const v = latestDone(g).at(-1)!;
        const s = store.analysis(v.hash)!.summary;
        return {
          message: describe(titleOf(g), v.name, s, threshold()),
          data: { versionId: v.id, summary: s },
        };
      },
    });
    ctx.assistant.define({
      name: 'master-peaks',
      label: 'Où sont les crêtes',
      description:
        'Liste les passages où la crête vraie dépasse le seuil réglé, dans le dernier master analysé d’un morceau.',
      parameters: trackParam,
      examples: [
        'où sont les crêtes',
        'où sont les crêtes d’Obsidian',
        'montre les dépassements',
        'quelles sont les crêtes du master',
      ],
      extract: (u) => {
        if (!/cr[eê]tes|pics|d[eé]passements/i.test(u)) return null;
        const name = extractName(u, PREFIXES.peaks)?.replace(
          /^(?:le |du )?master\s*(?:de |d[’'])?/i,
          '',
        );
        return name ? { track: name } : {};
      },
      risk: 'read',
      run: (params) => {
        const g = projectByName(typeof params.track === 'string' ? params.track : undefined);
        const v = latestDone(g).at(-1)!;
        const s = store.analysis(v.hash)!.summary;
        return {
          message: describePeaks(titleOf(g), s, threshold()),
          data: { versionId: v.id, overs: s.overs },
        };
      },
    });
    ctx.assistant.define({
      name: 'master-compare',
      label: 'Comparer les deux dernières versions',
      description:
        'Compare les deux dernières versions analysées d’un morceau (alignées dans le temps) : sonie, crête, dynamique, bandes.',
      parameters: trackParam,
      examples: [
        'compare les deux dernières versions',
        'compare les deux dernières versions d’Obsidian',
        'comparer les dernières versions du master',
      ],
      extract: (u) => {
        if (!/compar/i.test(u) || !/version/i.test(u)) return null;
        const name = extractName(u, PREFIXES.compare);
        return name ? { track: name } : {};
      },
      risk: 'read',
      run: (params) => {
        const g = projectByName(typeof params.track === 'string' ? params.track : undefined);
        const done = latestDone(g);
        if (done.length < 2)
          return { message: `${titleOf(g)} n’a qu’une version analysée.`, data: null };
        const [a, b] = done.slice(-2) as [VersionRow, VersionRow];
        const c = comparison(a, b, null);
        return {
          message: `${titleOf(g)} : ${describeDifference(a.name, b.name, c.global, c.offset)}`,
          data: { a: a.id, b: b.id },
        };
      },
    });
  },
});
