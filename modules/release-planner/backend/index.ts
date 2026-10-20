// release-planner: the release calendar of every track. YouTube elements (the
// video, the Reels as Shorts) are uploaded in advance and scheduled on YouTube;
// Instagram elements (post, Reels) are published by hand, with reminders.
// Other modules are reached only through their services (MODULES.md §5.8).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  AccountError,
  defineBackendModule,
  HttpError,
  type ModuleContext,
  type OutputRecord,
} from '@hub/sdk/backend';
import type { InstagramPackService, PackItem } from '../../instagram-video/contract';
import type { MusicLibraryService, Track } from '../../music-library/contract';
import type { VideoEngineService } from '../../video-engine/contract';
import type { YouTubeVideo, YouTubeVideoService } from '../../youtube-video/contract';
import {
  buildPlan,
  DEFAULT_TEMPLATE,
  fillTemplate,
  itemLabel,
  parseTemplate,
  PLATFORM,
  sanitizeMetadata,
  spreadPlan,
  type ItemKind,
  type ProposedItem,
} from './plan';
import { canUpload, planUploads, quotaMessage, UNIT_COST, type QuotaLimits } from './quota';
import { displayStatus, isOnline, stateFromYouTube, type ItemState } from './status';
import {
  migrationV1,
  PlannerStore,
  VISIBILITIES,
  type ItemRow,
  type ReleaseRow,
  type Visibility,
} from './store';
import {
  addDays,
  isDate,
  isTime,
  isTimeZone,
  nextQuotaReset,
  quotaDay,
  utcToZoned,
  zonedToUtc,
} from './time';
import {
  addToPlaylist,
  deleteVideo,
  findPlaylist,
  getVideos,
  myChannel,
  setThumbnail,
  shortUrl,
  studioUrl,
  updateSchedule,
  uploadVideo,
  watchUrl,
  YouTubeApiError,
  type VideoMetadata,
} from './youtube';

/**
 * The one scope needed: `youtube.upload` cannot move a publication date
 * (videos.update) nor add to a playlist; `youtube` covers upload, reading the
 * status, thumbnails, scheduling and playlists.
 */
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube'];
const GOOGLE = 'google';
const subject = (trackId: number) => `music-library:track:${trackId}`;

function idParam(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identifiant invalide');
  return id;
}

function body(request: { body?: unknown }): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default defineBackendModule({
  migrations: [
    { version: 1, description: 'releases, planned elements, YouTube quota', up: migrationV1 },
  ],

  register(ctx: ModuleContext) {
    const library = ctx.services.get<MusicLibraryService>('musicLibrary');
    const engine = ctx.services.get<VideoEngineService>('videoEngine');
    const youtubeVideos = ctx.services.get<YouTubeVideoService>('youtubeVideo');
    const packs = ctx.services.get<InstagramPackService>('instagramPack');
    const store = new PlannerStore(ctx);
    const youtube = (url: string, init?: RequestInit) => ctx.accounts.fetch(GOOGLE, url, init);
    let stopping = false;
    ctx.onShutdown(() => {
      stopping = true;
    });

    // Settings -------------------------------------------------------------

    const timeZone = () => {
      const value = ctx.settings.get<string>('timeZone');
      return isTimeZone(value) ? value : 'Europe/Brussels';
    };
    const defaultTime = () => {
      const value = ctx.settings.get<string>('defaultTime');
      return isTime(value) ? value : '18:00';
    };
    const maxPerDay = () => ctx.settings.get<number>('maxPerDay') ?? 1;
    const limits = (): QuotaLimits => ({
      uploadsPerDay: ctx.settings.get<number>('uploadsPerDay') ?? 6,
      unitsPerDay: ctx.settings.get<number>('unitsPerDay') ?? 10_000,
    });
    const local = (instant: string) => utcToZoned(instant, timeZone());
    const formatInstant = (instant: Date) => {
      const { date, time } = utcToZoned(instant, timeZone());
      return `${date.split('-').reverse().join('/')} à ${time}`;
    };
    const spendUnits = (units: number) => store.addQuota(quotaDay(new Date()), { units });

    // Tracks and generated files (through services and ctx.outputs) --------

    const requireTrack = (id: number): Track => {
      const track = library.getTrack(id);
      if (!track) throw new HttpError(404, 'Morceau introuvable');
      return track;
    };

    /** Files of a track registered by every module (ctx.outputs), by "module/ref". */
    const outputsOf = (trackId: number) =>
      new Map(ctx.outputs.bySubject(subject(trackId)).map((r) => [`${r.moduleId}/${r.ref}`, r]));

    interface Source {
      /** The generated element does not exist any more (video deleted, pack item gone). */
      gone: boolean;
      filePath: string | null;
      exists: boolean;
      record: OutputRecord | null;
      packItem: PackItem | null;
      video: YouTubeVideo | null;
    }

    const sourceOf = (
      release: ReleaseRow,
      item: ItemRow,
      records = outputsOf(release.track_id),
    ): Source => {
      if (item.kind === 'youtube') {
        const video = release.video_id ? youtubeVideos.getVideo(release.video_id) : null;
        const record = video ? (records.get(`youtube-video/video:${video.id}`) ?? null) : null;
        return {
          gone: !video,
          filePath: video?.filePath ?? null,
          exists: Boolean(video && (record ? record.exists : existsSync(video.filePath))),
          record,
          packItem: null,
          video,
        };
      }
      const packItem = item.pack_item_id ? packs.getItem(item.pack_item_id) : null;
      const record = packItem ? (records.get(`instagram-video/item:${packItem.id}`) ?? null) : null;
      return {
        gone: !packItem,
        filePath: packItem?.filePath ?? null,
        exists: Boolean(
          packItem?.filePath && (record ? record.exists : existsSync(packItem.filePath)),
        ),
        record,
        packItem,
        video: null,
      };
    };

    const mediaUrl = (file: string | null | undefined) => {
      if (!file || !existsSync(file)) return null;
      try {
        return ctx.files.mediaUrl(file);
      } catch {
        return null;
      }
    };

    // Metadata (templates of the settings, editable per element) -----------

    const hashtagsOf = (tags: string[]) =>
      tags.map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' ');

    const defaultTexts = (
      track: Track,
      kind: ItemKind,
      position: number,
      total: number,
      releaseDate: string,
    ) => {
      const texts = youtubeVideos.texts(track.id);
      const extra = (ctx.settings.get<string>('extraTags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const tags = [...(texts?.tags ?? track.tags), ...extra];
      const values = {
        titre: track.title,
        artiste: track.artist,
        titre_youtube: texts?.videoTitle ?? `${track.artist} - ${track.title}`,
        description_youtube: texts?.description ?? '',
        hashtags: hashtagsOf(texts?.tags ?? track.tags),
        date: releaseDate.split('-').reverse().join('/'),
        n: String(position),
        total: String(total),
      };
      const template = (key: string, fallback: string) => ctx.settings.get<string>(key) ?? fallback;
      return kind === 'youtube'
        ? {
            title: fillTemplate(template('videoTitle', '{titre_youtube}'), values),
            description: fillTemplate(
              template('videoDescription', '{description_youtube}'),
              values,
            ),
            tags,
          }
        : {
            title: fillTemplate(
              template('shortTitle', '{titre} — {artiste} ({n}/{total})'),
              values,
            ),
            description: fillTemplate(
              template('shortDescription', '{titre} — {artiste}\n{lien_video}\n\n{hashtags}'),
              values,
            ),
            tags,
          };
    };

    /** What is sent to YouTube: {lien_video} filled in now, the line dropped if unknown. */
    const uploadMetadata = (release: ReleaseRow, item: ItemRow): VideoMetadata => {
      const video = store
        .itemsOf(release.id)
        .find((other) => other.kind === 'youtube' && other.yt_video_id);
      const description = (item.description ?? '')
        .split('\n')
        .map((line) =>
          line.includes('{lien_video}')
            ? video?.yt_video_id
              ? line.replaceAll('{lien_video}', watchUrl(video.yt_video_id))
              : null
            : line,
        )
        .filter((line): line is string => line !== null)
        .join('\n');
      const clean = sanitizeMetadata({
        title: item.title ?? '',
        description,
        tags: item.tags ? (JSON.parse(item.tags) as string[]) : [],
      });
      const visibility = item.visibility;
      return {
        ...clean,
        language: ctx.settings.get<string>('language') ?? 'fr',
        privacyStatus:
          visibility === 'scheduled' || visibility === 'private' ? 'private' : visibility,
        publishAt: visibility === 'scheduled' ? item.scheduled_at : undefined,
      };
    };

    // DTOs ------------------------------------------------------------------

    const itemDto = (
      item: ItemRow,
      release: ReleaseRow,
      track: Track | null,
      records?: Map<string, OutputRecord>,
    ) => {
      const source = sourceOf(release, item, records);
      const { status, late } = displayStatus({
        kind: item.kind,
        state: item.state,
        scheduledAt: item.scheduled_at,
        instaPublishedAt: source.packItem?.publishedAt ?? null,
        now: new Date(),
      });
      const job = item.job_id ? ctx.jobs.get(item.job_id) : null;
      const when = local(item.scheduled_at);
      return {
        id: item.id,
        releaseId: release.id,
        trackId: release.track_id,
        trackTitle: track?.title ?? '(morceau supprimé)',
        artist: track?.artist ?? '',
        colorIndex: release.track_id % 8,
        kind: item.kind,
        position: item.position,
        label: itemLabel(item.kind, item.position),
        platform: PLATFORM[item.kind],
        scheduledAt: item.scheduled_at,
        date: when.date,
        time: when.time,
        shiftedFrom: item.shifted_from,
        state: item.state,
        status,
        late,
        visibility: item.visibility,
        title: item.title,
        description: item.description,
        tags: item.tags ? (JSON.parse(item.tags) as string[]) : [],
        caption: source.packItem?.caption ?? null,
        publishedAt: source.packItem?.publishedAt ?? item.published_at,
        source: {
          gone: source.gone,
          exists: source.exists,
          rendered: Boolean(source.filePath),
          fileName: source.filePath ? path.basename(source.filePath) : null,
          url: source.exists ? mediaUrl(source.filePath) : null,
          thumbnailUrl: mediaUrl(source.packItem?.thumbnailPath ?? null),
          outputId: source.record?.id ?? null,
        },
        youtube: item.yt_video_id
          ? {
              id: item.yt_video_id,
              url: item.kind === 'short' ? shortUrl(item.yt_video_id) : watchUrl(item.yt_video_id),
              studioUrl: studioUrl(item.yt_video_id),
              privacy: item.yt_privacy,
              publishAt: item.yt_publish_at,
            }
          : null,
        warning: item.warning,
        error: item.error,
        notBefore: item.not_before,
        job:
          job && (job.status === 'queued' || job.status === 'running')
            ? { id: job.id, progress: job.progress, message: job.message }
            : null,
      };
    };
    type ItemDto = ReturnType<typeof itemDto>;

    const itemsDto = (items: ItemRow[]): ItemDto[] => {
      const releases = new Map<number, ReleaseRow>();
      const tracks = new Map<number, Track | null>();
      const records = new Map<number, Map<string, OutputRecord>>();
      return items.flatMap((item) => {
        let release = releases.get(item.release_id);
        if (!release) {
          release = store.release(item.release_id) ?? undefined;
          if (!release) return [];
          releases.set(release.id, release);
        }
        if (!tracks.has(release.track_id)) {
          tracks.set(release.track_id, library.getTrack(release.track_id));
          records.set(release.track_id, outputsOf(release.track_id));
        }
        return [
          itemDto(item, release, tracks.get(release.track_id)!, records.get(release.track_id)),
        ];
      });
    };

    const releaseDto = (release: ReleaseRow) => {
      const track = library.getTrack(release.track_id);
      return {
        id: release.id,
        trackId: release.track_id,
        trackTitle: track?.title ?? '(morceau supprimé)',
        artist: track?.artist ?? '',
        coverUrl: mediaUrl(track?.coverPath),
        colorIndex: release.track_id % 8,
        date: release.release_date,
        time: release.release_time,
        videoId: release.video_id,
        videos: youtubeVideos.listVideos(release.track_id).map((video) => ({
          id: video.id,
          fileName: path.basename(video.filePath),
          createdAt: video.createdAt,
          exists: video.exists,
        })),
        thumbnailUrl: mediaUrl(release.thumbnail_path),
        items: itemsDto(store.itemsOf(release.id)),
      };
    };

    // Plan ------------------------------------------------------------------

    const occupiedSlots = (exceptRelease?: number) =>
      store
        .allItems()
        .filter((item) => item.release_id !== exceptRelease)
        .map((item) => ({ platform: PLATFORM[item.kind], date: local(item.scheduled_at).date }));

    const proposePlan = (input: {
      trackId: number;
      date: string;
      time: string;
      videoId?: number;
    }) => {
      const track = requireTrack(input.trackId);
      const template = parseTemplate(ctx.settings.get<string>('planTemplate') ?? DEFAULT_TEMPLATE);
      if (template.entries.length === 0) {
        throw new HttpError(400, `Modèle de plan invalide : ${template.errors.join(' ; ')}`);
      }
      const videos = youtubeVideos.listVideos(track.id);
      const video =
        input.videoId !== undefined
          ? videos.find((v) => v.id === input.videoId)
          : (videos.find((v) => v.exists) ?? videos[0]);
      if (input.videoId !== undefined && !video) throw new HttpError(400, 'Vidéo introuvable');
      const pack = packs.getPack(track.id);
      const reels = pack?.items.filter((item) => item.kind === 'reel') ?? [];
      const post = pack?.items.find((item) => item.kind === 'post') ?? null;
      const proposed = buildPlan(template.entries, input.date, {
        video: Boolean(video),
        post: Boolean(post),
        reels: reels.map((reel) => reel.position),
      });
      const existing = store.releaseByTrack(track.id);
      const { items, shifts } = spreadPlan(proposed, occupiedSlots(existing?.id), maxPerDay());
      const totalShorts = items.filter((item) => item.kind === 'short').length;
      const packItemFor = (item: ProposedItem) =>
        item.kind === 'insta-post'
          ? post
          : item.kind === 'youtube'
            ? null
            : (reels.find((reel) => reel.position === item.position) ?? null);
      const warnings = [...template.errors];
      if (!video)
        warnings.push('Aucune vidéo YouTube générée pour ce morceau : elle est absente du plan.');
      if (!pack)
        warnings.push('Pas de pack Instagram pour ce morceau : ni post, ni Reels, ni Shorts.');
      const notRendered = items.filter((item) =>
        item.kind === 'youtube' ? !video?.exists : !packItemFor(item)?.filePath,
      );
      if (notRendered.length > 0) {
        warnings.push(
          `Pas encore généré (à faire avant la date, depuis Vidéo YouTube ou Pack Instagram) : ${notRendered
            .map((item) => itemLabel(item.kind, item.position))
            .join(', ')}.`,
        );
      }
      if (zonedToUtc(input.date, input.time, timeZone()).getTime() < Date.now()) {
        warnings.push(
          'La date de sortie est passée : les éléments YouTube seront publiés dès l’envoi.',
        );
      }
      return {
        track: { id: track.id, title: track.title, artist: track.artist },
        videoId: video?.id ?? null,
        videos: videos.map((v) => ({
          id: v.id,
          fileName: path.basename(v.filePath),
          exists: v.exists,
          createdAt: v.createdAt,
        })),
        pack: pack ? { id: pack.id, items: pack.items.length } : null,
        items: items.map((item) => ({
          kind: item.kind,
          position: item.position,
          label: itemLabel(item.kind, item.position),
          platform: PLATFORM[item.kind],
          date: item.date,
          time: input.time,
          templateDate: item.templateDate,
          shifted: item.date !== item.templateDate,
          packItemId: packItemFor(item)?.id ?? null,
          ...defaultTexts(track, item.kind, item.position, totalShorts, input.date),
        })),
        shifts: shifts.map((shift) => ({
          label: itemLabel(shift.kind, shift.position),
          from: shift.from,
          to: shift.to,
        })),
        warnings,
      };
    };

    const planInput = (input: Record<string, unknown>) => {
      const trackId = Number(input.trackId);
      if (!Number.isInteger(trackId)) throw new HttpError(400, 'Morceau manquant');
      const date = input.date;
      if (!isDate(date)) throw new HttpError(400, 'Date de sortie invalide (AAAA-MM-JJ)');
      const time = input.time === undefined || input.time === '' ? defaultTime() : input.time;
      if (!isTime(time)) throw new HttpError(400, 'Heure invalide (HH:MM)');
      const videoId =
        input.videoId === undefined || input.videoId === null ? undefined : Number(input.videoId);
      return { trackId, date, time, videoId };
    };

    // Uploads: queue, quota, job ------------------------------------------

    /** Never connected: set it up first. Authorization expired: the uploads wait in the queue. */
    const requireAccount = () => {
      const status = ctx.accounts.status(GOOGLE);
      if (!status.connected) {
        throw new AccountError(
          'not-connected',
          'Connecte d’abord ton compte Google (onglet « Compte Google »)',
        );
      }
      return status;
    };

    const RECONNECT_WARNING =
      'En attente : l’autorisation Google a expiré ou a été retirée. Reconnecte le compte, l’envoi partira tout seul.';
    // One notification per expiry, not one per minute.
    let reconnectNotified = false;
    const notifyReconnect = () => {
      if (reconnectNotified) return;
      reconnectNotified = true;
      ctx.logger.warn('Compte Google à reconnecter : envois YouTube en attente');
      ctx.notifications.notify({
        title: 'Compte Google à reconnecter',
        body: 'L’autorisation YouTube a expiré ou a été retirée : les envois sont en attente. Ouvre le Planning de sortie › « Reconnecter ».',
        path: '?tab=compte',
      });
    };
    /** Follows the account: notify when it needs reconnecting, re-arm once it is fine again. */
    const watchAccount = () => {
      const status = ctx.accounts.status(GOOGLE);
      if (status.connected && status.needsReconnect) notifyReconnect();
      else reconnectNotified = false;
      return status;
    };

    const uploadSlots = (now = new Date()) =>
      planUploads(
        store
          .itemsInStates(['queued'])
          .map((item) => ({ itemId: item.id, scheduledAt: item.scheduled_at })),
        store.quotaUsage(quotaDay(now)),
        limits(),
        now,
      );

    /** Starts the uploads allowed now (one job per element; the jobs run one at a time). */
    const dispatchUploads = () => {
      const now = new Date();
      const status = ctx.accounts.status(GOOGLE);
      if (!status.connected || status.needsReconnect) return;
      for (const slot of uploadSlots(now)) {
        const item = store.item(slot.itemId);
        if (!item || item.state !== 'queued') continue;
        const job = item.job_id ? ctx.jobs.get(item.job_id) : null;
        if (job && (job.status === 'queued' || job.status === 'running')) continue;
        if (slot.startsAt.getTime() > now.getTime()) {
          store.updateItem(item.id, { not_before: slot.startsAt.toISOString() });
          continue;
        }
        if (item.not_before && Date.parse(item.not_before) > now.getTime()) continue;
        const release = store.release(item.release_id);
        const track = release ? library.getTrack(release.track_id) : null;
        const started = ctx.jobs.enqueue(
          'upload',
          { itemId: item.id },
          {
            title: `YouTube — ${track?.title ?? 'morceau'} — ${itemLabel(item.kind, item.position)}`,
          },
        );
        store.updateItem(item.id, { job_id: started.id, not_before: null });
      }
    };

    const queueUpload = (item: ItemRow) => {
      if (PLATFORM[item.kind] !== 'youtube')
        throw new HttpError(400, 'Seuls les éléments YouTube s’envoient');
      if (item.state === 'uploading') return;
      if (item.state === 'queued') {
        if (ctx.accounts.status(GOOGLE).needsReconnect) {
          store.updateItem(item.id, { warning: RECONNECT_WARNING });
        }
        return;
      }
      if (isOnline(item.state)) throw new HttpError(409, 'Déjà sur YouTube');
      const release = store.requireRelease(item.release_id);
      const source = sourceOf(release, item);
      if (!source.exists) {
        throw new HttpError(
          409,
          `${itemLabel(item.kind, item.position)} : fichier introuvable, régénère-le d’abord`,
        );
      }
      store.updateItem(item.id, {
        state: 'queued',
        error: null,
        warning: ctx.accounts.status(GOOGLE).needsReconnect ? RECONNECT_WARNING : null,
        not_before: null,
      });
    };

    /** Thumbnail of the long video, rendered once per release (same art direction). */
    const ensureThumbnail = async (release: ReleaseRow, track: Track): Promise<string | null> => {
      if (release.thumbnail_path && existsSync(release.thumbnail_path))
        return release.thumbnail_path;
      if (!track.coverPath) return null;
      const file = path.join(
        ctx.files.outputDir(),
        `${track.artist} - ${track.title} - Miniature YouTube.jpg`.replace(/[<>:"/\\|?*]/g, '_'),
      );
      await engine.renderThumbnail({
        coverPath: track.coverPath,
        title: track.title,
        artist: track.artist,
        outputPath: file,
      });
      ctx.outputs.register({
        path: file,
        ref: `thumbnail:${release.id}`,
        parent: `release:${release.id}`,
        subject: subject(track.id),
        label: 'Miniature YouTube',
        kind: 'thumbnail',
      });
      store.updateRelease(release.id, { thumbnail_path: file });
      return file;
    };
    ctx.outputs.onRemoved((records) => {
      for (const record of records) {
        const [kind, id] = record.ref.split(':');
        if (kind === 'thumbnail') store.updateRelease(Number(id), { thumbnail_path: null });
      }
    });

    /** After the upload: thumbnail (long video) and playlist; problems are warnings. */
    const afterUpload = async (
      release: ReleaseRow,
      item: ItemRow,
      track: Track,
      videoId: string,
    ) => {
      const warnings: string[] = [];
      if (item.kind === 'youtube') {
        if (release.video_id) youtubeVideos.setUploaded(release.video_id, videoId);
        try {
          const thumbnail = await ensureThumbnail(release, track);
          if (thumbnail) {
            spendUnits(UNIT_COST.thumbnail);
            await setThumbnail(youtube, videoId, readFileSync(thumbnail));
          }
        } catch (error) {
          warnings.push(
            error instanceof YouTubeApiError && error.status === 403
              ? 'Miniature personnalisée refusée : la chaîne doit être validée (youtube.com/verify). La vidéo garde une miniature automatique.'
              : `Miniature non envoyée : ${message(error)}`,
          );
        }
      }
      const playlist = (ctx.settings.get<string>('playlist') ?? '').trim();
      if (playlist) {
        try {
          spendUnits(UNIT_COST.list);
          const found = await findPlaylist(youtube, playlist);
          if (!found) warnings.push(`Playlist « ${playlist} » introuvable sur ta chaîne.`);
          else {
            spendUnits(UNIT_COST.playlistInsert);
            await addToPlaylist(youtube, found.id, videoId);
          }
        } catch (error) {
          warnings.push(`Ajout à la playlist impossible : ${message(error)}`);
        }
      }
      return warnings;
    };

    ctx.jobs.define<{ itemId: number }, { videoId?: string; deferred?: boolean }>(
      'upload',
      async (job) => {
        let item = store.item(job.input.itemId);
        if (!item || item.state !== 'queued') return {};
        const release = store.requireRelease(item.release_id);
        const track = library.getTrack(release.track_id);
        if (!track) throw new Error('Morceau introuvable (supprimé entre-temps ?)');
        const now = new Date();
        const today = quotaDay(now);
        if (!canUpload(store.quotaUsage(today), limits())) {
          store.updateItem(item.id, {
            not_before: nextQuotaReset(now).toISOString(),
            job_id: null,
          });
          job.progress(1, 'Quota YouTube du jour atteint : envoi reporté');
          return { deferred: true };
        }
        const source = sourceOf(release, item);
        if (!source.exists || !source.filePath) {
          store.updateItem(item.id, {
            state: 'failed',
            error: 'Fichier introuvable : régénère-le puis renvoie',
            job_id: null,
          });
          throw new Error('Fichier introuvable');
        }
        item = store.updateItem(item.id, { state: 'uploading', error: null, warning: null });
        let counted = item.upload_url !== null;
        try {
          const resource = await uploadVideo(youtube, {
            file: source.filePath,
            size: statSync(source.filePath).size,
            metadata: uploadMetadata(release, item),
            sessionUrl: item.upload_url,
            onSession: (url) => {
              store.updateItem(job.input.itemId, { upload_url: url });
              if (url && !counted) {
                store.addQuota(today, { uploads: 1 });
                counted = true;
              }
            },
            onProgress: (fraction) =>
              job.progress(fraction, `Envoi vers YouTube… ${Math.round(fraction * 100)} %`),
            signal: job.signal,
          });
          const scheduled = item.visibility === 'scheduled';
          const read = stateFromYouTube({
            privacyStatus:
              resource.status?.privacyStatus ?? (scheduled ? 'private' : item.visibility),
            publishAt: resource.status?.publishAt ?? null,
            uploadStatus: resource.status?.uploadStatus,
          });
          let state: ItemState = read.state === 'failed' ? 'to-schedule' : read.state;
          let warning: string | null = null;
          if (scheduled && state === 'to-schedule') {
            warning =
              'YouTube a gardé la vidéo en privé sans date de publication (projet Google non audité ?) : programme-la dans YouTube Studio.';
          } else if (item.visibility === 'private') {
            warning = 'Envoyée en privé : publie-la ou programme-la dans YouTube Studio.';
          }
          if (scheduled && state === 'scheduled' && Date.parse(item.scheduled_at) <= Date.now()) {
            state = 'published';
          }
          store.updateItem(item.id, {
            state,
            yt_video_id: resource.id,
            yt_privacy: resource.status?.privacyStatus ?? null,
            yt_publish_at: resource.status?.publishAt ?? null,
            upload_url: null,
            job_id: null,
            warning,
            published_at: state === 'published' ? new Date().toISOString() : null,
          });
          job.progress(1, 'Miniature et playlist…');
          const warnings = await afterUpload(
            release,
            store.requireItem(item.id),
            track,
            resource.id,
          );
          if (warnings.length > 0) {
            store.updateItem(item.id, {
              warning: [warning, ...warnings].filter(Boolean).join(' '),
            });
          }
          ctx.logger.info(
            `${itemLabel(item.kind, item.position)} de « ${track.title} » envoyée : ${resource.id}`,
          );
          dispatchUploads();
          return { videoId: resource.id };
        } catch (error) {
          if (job.signal.aborted) {
            // Closing the app: resumed at the next start. Cancelled by the user: back to planned.
            if (!stopping) {
              store.updateItem(job.input.itemId, {
                state: 'planned',
                job_id: null,
                error: 'Envoi annulé (il reprendra là où il s’est arrêté)',
              });
            }
            throw error;
          }
          // Authorization expired or revoked (e.g. 7 days in « Test » mode): back to the
          // queue, sent automatically once the account is reconnected.
          if (
            error instanceof AccountError &&
            (error.code === 'reauth-required' || error.code === 'not-connected')
          ) {
            store.updateItem(job.input.itemId, {
              state: 'queued',
              job_id: null,
              warning: RECONNECT_WARNING,
            });
            notifyReconnect();
            return { deferred: true };
          }
          // Google unreachable (network down, outage) after the retries: tried again later.
          if (
            (error instanceof AccountError && error.code === 'network') ||
            error instanceof TypeError ||
            (error instanceof YouTubeApiError && error.retryable)
          ) {
            const later = new Date(Date.now() + 15 * 60_000);
            store.updateItem(job.input.itemId, {
              state: 'queued',
              job_id: null,
              not_before: later.toISOString(),
              warning: `Google injoignable (${message(error)}) : nouvel essai le ${formatInstant(later)}.`,
            });
            return { deferred: true };
          }
          if (error instanceof YouTubeApiError && error.quotaExceeded) {
            store.addQuota(today, { exhausted: true });
            store.updateItem(job.input.itemId, {
              state: 'queued',
              job_id: null,
              not_before: nextQuotaReset(new Date()).toISOString(),
              warning: `${error.message} : envoi reporté au ${formatInstant(nextQuotaReset(new Date()))}.`,
            });
            return { deferred: true };
          }
          store.updateItem(job.input.itemId, {
            state: 'failed',
            job_id: null,
            error: message(error),
          });
          ctx.notifications.notify({
            title: 'Envoi YouTube échoué',
            body: `${itemLabel(item.kind, item.position)} — ${track.title} : ${message(error)}`,
            path: `?item=${item.id}`,
          });
          throw error;
        }
      },
    );

    // Interrupted by the closing of the app: resumed (same upload session).
    for (const item of store.itemsInStates(['uploading'])) {
      store.updateItem(item.id, { state: 'queued', job_id: null });
    }
    for (const item of store.itemsInStates(['queued'])) {
      if (item.job_id) store.updateItem(item.id, { job_id: null });
    }

    // Status on YouTube -----------------------------------------------------

    const checkStatuses = async () => {
      const status = ctx.accounts.status(GOOGLE);
      if (!status.connected || status.needsReconnect) return 0;
      const recent = Date.now() - 2 * 86_400_000;
      const items = store
        .itemsInStates(['scheduled', 'to-schedule', 'published'])
        .filter(
          (item) =>
            item.yt_video_id &&
            (item.state !== 'published' ||
              !item.published_at ||
              Date.parse(item.published_at) > recent),
        );
      if (items.length === 0) return 0;
      spendUnits(Math.ceil(items.length / 50) * UNIT_COST.list);
      const found = await getVideos(
        youtube,
        items.map((item) => item.yt_video_id!),
      );
      const now = new Date().toISOString();
      for (const item of items) {
        const video = found.get(item.yt_video_id!);
        if (!video) {
          store.updateItem(item.id, {
            state: 'failed',
            error: 'Vidéo introuvable sur YouTube (supprimée dans YouTube Studio ?)',
            checked_at: now,
          });
          continue;
        }
        const read = stateFromYouTube({
          privacyStatus: video.status?.privacyStatus,
          publishAt: video.status?.publishAt ?? null,
          uploadStatus: video.status?.uploadStatus,
        });
        const stillPrivate =
          read.state === 'to-schedule' &&
          item.visibility === 'scheduled' &&
          Date.parse(item.scheduled_at) < Date.now();
        store.updateItem(item.id, {
          state: read.state,
          error: read.error ?? null,
          yt_privacy: video.status?.privacyStatus ?? null,
          yt_publish_at: video.status?.publishAt ?? null,
          checked_at: now,
          published_at: read.state === 'published' ? (item.published_at ?? now) : item.published_at,
          warning: stillPrivate
            ? 'Toujours privée après la date prévue : vérifie dans YouTube Studio (projet Google non audité ?).'
            : item.warning,
        });
      }
      return items.length;
    };

    // Reminders -------------------------------------------------------------

    let startupSummaryDone = false;
    /** Elements that need the user: Instagram to post, YouTube to schedule or still to send. */
    const needingUser = (now: Date) =>
      itemsDto(store.allItems()).filter(
        (item) =>
          Date.parse(item.scheduledAt) <= now.getTime() &&
          (item.platform === 'instagram'
            ? item.status !== 'published'
            : item.status === 'to-schedule' ||
              item.status === 'planned' ||
              item.status === 'failed'),
      );

    const remind = () => {
      if (ctx.settings.get<boolean>('remindInstagram') === false) return;
      const now = new Date();
      const due = needingUser(now);
      if (!startupSummaryDone) {
        startupSummaryDone = true;
        if (due.length > 0) {
          ctx.notifications.notify({
            title: 'Planning de sortie',
            body:
              due.length === 1
                ? `À publier : ${due[0]!.label} — ${due[0]!.trackTitle}`
                : `${due.length} publications dues ou en retard`,
            path: '',
          });
        }
        for (const item of due) store.updateItem(item.id, { reminded_at: now.toISOString() });
        return;
      }
      const fresh = due.filter((item) => !store.item(item.id)?.reminded_at);
      if (fresh.length === 0) return;
      if (fresh.length > 3) {
        ctx.notifications.notify({
          title: 'Planning de sortie',
          body: `${fresh.length} publications à faire maintenant`,
          path: '',
        });
      } else {
        for (const item of fresh) {
          ctx.notifications.notify({
            title:
              item.platform === 'instagram'
                ? 'À publier sur Instagram'
                : item.status === 'to-schedule'
                  ? 'À programmer dans YouTube Studio'
                  : 'À envoyer sur YouTube',
            body: `${item.label} — ${item.trackTitle}${item.artist ? ` (${item.artist})` : ''}`,
            path: `?item=${item.id}`,
          });
        }
      }
      for (const item of fresh) store.updateItem(item.id, { reminded_at: now.toISOString() });
    };

    ctx.scheduler.schedule('dispatch', { everyMinutes: 1 }, async () => {
      watchAccount();
      dispatchUploads();
      remind();
    });
    ctx.scheduler.schedule('youtube-status', { everyMinutes: 30 }, async () => {
      const status = watchAccount();
      if (!status.connected || status.needsReconnect) return;
      try {
        // Refreshes the token when due: an expired authorization shows up here,
        // even with nothing on YouTube to check.
        await ctx.accounts.accessToken(GOOGLE);
        await checkStatuses();
      } catch (error) {
        if (error instanceof AccountError && error.code === 'reauth-required') {
          notifyReconnect();
          return;
        }
        throw error;
      }
    });

    // A new video of a track whose planned video is gone: it takes its place.
    ctx.events.on('youtube-video:video.created', (payload) => {
      const { trackId } = payload as { trackId: number };
      const release = store.releaseByTrack(trackId);
      if (!release) return;
      const current = release.video_id ? youtubeVideos.getVideo(release.video_id) : null;
      if (current?.exists) return;
      const newest = youtubeVideos.listVideos(trackId).find((video) => video.exists);
      if (newest) {
        store.updateRelease(release.id, { video_id: newest.id });
        ctx.logger.info(`Nouvelle vidéo attachée à la sortie de « ${trackId} »`);
      }
    });

    // Routes ----------------------------------------------------------------

    ctx.routes.get('/summary', () => {
      const now = new Date();
      const today = local(now.toISOString()).date;
      const usage = store.quotaUsage(quotaDay(now));
      const slots = uploadSlots(now);
      return {
        today,
        timeZone: timeZone(),
        defaultTime: defaultTime(),
        maxPerDay: maxPerDay(),
        account: ctx.accounts.status(GOOGLE),
        quota: { ...usage, ...limits(), nextReset: nextQuotaReset(now).toISOString() },
        queue: slots.length,
        quotaMessage: quotaMessage(slots, now, formatInstant),
        templateErrors: parseTemplate(ctx.settings.get<string>('planTemplate') ?? DEFAULT_TEMPLATE)
          .errors,
      };
    });

    ctx.routes.get('/calendar', (request) => {
      const { from, to } = request.query as { from?: string; to?: string };
      if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Période invalide');
      const fromUtc = zonedToUtc(from, '00:00', timeZone()).toISOString();
      const toUtc = zonedToUtc(addDays(to, 1), '00:00', timeZone()).toISOString();
      const items = store
        .allItems()
        .filter((item) => item.scheduled_at >= fromUtc && item.scheduled_at < toUtc);
      return { items: itemsDto(items) };
    });

    ctx.routes.get('/today', () => {
      const now = new Date();
      const today = local(now.toISOString()).date;
      const all = itemsDto(store.allItems());
      return {
        date: today,
        today: all.filter((item) => item.date === today),
        late: all.filter((item) => item.late && item.date < today),
        upcoming: all.filter((item) => item.date > today && item.date <= addDays(today, 7)),
        account: ctx.accounts.status(GOOGLE),
      };
    });

    ctx.routes.get('/tracks', () =>
      library.listTracks().map((track) => {
        const pack = packs.getPack(track.id);
        const videos = youtubeVideos.listVideos(track.id);
        const release = store.releaseByTrack(track.id);
        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          coverUrl: mediaUrl(track.coverPath),
          videos: videos.filter((v) => v.exists).length,
          pack: pack
            ? { items: pack.items.length, rendered: pack.items.filter((i) => i.filePath).length }
            : null,
          releaseId: release?.id ?? null,
          releaseDate: release?.release_date ?? null,
        };
      }),
    );

    ctx.routes.post('/plan', (request) => proposePlan(planInput(body(request))));

    ctx.routes.post('/releases', (request) => {
      const input = body(request);
      const plan = proposePlan(planInput(input));
      if (store.releaseByTrack(plan.track.id)) {
        throw new HttpError(
          409,
          'Ce morceau est déjà planifié : modifie-le dans le calendrier ou retire-le d’abord',
        );
      }
      if (plan.items.length === 0) throw new HttpError(400, 'Rien à planifier pour ce morceau');
      // Dates edited in the dialog (optional): { items: [{ kind, position, date, time }] }.
      const edited = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]) : [];
      const tz = timeZone();
      const created = store.createRelease({
        trackId: plan.track.id,
        date: String(input.date),
        time: plan.items[0]?.time ?? defaultTime(),
        videoId: plan.videoId,
        items: plan.items.map((item) => {
          const change = edited.find(
            (e) => e.kind === item.kind && Number(e.position) === item.position,
          );
          const date = change && isDate(change.date) ? change.date : item.date;
          const time = change && isTime(change.time) ? change.time : item.time;
          return {
            kind: item.kind,
            position: item.position,
            scheduledAt: zonedToUtc(date, time, tz).toISOString(),
            shiftedFrom: item.shifted ? item.templateDate : null,
            packItemId: item.packItemId,
            title: PLATFORM[item.kind] === 'youtube' ? item.title : null,
            description: PLATFORM[item.kind] === 'youtube' ? item.description : null,
            tags: PLATFORM[item.kind] === 'youtube' ? item.tags : null,
          };
        }),
      });
      return { release: releaseDto(created), shifts: plan.shifts, warnings: plan.warnings };
    });

    ctx.routes.get('/releases', () => store.allReleases().map(releaseDto));
    ctx.routes.get('/releases/:id', (request) =>
      releaseDto(store.requireRelease(idParam(request.params))),
    );

    // Another generated video for the release (the planned one was deleted…).
    ctx.routes.patch('/releases/:id', (request) => {
      const release = store.requireRelease(idParam(request.params));
      const input = body(request);
      if (input.videoId !== undefined) {
        const video = youtubeVideos.getVideo(Number(input.videoId));
        if (!video || video.trackId !== release.track_id)
          throw new HttpError(400, 'Vidéo introuvable');
        const item = store.itemsOf(release.id).find((i) => i.kind === 'youtube');
        if (item && (isOnline(item.state) || item.state === 'uploading')) {
          throw new HttpError(409, 'La vidéo est déjà envoyée sur YouTube');
        }
        store.updateRelease(release.id, { video_id: video.id });
        if (item) store.updateItem(item.id, { upload_url: null });
      }
      return releaseDto(store.requireRelease(release.id));
    });

    ctx.routes.post('/releases/:id/upload', (request) => {
      requireAccount();
      const release = store.requireRelease(idParam(request.params));
      const todo = store
        .itemsOf(release.id)
        .filter(
          (item) =>
            PLATFORM[item.kind] === 'youtube' &&
            (item.state === 'planned' || item.state === 'failed'),
        );
      const skipped: string[] = [];
      for (const item of todo) {
        try {
          queueUpload(item);
        } catch (error) {
          skipped.push(message(error));
        }
      }
      dispatchUploads();
      return {
        queued: todo.length - skipped.length,
        skipped,
        quotaMessage: quotaMessage(uploadSlots(), new Date(), formatInstant),
        release: releaseDto(store.requireRelease(release.id)),
      };
    });

    /** Removes elements; those online stay on YouTube unless `online: "delete"` is explicit. */
    const removeItems = async (items: ItemRow[], online: unknown) => {
      const live = items.filter((item) => item.yt_video_id && isOnline(item.state));
      if (live.length > 0 && online !== 'keep' && online !== 'delete') {
        throw new HttpError(
          409,
          `${live.length} élément(s) déjà sur YouTube : choisis « Retirer du planning seulement » ou « Supprimer aussi sur YouTube »`,
        );
      }
      for (const item of items) {
        if (item.state === 'uploading' && item.job_id) ctx.jobs.cancel(item.job_id);
        if (online === 'delete' && item.yt_video_id && isOnline(item.state)) {
          spendUnits(UNIT_COST.delete);
          await deleteVideo(youtube, item.yt_video_id);
          ctx.logger.info(`Vidéo ${item.yt_video_id} supprimée de YouTube (demande explicite)`);
          if (item.kind === 'youtube') {
            const release = store.release(item.release_id);
            if (release?.video_id) youtubeVideos.setUploaded(release.video_id, null);
          }
        }
        store.deleteItem(item.id);
      }
    };

    ctx.routes.delete('/releases/:id', async (request) => {
      const release = store.requireRelease(idParam(request.params));
      await removeItems(store.itemsOf(release.id), (request.query as { online?: string }).online);
      if (release.thumbnail_path) await ctx.outputs.delete({ ref: `thumbnail:${release.id}` });
      store.deleteRelease(release.id);
      return { ok: true };
    });

    ctx.routes.delete('/items/:id', async (request) => {
      const item = store.requireItem(idParam(request.params));
      await removeItems([item], (request.query as { online?: string }).online);
      return { ok: true };
    });

    ctx.routes.patch('/items/:id', async (request) => {
      const item = store.requireItem(idParam(request.params));
      const input = body(request);
      const youtubeItem = PLATFORM[item.kind] === 'youtube';
      const warnings: string[] = [];
      const fields: Parameters<PlannerStore['updateItem']>[1] = {};

      const editable = !isOnline(item.state) && item.state !== 'uploading';
      for (const key of ['title', 'description', 'tags', 'visibility'] as const) {
        if (input[key] === undefined) continue;
        if (!youtubeItem) throw new HttpError(400, 'Les métadonnées ne concernent que YouTube');
        if (!editable) {
          throw new HttpError(
            409,
            'Déjà envoyée : modifie le titre et la description dans YouTube Studio',
          );
        }
      }
      if (typeof input.title === 'string') fields.title = input.title;
      if (typeof input.description === 'string') fields.description = input.description;
      if (Array.isArray(input.tags)) fields.tags = JSON.stringify(input.tags.map(String));
      if (input.visibility !== undefined) {
        if (!VISIBILITIES.includes(input.visibility as Visibility))
          throw new HttpError(400, 'Visibilité invalide');
        fields.visibility = input.visibility as Visibility;
      }

      if (input.date !== undefined || input.time !== undefined) {
        const current = local(item.scheduled_at);
        const date = input.date ?? current.date;
        const time = input.time ?? current.time;
        if (!isDate(date) || !isTime(time)) throw new HttpError(400, 'Date ou heure invalide');
        const scheduledAt = zonedToUtc(date, time, timeZone()).toISOString();
        if (scheduledAt !== item.scheduled_at) {
          if (item.state === 'uploading')
            throw new HttpError(409, 'Envoi en cours : attends la fin');
          if (youtubeItem && item.state === 'published') {
            throw new HttpError(409, 'Déjà publiée sur YouTube : la date ne peut plus changer');
          }
          if (
            youtubeItem &&
            item.yt_video_id &&
            (item.state === 'scheduled' || item.state === 'to-schedule')
          ) {
            // Already on YouTube: the new date goes to YouTube first.
            spendUnits(UNIT_COST.update);
            const updated = await updateSchedule(youtube, item.yt_video_id, 'private', scheduledAt);
            fields.yt_publish_at = updated.status?.publishAt ?? scheduledAt;
            fields.yt_privacy = updated.status?.privacyStatus ?? 'private';
            fields.state = 'scheduled';
            fields.warning = null;
          }
          fields.scheduled_at = scheduledAt;
          fields.reminded_at = null;
          fields.shifted_from = null;
          const taken = store
            .allItems()
            .filter(
              (other) =>
                other.id !== item.id &&
                PLATFORM[other.kind] === PLATFORM[item.kind] &&
                local(other.scheduled_at).date === date,
            ).length;
          if (taken >= maxPerDay()) {
            warnings.push(
              `Déjà ${taken} publication(s) ${youtubeItem ? 'YouTube' : 'Instagram'} ce jour-là.`,
            );
          }
          if (Date.parse(scheduledAt) < Date.now()) warnings.push('Cette date est passée.');
        }
      }
      const updated = store.updateItem(item.id, fields);
      const release = store.requireRelease(updated.release_id);
      return { item: itemDto(updated, release, library.getTrack(release.track_id)), warnings };
    });

    ctx.routes.post('/items/:id/upload', (request) => {
      requireAccount();
      const item = store.requireItem(idParam(request.params));
      queueUpload(item);
      dispatchUploads();
      return { quotaMessage: quotaMessage(uploadSlots(), new Date(), formatInstant) };
    });

    ctx.routes.post('/items/:id/cancel', (request) => {
      const item = store.requireItem(idParam(request.params));
      if (item.state === 'queued') {
        if (item.job_id) ctx.jobs.cancel(item.job_id);
        store.updateItem(item.id, { state: 'planned', job_id: null, not_before: null });
      } else if (item.state === 'uploading' && item.job_id) {
        ctx.jobs.cancel(item.job_id);
      }
      return { ok: true };
    });

    // Instagram: the « Publié » box of the pack, from the calendar.
    ctx.routes.post('/items/:id/published', (request) => {
      const item = store.requireItem(idParam(request.params));
      if (PLATFORM[item.kind] !== 'instagram' || !item.pack_item_id) {
        throw new HttpError(400, 'Seuls les éléments Instagram se cochent à la main');
      }
      const published = body(request).published === true;
      packs.setPublished(item.pack_item_id, published);
      const release = store.requireRelease(item.release_id);
      return itemDto(store.requireItem(item.id), release, library.getTrack(release.track_id));
    });

    ctx.routes.post('/items/:id/regenerate', (request) => {
      const item = store.requireItem(idParam(request.params));
      const release = store.requireRelease(item.release_id);
      try {
        if (item.kind === 'youtube') return youtubeVideos.render(release.track_id);
        if (!item.pack_item_id) throw new Error('Élément du pack introuvable');
        return packs.renderItem(item.pack_item_id);
      } catch (error) {
        throw new HttpError(409, message(error));
      }
    });

    ctx.routes.post('/items/:id/reveal', (request) => {
      const item = store.requireItem(idParam(request.params));
      const source = sourceOf(store.requireRelease(item.release_id), item);
      if (!source.exists || !source.filePath) throw new HttpError(404, 'Fichier introuvable');
      ctx.files.reveal(source.filePath);
      return { ok: true };
    });

    ctx.routes.post('/check-now', async () => {
      try {
        return { checked: await checkStatuses() };
      } catch (error) {
        if (error instanceof AccountError && error.code === 'reauth-required') notifyReconnect();
        throw error;
      }
    });

    // Google account (the OAuth client is entered in Réglages > Comptes connectés).
    let channel: { id: string; title: string } | null = null;
    ctx.routes.get('/account', async (request) => {
      const status = ctx.accounts.status(GOOGLE);
      if (
        status.connected &&
        !status.needsReconnect &&
        (!channel || (request.query as { refresh?: string }).refresh)
      ) {
        try {
          spendUnits(UNIT_COST.list);
          channel = await myChannel(youtube);
        } catch (error) {
          ctx.logger.warn('Chaîne YouTube illisible', error);
        }
      }
      return { status: ctx.accounts.status(GOOGLE), channel: status.connected ? channel : null };
    });

    ctx.routes.post('/account/connect', async () => {
      const status = await ctx.accounts.connect(GOOGLE, YOUTUBE_SCOPES);
      channel = null;
      try {
        spendUnits(UNIT_COST.list);
        channel = await myChannel(youtube);
      } catch (error) {
        ctx.logger.warn('Chaîne YouTube illisible', error);
      }
      reconnectNotified = false;
      dispatchUploads();
      return { status, channel };
    });
  },
});
