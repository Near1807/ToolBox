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
import { MIGRATION_V1, migrationV2, StatsStore, type LinkServices } from './store';
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

const today = () => new Date().toISOString().slice(0, 10);

/** « 24/10 » */
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** What a sync asked, received and changed, in one sentence (shown after each sync). */
export function syncReport(summary: SyncSummary): string {
  const parts: string[] = [];
  if (summary.requested)
    parts.push(
      `Demandé : du ${shortDay(summary.requested.from)} au ${shortDay(summary.requested.to)}${summary.fullHistory ? ' (tout l’historique, réparation)' : ''}, ${summary.videosAsked ?? 0} vidéo(s) sur ${summary.videos}.`,
    );
  else parts.push(`Rien à demander à YouTube Analytics (${summary.videos} vidéo(s)).`);
  parts.push(
    `Reçu : ${summary.dayRows} jour(s) de statistiques par vidéo, ${summary.changed ?? 0} nouveau(x) ou modifié(s).`,
  );
  const last = summary.lastAvailableDay;
  if (last && (summary.newDays ?? 0) === 0)
    parts.push(
      `Aucune donnée consolidée nouvelle depuis le ${shortDay(last)} (retard normal de YouTube).`,
    );
  else if (last) parts.push(`Données YouTube disponibles jusqu’au ${shortDay(last)}.`);
  if (summary.totalMs !== undefined)
    parts.push(
      `Durée : ${Math.max(1, Math.round(summary.totalMs / 1000))} s, ${summary.calls} requête(s).`,
    );
  return parts.join(' ');
}

/** A network failure (no Internet, DNS, proxy), told apart from Google's answers. */
const isNetworkError = (error: unknown) =>
  error instanceof TypeError ||
  /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(
    error instanceof Error
      ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`
      : '',
  );

interface Analysis {
  key: string;
  data: Dataset;
  lab: LabResult;
  theories: Theory[];
}

export default defineBackendModule({
  migrations: [
    { version: 1, description: 'statistics tables', up: MIGRATION_V1 },
    { version: 2, description: 'provenance of the numbers (API / CSV import)', up: migrationV2 },
  ],

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
    /**
     * Last day of consolidated Analytics data: the last day YouTube gave for the
     * channel (never today); 3 days ago before any sync.
     */
    const lastCompleteDay = () => {
      const last = store.lastChannelDay();
      const yesterday = addDay(today(), -1);
      if (!last) return addDay(today(), -3);
      return last < yesterday ? last : yesterday;
    };
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
      /** Strict minimum because uploads are due within 24 h. */
      minimal?: boolean;
      /** What was asked, received and changed (syncReport). */
      report?: string | null;
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
      const minimal = Boolean(outlook && outlook.uploadsSoon > 0);
      const fullHistory = !minimal && store.meta<string>('fullResync') !== null;
      try {
        const summary = await syncChannel(client, store, {
          minimal,
          fullHistory,
          lastDay: addDay(new Date().toISOString().slice(0, 10), -1),
          refreshDays: 5,
          detailsEveryDays: ctx.settings.get<number>('detailsEveryDays') ?? 7,
          progress: (fraction, message) => job.progress(fraction, message),
          signal: job.signal,
          log: (message) => ctx.logger.info(message),
        });
        if (fullHistory) store.setMeta('fullResync', null);
        await computeWaveforms();
        invalidate();
        evaluateTheories();
        const report = syncReport(summary);
        setLastSync({
          at: new Date().toISOString(),
          ok: true,
          message: summary.warnings[0] ?? null,
          summary,
          minimal,
          report,
        });
        ctx.logger.info(`Synchronisation : ${report}`);
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
                : isNetworkError(error)
                  ? `Pas de connexion à Google (réseau) : ${error instanceof Error ? error.message : String(error)}. Nouvel essai à la prochaine synchronisation.`
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
        imports: store.imports(),
        unattributedCsv: store.unattributedCsv(),
        sources: store.sources(),
        fullResync: store.meta<string>('fullResync') !== null,
        autoSyncHours: ctx.settings.get<number>('syncHours') ?? 6,
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
        liveAt: data.mode === 'demo' ? null : (store.meta<{ at: string }>('lastSync')?.at ?? null),
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
        lastDay: data.lastDay,
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
        id: number;
        file: string;
        kind: string;
        rows: number;
        matched: number;
        keptApi: number;
        columns: { header: string; field: string | null }[];
      }[] = [];
      for (const table of tables) {
        const rows = reachRows(table);
        const matched = rows.filter((r) => known.has(r.videoId));
        const metrics = [
          ...new Set(
            table.columns
              .map((c) => c.field)
              .filter((f): f is 'impressions' | 'ctr' => f === 'impressions' || f === 'ctr'),
          ),
        ];
        const importId = store.addImport({
          fileName: table.fileName,
          kind: table.kind,
          rows: rows.length,
          matched: matched.length,
          columns: table.columns.map((c) => c.header),
          metrics,
        });
        // Only impressions / CTR are taken from a CSV, and never over a value of the API.
        let keptApi = 0;
        if (table.kind === 'daily') {
          keptApi = store.upsertReach(
            matched
              .filter((r) => r.day)
              .map((r) => ({
                videoId: r.videoId,
                day: r.day!,
                impressions: r.impressions,
                ctr: r.ctr,
              })),
            { kind: 'csv', importId },
          ).keptApi;
        } else if (table.kind === 'totals') {
          for (const r of matched)
            store.setVideoFields(r.videoId, {
              impressions: r.impressions,
              ctr: r.ctr,
              reach_import_id: importId,
            });
        }
        store.refreshImportPeriod(importId);
        report.push({
          id: importId,
          file: table.fileName,
          kind: table.kind,
          rows: rows.length,
          matched: matched.length,
          keptApi,
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

    // CSV imports: listed, and deletable one by one (backup of the database first).

    const footprintText = (f: { days: number; rowsRemoved: number; videos: number }) =>
      [
        f.days ? `impressions et taux de clics de ${f.days} jour(s)-vidéo` : null,
        f.videos ? `totaux d’impressions de ${f.videos} vidéo(s)` : null,
      ]
        .filter(Boolean)
        .join(' et ') || 'aucune donnée (seulement la ligne de l’import)';

    ctx.routes.get('/imports', () => ({
      imports: store.imports(),
      unattributed: store.unattributedCsv(),
    }));

    const importParam = (request: { params: unknown }) => {
      const raw = (request.params as { id: string }).id;
      if (raw === 'all') return 'all' as const;
      const id = Number(raw);
      if (!Number.isInteger(id) || !store.imports().some((i) => i.id === id))
        throw new HttpError(404, 'Import introuvable');
      return id;
    };

    ctx.routes.get('/imports/:id/footprint', (request) => {
      const id = importParam(request);
      const footprint = store.importFootprint(id);
      return { ...footprint, text: footprintText(footprint) };
    });

    ctx.routes.delete('/imports/:id', (request) => {
      if (demoMode()) throw new HttpError(409, 'Mode démo : désactive-le pour gérer tes imports.');
      const id = importParam(request);
      const unknownBefore = store.sources().reach.unknown ?? 0;
      const backup = ctx.db.backup(
        id === 'all' ? 'avant-suppression-csv' : `avant-suppression-import-${id}`,
      );
      const removed = store.deleteImport(id);
      // Impressions that were maybe the API's went with them: fetched again from YouTube.
      if (id === 'all' && unknownBefore > 0 && store.meta<string>('reach') === 'api')
        store.setMeta('fullResync', 'csv-deleted');
      invalidate();
      ctx.logger.info(
        `Import CSV ${id === 'all' ? '(tous)' : `n° ${id}`} supprimé : ${footprintText(removed)} (sauvegarde ${backup})`,
      );
      return { backup, removed, text: footprintText(removed) };
    });

    // Diagnostic: each possible cause, checked now (read only, 1 unit of quota).

    ctx.routes.post('/diagnostic', async () => runDiagnostic());

    type Check = {
      id: string;
      label: string;
      status: 'ok' | 'problem' | 'warning' | 'info';
      detail: string;
      action: string | null;
    };
    const runDiagnostic = async (): Promise<{ checks: Check[]; at: string }> => {
      const checks: Check[] = [];
      const add = (check: Check) => checks.push(check);
      const day = shortDay;
      add(
        demoMode()
          ? {
              id: 'demo',
              label: 'Mode démo',
              status: 'problem',
              detail: 'Activé : les pages montrent une chaîne simulée, pas la tienne.',
              action: 'Réglages du module Stats YouTube › décocher « Mode démo ».',
            }
          : {
              id: 'demo',
              label: 'Mode démo',
              status: 'ok',
              detail: 'Désactivé (vraies données).',
              action: null,
            },
      );
      const account = accountState();
      if (!ctx.accounts.available || !account.configured) {
        add({
          id: 'account',
          label: 'Compte Google',
          status: 'problem',
          detail: 'Les identifiants Google (ID client, secret) ne sont pas saisis.',
          action:
            'Réglages › Comptes connectés : saisis l’ID client et le secret de ton projet Google Cloud.',
        });
        return { checks, at: new Date().toISOString() };
      }
      if (!account.connected) {
        add({
          id: 'account',
          label: 'Compte Google',
          status: 'problem',
          detail: 'Non connecté.',
          action: 'Onglet « Données » › « Connecter le compte Google ».',
        });
        return { checks, at: new Date().toISOString() };
      }
      if (account.needsReconnect) {
        add({
          id: 'account',
          label: 'Jeton Google',
          status: 'problem',
          detail: `Expiré ou révoqué${account.error ? ` (${account.error})` : ''}.`,
          action: 'Onglet « Données » › « Autoriser les statistiques » pour reconnecter le compte.',
        });
        return { checks, at: new Date().toISOString() };
      }
      add({
        id: 'account',
        label: 'Compte Google',
        status: 'ok',
        detail: 'Connecté.',
        action: null,
      });
      if (!account.scopesOk) {
        add({
          id: 'scopes',
          label: 'Autorisation des statistiques',
          status: 'problem',
          detail: 'Le compte est connecté pour les envois, mais pas pour lire les statistiques.',
          action: 'Onglet « Données » › « Autoriser les statistiques » (lecture seule, une fois).',
        });
        return { checks, at: new Date().toISOString() };
      }
      add({
        id: 'scopes',
        label: 'Autorisation des statistiques',
        status: 'ok',
        detail: 'Accordée (YouTube Analytics et YouTube en lecture seule).',
        action: null,
      });

      const planner = services.planner;
      const client = new GoogleClient((url, init) => ctx.accounts.fetch(GOOGLE, url, init), {
        after: (units) => planner?.recordYouTubeQuota(ctx.id, units),
        exhausted: () => planner?.recordYouTubeQuota(ctx.id, 0, true),
      });
      const explain = (error: unknown, api: string): Check => {
        if (error instanceof AccountError)
          return {
            id: api,
            label: api === 'data' ? 'API YouTube Data' : 'API YouTube Analytics',
            status: 'problem',
            detail: `Jeton refusé : ${error.message}`,
            action: 'Onglet « Données » › reconnecte le compte Google.',
          };
        if (error instanceof GoogleApiError) {
          const actions: Record<string, string> = {
            disabled:
              api === 'data'
                ? 'Google Cloud › API et services › Bibliothèque › « YouTube Data API v3 » › Activer (même projet que l’ID client).'
                : 'Google Cloud › API et services › Bibliothèque › « YouTube Analytics API » › Activer (même projet que l’ID client).',
            scope: 'Onglet « Données » › « Autoriser les statistiques ».',
            quota: 'Attendre la remise à zéro du quota (minuit, heure de Californie).',
          };
          return {
            id: api,
            label: api === 'data' ? 'API YouTube Data' : 'API YouTube Analytics',
            status: 'problem',
            detail: error.message,
            action: actions[error.kind] ?? null,
          };
        }
        return {
          id: api,
          label: api === 'data' ? 'API YouTube Data' : 'API YouTube Analytics',
          status: 'problem',
          detail: isNetworkError(error)
            ? `Pas de connexion à Google (réseau) : ${error instanceof Error ? error.message : String(error)}.`
            : `Erreur : ${error instanceof Error ? error.message : String(error)}.`,
          action: isNetworkError(error)
            ? 'Vérifie la connexion Internet (ou le pare-feu), puis relance.'
            : null,
        };
      };
      let dataOk = false;
      try {
        await client.data('channels', { part: 'id', mine: 'true' });
        dataOk = true;
        add({
          id: 'data',
          label: 'API YouTube Data',
          status: 'ok',
          detail: 'Répond (compteurs en direct).',
          action: null,
        });
      } catch (error) {
        add(explain(error, 'data'));
      }
      try {
        const rows = await client.report({
          startDate: addDay(today(), -10),
          endDate: addDay(today(), -1),
          dimensions: ['day'],
          metrics: ['views'],
          sort: 'day',
        });
        const available =
          rows
            .map((r) => String(r.day))
            .sort()
            .at(-1) ?? null;
        add({
          id: 'analytics',
          label: 'API YouTube Analytics',
          status: 'ok',
          detail: 'Activée et autorisée.',
          action: null,
        });
        const lag = available
          ? Math.round((Date.parse(today()) - Date.parse(available)) / 86_400_000)
          : null;
        add({
          id: 'delay',
          label: 'Retard de YouTube',
          status: lag === null ? 'warning' : lag <= 4 ? 'ok' : 'warning',
          detail:
            lag === null
              ? 'Aucune donnée sur les 10 derniers jours (chaîne sans vues, ou YouTube en retard).'
              : `YouTube a des données consolidées jusqu’au ${day(available!)} (${lag} jour(s) de retard${lag <= 4 ? ', normal' : ', plus que d’habitude'}).`,
          action: null,
        });
      } catch (error) {
        add(explain(error, 'analytics'));
      }
      const outlook = planner?.youtubeQuota() ?? null;
      if (outlook) {
        const reserve = ctx.settings.get<number>('quotaReserve') ?? 1000;
        const left = outlook.unitsPerDay - outlook.used.total - reserve;
        add(
          outlook.uploadsActive > 0
            ? {
                id: 'priority',
                label: 'Priorité aux envois',
                status: 'warning',
                detail: `${outlook.uploadsActive} envoi(s) YouTube en cours : la synchronisation est reportée (le Planning passe en premier), nouvel essai toutes les 30 minutes.`,
                action: null,
              }
            : outlook.uploadsSoon > 0
              ? {
                  id: 'priority',
                  label: 'Priorité aux envois',
                  status: 'warning',
                  detail: `${outlook.uploadsSoon} envoi(s) YouTube prévu(s) dans les 24 h : synchronisation minimale (chaîne et liste des vidéos, sans le détail par vidéo).`,
                  action: null,
                }
              : {
                  id: 'priority',
                  label: 'Priorité aux envois',
                  status: 'ok',
                  detail: 'Aucun envoi en cours ni prévu dans les 24 h.',
                  action: null,
                },
        );
        add(
          outlook.exhausted || left <= 0
            ? {
                id: 'quota',
                label: 'Quota YouTube Data',
                status: 'problem',
                detail: outlook.exhausted
                  ? `Épuisé aujourd’hui. ${planner!.quotaOrigin()}`
                  : `Il ne reste rien hors de la réserve des envois (${reserve} unités). ${planner!.quotaOrigin()}`,
                action:
                  'Attendre minuit (heure de Californie), ou baisser la réserve dans les réglages du module.',
              }
            : {
                id: 'quota',
                label: 'Quota YouTube Data',
                status: 'ok',
                detail: `${left} unité(s) disponibles pour les statistiques aujourd’hui (réserve des envois : ${reserve}).`,
                action: null,
              },
        );
      } else if (dataOk) {
        add({
          id: 'quota',
          label: 'Quota YouTube Data',
          status: 'ok',
          detail: 'Pas d’erreur de quota.',
          action: null,
        });
      }
      const last = store.meta<{
        at: string;
        ok: boolean;
        message: string | null;
        postponed?: boolean;
        minimal?: boolean;
        report?: string | null;
        summary: SyncSummary | null;
      }>('lastSync');
      const hours = ctx.settings.get<number>('syncHours') ?? 6;
      if (!last)
        add({
          id: 'sync',
          label: 'Dernière synchronisation',
          status: 'warning',
          detail: 'Jamais.',
          action: 'Bouton « Synchroniser maintenant ».',
        });
      else {
        const when = new Date(last.at).toLocaleString('fr-FR', { timeZone: timeZone() });
        const noNew = last.ok && last.summary && (last.summary.newDays ?? 1) === 0;
        add({
          id: 'sync',
          label: 'Dernière synchronisation',
          status: !last.ok
            ? 'problem'
            : last.postponed || last.minimal
              ? 'warning'
              : noNew
                ? 'info'
                : 'ok',
          detail:
            `${when} — ${last.postponed ? 'reportée' : last.minimal ? 'minimale' : last.ok ? 'réussie' : 'échec'}. ${last.message ?? ''} ${last.report ?? ''}`.trim(),
          action: last.ok
            ? null
            : 'Corrige le point en rouge ci-dessus, puis « Synchroniser maintenant ».',
        });
        const next = new Date(Date.parse(last.at) + hours * 3_600_000);
        add({
          id: 'auto',
          label: 'Synchronisation automatique',
          status: 'info',
          detail: `Toutes les ${hours} h (au démarrage puis vérifié toutes les 30 min) : prochaine vers ${next.toLocaleString('fr-FR', { timeZone: timeZone() })}, si l’app est ouverte.`,
          action: null,
        });
      }
      const sources = store.sources();
      const unattributed = store.unattributedCsv();
      add({
        id: 'csv',
        label: 'Imports CSV',
        status: unattributed.days + unattributed.videos > 0 ? 'info' : 'ok',
        detail: `Les données de l’API passent toujours avant celles d’un CSV (un CSV ne donne que les impressions et le taux de clics). ${store.imports().length} import(s)${sources.csvOnlyDays ? `, ${sources.csvOnlyDays} jour(s)-vidéo connus seulement par un CSV` : ''}${unattributed.days + unattributed.videos > 0 ? ` ; des données d’imports d’avant la v0.18 ne peuvent pas être rattachées à un import précis` : ''}.`,
        action:
          unattributed.days + unattributed.videos > 0
            ? 'Onglet « Données » › « Supprimer toutes les données CSV » si tu veux repartir des seules données de l’API.'
            : null,
      });
      if (store.meta<string>('fullResync') !== null)
        add({
          id: 'repair',
          label: 'Réparation',
          status: 'info',
          detail:
            'La prochaine synchronisation reprend tout l’historique (des jours avaient été pris pour connus à cause d’un import CSV).',
          action: null,
        });
      return { checks, at: new Date().toISOString() };
    };
  },
});
