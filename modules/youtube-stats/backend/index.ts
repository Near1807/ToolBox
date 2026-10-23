// youtube-stats: every statistic of the YouTube channel in one place, crossed
// with what ToolBox knows (tracks, Shorts, excerpts, effects, publication
// times, energy of the music). Real data (Google account of ctx.accounts,
// read-only scopes added incrementally) or a demo channel.
import {
  AccountError,
  defineBackendModule,
  HttpError,
  requestBody,
  type ModuleContext,
} from '@hub/sdk/backend';
import type { CustomReelsService } from '../../custom-reels/contract';
import type { InstagramPackService } from '../../instagram-video/contract';
import type { MusicLibraryService } from '../../music-library/contract';
import type { ReleasePlannerService } from '../../release-planner/contract';
import type { VideoEngineService } from '../../video-engine/contract';
import { registerAssistantActions } from './assistant';
import { readExport, reachRows } from './csv';
import type { Dataset } from './dataset';
import { demoDataset } from './demo';
import {
  GoogleApiError,
  GoogleClient,
  hasStatsScopes,
  QuotaReserveError,
  STATS_SCOPES,
} from './google';
import { runLab, type LabResult } from './lab';
import { suggestTrack } from './linking';
import { addDay } from './stats';
import { MIGRATION_V1, StatsStore, type LinkServices } from './store';
import { syncChannel, type SyncSummary } from './sync';
import { generateTheories, updateJournal, type JournalEntry, type Theory } from './theories';
import {
  overview,
  parseFilters,
  trackDetail,
  trackList,
  videoDetail,
  videoList,
  visitMark,
  type VisitMark,
} from './views';

const GOOGLE = 'google';

/** YouTube publishes Analytics with a delay of 2–3 days: the last day considered complete. */
const lastCompleteDay = () => addDay(new Date().toISOString().slice(0, 10), -3);

interface Analysis {
  key: string;
  data: Dataset;
  lab: LabResult;
  theories: Theory[];
}

export default defineBackendModule({
  migrations: [{ version: 1, description: 'statistics tables', up: MIGRATION_V1 }],

  register(ctx: ModuleContext) {
    const store = new StatsStore(ctx);
    const services: LinkServices = {
      library: ctx.services.optional<MusicLibraryService>('musicLibrary'),
      planner: ctx.services.optional<ReleasePlannerService>('releasePlanner'),
      packs: ctx.services.optional<InstagramPackService>('instagramPack'),
      customReels: ctx.services.optional<CustomReelsService>('customReels'),
      coverUrl: (file) => ctx.files.mediaUrlIfExists(file),
    };
    const engine = ctx.services.optional<VideoEngineService>('videoEngine');

    const demoMode = () => ctx.settings.get<boolean>('demoMode') === true;
    const timeZone = () => {
      const value = ctx.settings.get<string>('timeZone') ?? 'Europe/Brussels';
      try {
        new Intl.DateTimeFormat('fr', { timeZone: value });
        return value;
      } catch {
        return 'Europe/Brussels';
      }
    };

    // Analyses are cached until the data changes (sync, link, import, demo switch).
    let version = 0;
    let cache: Analysis | null = null;
    let demoJournal: { day: string; entries: JournalEntry[] } | null = null;
    const invalidate = () => {
      version++;
      cache = null;
    };
    const analysis = (): Analysis => {
      const mode = demoMode() ? 'demo' : 'real';
      const key = `${mode}:${version}:${lastCompleteDay()}:${timeZone()}`;
      if (cache?.key === key) return cache;
      const data =
        mode === 'demo'
          ? { ...demoDataset(), timeZone: timeZone() }
          : store.dataset(services, { lastDay: lastCompleteDay(), timeZone: timeZone() });
      const lab = runLab(data);
      cache = { key, data, lab, theories: generateTheories(lab) };
      return cache;
    };

    /** The data as it was at a past day (videos and days after it removed). */
    const truncate = (data: Dataset, day: string): Dataset => ({
      ...data,
      lastDay: day,
      videos: data.videos.filter((v) => v.publishedAt.slice(0, 10) <= day),
      days: data.days.filter((d) => d.day <= day),
      channelDays: data.channelDays.filter((d) => d.day <= day),
      snapshots: data.snapshots.filter((s) => s.day <= day),
    });

    /** Journal recomputed afterwards at monthly steps, when it is empty. */
    const retroJournal = (data: Dataset): JournalEntry[] => {
      let entries: JournalEntry[] = [];
      const first = data.videos.map((v) => v.publishedAt.slice(0, 10)).sort()[0];
      if (!first) return entries;
      for (let day = addDay(first, 60); day < data.lastDay; day = addDay(day, 60)) {
        const past = truncate(data, day);
        entries = updateJournal(
          entries,
          generateTheories(runLab(past)),
          `${day}T12:00:00.000Z`,
          true,
        );
      }
      return entries;
    };

    const journal = (): JournalEntry[] => {
      const { data, theories } = analysis();
      if (data.mode === 'demo') {
        const today = new Date().toISOString().slice(0, 10);
        if (demoJournal?.day !== today) {
          demoJournal = {
            day: today,
            entries: updateJournal(retroJournal(data), theories, new Date().toISOString()),
          };
        }
        return demoJournal.entries;
      }
      return store.journal().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    };

    /** After a sync: one evaluation of the theories in the journal (history first if empty). */
    const evaluateTheories = () => {
      const { data, theories } = analysis();
      if (data.mode !== 'real') return;
      let entries = store.journal();
      if (entries.length === 0 && data.videos.length > 0) entries = retroJournal(data);
      store.saveJournal(updateJournal(entries, theories, new Date().toISOString()));
    };

    // The demo is computed in the background (start-up, switch) so its pages open at once.
    let warming: ReturnType<typeof setTimeout> | null = null;
    const warm = () => {
      if (warming || !demoMode()) return;
      warming = setTimeout(() => {
        warming = null;
        try {
          journal();
        } catch (error) {
          ctx.logger.warn('Préparation de la démo impossible', error);
        }
      }, 50);
      warming.unref?.();
    };
    ctx.settings.onChange((key) => {
      if (key === 'demoMode' || key === 'timeZone') {
        invalidate();
        warm();
      }
    });
    warm();
    ctx.onShutdown(() => {
      if (warming) clearTimeout(warming);
    });

    // Account ------------------------------------------------------------------

    const accountState = () => {
      if (!ctx.accounts.available) {
        return {
          connected: false,
          needsReconnect: false,
          scopesOk: false,
          configured: false,
          error: null,
        };
      }
      const status = ctx.accounts.status(GOOGLE);
      const scopes = hasStatsScopes(status.scopes);
      return {
        connected: status.connected,
        needsReconnect: status.needsReconnect,
        configured: status.configured,
        scopesOk: scopes.analytics && scopes.data,
        error: status.error,
      };
    };

    ctx.routes.post('/account/connect', async () => {
      try {
        await ctx.accounts.connect(GOOGLE, STATS_SCOPES);
      } catch (error) {
        if (error instanceof AccountError) throw new HttpError(409, error.message);
        throw error;
      }
      enqueueSync();
      return state();
    });

    // Synchronisation ----------------------------------------------------------

    const setLastSync = (value: {
      at: string;
      ok: boolean;
      message: string | null;
      summary: SyncSummary | null;
      /** Waiting for the uploads of the Planning: tried again at the next tick. */
      postponed?: boolean;
    }) => store.setMeta('lastSync', value);

    ctx.jobs.define<Record<string, never>, SyncSummary>('sync', async (job) => {
      // Planning first: the uploads have the YouTube quota before the statistics.
      const planner = services.planner;
      const outlook = planner?.youtubeQuota() ?? null;
      if (outlook && outlook.uploadsActive > 0) {
        const message = `Synchronisation reportée : ${outlook.uploadsActive} envoi(s) YouTube en cours (le Planning passe en premier). Nouvel essai dans 30 minutes.`;
        setLastSync({
          at: new Date().toISOString(),
          ok: true,
          message,
          summary: null,
          postponed: true,
        });
        ctx.logger.info(message);
        return {
          calls: 0,
          videos: 0,
          dayRows: 0,
          retention: 0,
          breakdowns: 0,
          warnings: [message],
        };
      }
      const reserve = ctx.settings.get<number>('quotaReserve') ?? 1000;
      // Units this sync may spend: never the reserve kept for the uploads.
      const budget = outlook ? outlook.unitsPerDay - outlook.used.total - reserve : Infinity;
      let spent = 0;
      const client = new GoogleClient((url, init) => ctx.accounts.fetch(GOOGLE, url, init), {
        before: () => {
          if (spent + 1 > budget)
            throw new QuotaReserveError(
              `Synchronisation arrêtée pour garder la réserve de quota des envois YouTube (${reserve} unités). ${planner?.quotaOrigin() ?? ''} Elle reprendra après la remise à zéro du quota (minuit, heure de Californie).`,
            );
        },
        after: (units) => {
          spent += units;
          planner?.recordYouTubeQuota(ctx.id, units);
        },
        exhausted: () => planner?.recordYouTubeQuota(ctx.id, 0, true),
      });
      try {
        const summary = await syncChannel(client, store, {
          minimal: Boolean(outlook && outlook.uploadsSoon > 0),
          lastDay: addDay(new Date().toISOString().slice(0, 10), -1),
          refreshDays: 5,
          detailsEveryDays: ctx.settings.get<number>('detailsEveryDays') ?? 7,
          progress: (fraction, message) => job.progress(fraction, message),
          signal: job.signal,
          log: (message) => ctx.logger.info(message),
        });
        await computeWaveforms();
        invalidate();
        evaluateTheories();
        setLastSync({
          at: new Date().toISOString(),
          ok: true,
          message: summary.warnings[0] ?? null,
          summary,
        });
        ctx.logger.info(
          `Synchronisation : ${summary.videos} vidéo(s), ${summary.dayRows} jour(s), ${summary.calls} requête(s) Google`,
        );
        return summary;
      } catch (error) {
        const quotaError = error instanceof GoogleApiError && error.kind === 'quota';
        const message =
          error instanceof QuotaReserveError
            ? error.message
            : quotaError && services.planner
              ? `${error.message} ${services.planner.quotaOrigin()}`
              : error instanceof GoogleApiError || error instanceof AccountError
                ? error.message
                : `Synchronisation impossible : ${error instanceof Error ? error.message : String(error)}`;
        setLastSync({ at: new Date().toISOString(), ok: false, message, summary: null });
        invalidate();
        throw new Error(message, { cause: error });
      }
    });

    /** Energy of the linked tracks (videoEngine.waveform), computed once per track. */
    const computeWaveforms = async () => {
      if (!engine || !services.library) return;
      const data = store.dataset(services, { lastDay: lastCompleteDay(), timeZone: timeZone() });
      for (const track of data.tracks) {
        if (track.peaks) continue;
        const source = services.library.getTrack(track.id);
        if (!source) continue;
        try {
          const wave = await engine.waveform(source.audioPath, 400);
          store.setWaveform(track.id, wave.durationSec, wave.peaks);
        } catch (error) {
          ctx.logger.warn(`Forme d’onde de « ${source.title} » illisible`, error);
        }
      }
    };

    const runningSync = () =>
      ctx.jobs.list().find((j) => j.type === 'sync' && ['queued', 'running'].includes(j.status));
    const enqueueSync = () => {
      const account = accountState();
      if (!account.connected || account.needsReconnect || !account.scopesOk) return null;
      return (
        runningSync() ??
        ctx.jobs.enqueue('sync', {}, { title: 'Synchronisation des statistiques YouTube' })
      );
    };

    const checkAccount = () => {
      const account = accountState();
      if (!account.connected)
        throw new HttpError(
          409,
          'Connecte d’abord ton compte Google (Planning de sortie › Compte Google).',
        );
      if (account.needsReconnect)
        throw new HttpError(409, 'L’autorisation Google a expiré : reconnecte le compte.');
      if (!account.scopesOk)
        throw new HttpError(
          409,
          'Autorise d’abord l’accès aux statistiques (bouton « Autoriser les statistiques »).',
        );
    };
    ctx.routes.post('/sync', () => {
      checkAccount();
      return enqueueSync();
    });

    // At start-up, then every 30 minutes: a sync when the last one is older than the setting.
    ctx.scheduler.schedule('auto-sync', { everyMinutes: 30 }, async () => {
      const last = store.meta<{ at: string; postponed?: boolean }>('lastSync');
      const hours = ctx.settings.get<number>('syncHours') ?? 6;
      // A sync postponed for the uploads is tried again at the next tick.
      if (last && !last.postponed && Date.now() - Date.parse(last.at) < hours * 3_600_000) return;
      enqueueSync();
    });

    // State, levels ------------------------------------------------------------

    const state = () => {
      const job = runningSync();
      return {
        mode: demoMode() ? 'demo' : 'real',
        account: accountState(),
        channel: store.meta<{ id: string; title: string }>('channel'),
        lastSync: store.meta('lastSync'),
        syncing: job ? { id: job.id, progress: job.progress, message: job.message } : null,
        reach: store.meta<string>('reach'),
        engagedViews: store.meta<boolean>('engagedViews'),
        hasData: store.videos().length > 0,
        lastDay: lastCompleteDay(),
        imports: store.imports().slice(0, 5),
        services: {
          library: Boolean(services.library),
          planner: Boolean(services.planner),
          packs: Boolean(services.packs),
          customReels: Boolean(services.customReels),
          engine: Boolean(engine),
        },
      };
    };
    registerAssistantActions(ctx, analysis, () => {
      checkAccount();
      const running = runningSync();
      const job = running ?? enqueueSync();
      if (!job) throw new HttpError(409, 'Le compte Google n’est pas prêt.');
      return { jobId: job.id, alreadyRunning: Boolean(running) };
    });
    ctx.routes.get('/state', () => state());

    const visitKey = () => (demoMode() ? 'visit:demo' : 'visit:real');
    ctx.routes.get('/overview', (request) => {
      const { data, lab, theories } = analysis();
      const filters = parseFilters(request.query as Record<string, string>);
      return {
        mode: data.mode,
        channel: data.channel,
        reach: data.reach,
        lastDay: data.lastDay,
        ...overview(data, lab, theories, filters, store.meta<VisitMark>(visitKey())),
      };
    });
    ctx.routes.post('/visit', () => {
      const { data, lab } = analysis();
      const views = overview(data, lab, [], parseFilters({}), null);
      store.setMeta(visitKey(), visitMark(data, views.records));
      return { ok: true };
    });

    ctx.routes.get('/tracks', () => {
      const { data, lab } = analysis();
      return { mode: data.mode, tracks: trackList(data, lab) };
    });
    ctx.routes.get('/tracks/:id', (request) => {
      const { data, lab } = analysis();
      const detail = trackDetail(data, lab, Number((request.params as { id: string }).id));
      if (!detail) throw new HttpError(404, 'Aucune vidéo liée à ce morceau');
      return { mode: data.mode, ...detail };
    });

    ctx.routes.get('/videos', (request) => {
      const { data, lab } = analysis();
      const filters = parseFilters(request.query as Record<string, string>);
      return {
        mode: data.mode,
        tracks: data.tracks.map((t) => ({ id: t.id, title: t.title })),
        videos: videoList(data, lab, filters),
      };
    });
    ctx.routes.get('/videos/:id', (request) => {
      const { data, lab } = analysis();
      const detail = videoDetail(data, lab, (request.params as { id: string }).id);
      if (!detail) throw new HttpError(404, 'Vidéo introuvable');
      const track = data.tracks.find((t) => t.id === detail.video.origin.trackId) ?? null;
      return { mode: data.mode, reach: data.reach, track, ...detail };
    });

    ctx.routes.get('/lab', () => {
      const { data, lab } = analysis();
      // The growth curves are heavy: only the usual curve and the 12 most recent videos.
      const growth = lab.growth.map((g) => ({ ...g, curves: g.curves.slice(-12) }));
      return {
        mode: data.mode,
        tracks: data.tracks.map((t) => ({ id: t.id, title: t.title })),
        ...lab,
        growth,
      };
    });

    ctx.routes.get('/theories', () => {
      const { data, theories } = analysis();
      return { mode: data.mode, theories, journal: journal() };
    });

    // Linking videos published outside ToolBox -----------------------------------

    ctx.routes.get('/links', () => {
      const { data } = analysis();
      const tracks =
        data.mode === 'demo'
          ? data.tracks.map((t) => ({ id: t.id, title: t.title }))
          : (services.library?.listTracks() ?? []).map((t) => ({ id: t.id, title: t.title }));
      const rows = new Map(store.videos().map((v) => [v.id, v]));
      return {
        mode: data.mode,
        tracks,
        videos: data.videos
          .filter((v) => v.origin.link !== 'planner')
          .map((v) => ({
            id: v.id,
            title: v.title,
            kind: v.kind,
            publishedAt: v.publishedAt,
            trackId: v.origin.trackId,
            mode: rows.get(v.id)?.link_mode ?? null,
            suggestion:
              v.origin.trackId === null ? (suggestTrack(v.title, tracks)?.track ?? null) : null,
          })),
      };
    });

    ctx.routes.put('/videos/:id/link', (request) => {
      if (demoMode()) throw new HttpError(409, 'Mode démo : les liaisons ne se modifient pas.');
      const id = (request.params as { id: string }).id;
      if (!store.video(id)) throw new HttpError(404, 'Vidéo introuvable');
      const { trackId } = requestBody(request);
      if (trackId === null) store.setVideoFields(id, { link_mode: null, manual_track_id: null });
      else if (trackId === 'none')
        store.setVideoFields(id, { link_mode: 'none', manual_track_id: null });
      else if (typeof trackId === 'number' && Number.isInteger(trackId)) {
        if (services.library && !services.library.getTrack(trackId))
          throw new HttpError(404, 'Morceau introuvable');
        store.setVideoFields(id, { link_mode: 'manual', manual_track_id: trackId });
      } else throw new HttpError(400, 'Morceau invalide');
      invalidate();
      void computeWaveforms().then(invalidate, () => {});
      return { ok: true };
    });

    // Import of a YouTube Studio export (impressions, click-through rate) ---------

    ctx.routes.post('/import', async (request) => {
      if (demoMode())
        throw new HttpError(409, 'Mode démo : désactive-le pour importer tes vraies données.');
      const file = requestBody(request).path;
      if (typeof file !== 'string' || !file)
        throw new HttpError(400, 'Choisis le fichier exporté de YouTube Studio');
      let tables;
      try {
        tables = await readExport(file);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      const known = new Set(store.videos().map((v) => v.id));
      const report: {
        file: string;
        kind: string;
        rows: number;
        matched: number;
        columns: { header: string; field: string | null }[];
      }[] = [];
      for (const table of tables) {
        const rows = reachRows(table);
        const matched = rows.filter((r) => known.has(r.videoId));
        if (table.kind === 'daily') {
          store.upsertDays(
            matched
              .filter((r) => r.day)
              .map((r) => ({
                videoId: r.videoId,
                day: r.day!,
                views: 0,
                engagedViews: null,
                minutes: 0,
                avgViewDuration: null,
                avgViewPct: null,
                likes: 0,
                comments: 0,
                shares: 0,
                subsGained: 0,
                subsLost: 0,
                impressions: r.impressions,
                ctr: r.ctr,
              })),
            { reachOnly: true },
          );
        } else if (table.kind === 'totals') {
          for (const r of matched)
            store.setVideoFields(r.videoId, { impressions: r.impressions, ctr: r.ctr });
        }
        store.addImport({
          fileName: table.fileName,
          kind: table.kind,
          rows: rows.length,
          matched: matched.length,
          columns: table.columns.map((c) => c.header),
        });
        report.push({
          file: table.fileName,
          kind: table.kind,
          rows: rows.length,
          matched: matched.length,
          columns: table.columns,
        });
      }
      invalidate();
      const usable = report.filter((r) => r.kind !== 'unknown');
      if (usable.length === 0) {
        throw new HttpError(
          400,
          'Aucune colonne « Contenu » / « Content » (identifiant de vidéo) : exporte depuis YouTube Studio › Statistiques › Mode avancé, onglet « Contenu ».',
        );
      }
      return { report };
    });

    ctx.routes.get('/imports', () => store.imports());
  },
});
