// YouTube Data API v3 client: resumable upload (with resume after a network
// cut), scheduling, status, thumbnail, playlist. Every call goes through an
// authorized fetch (ctx.accounts.fetch: bearer token, refresh on 401), so the
// same code runs against Google or against the mock server of the tests.
// Protocol: developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
import { open } from 'node:fs/promises';

export type AuthorizedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Chunks must be multiples of 256 KiB (except the last one). */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const MUSIC_CATEGORY_ID = '10';

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  language: string;
  /** "scheduled": private until publishAt, then public. */
  privacyStatus: 'private' | 'unlisted' | 'public';
  publishAt?: string;
}

export interface VideoResource {
  id: string;
  status?: {
    privacyStatus?: string;
    publishAt?: string | null;
    uploadStatus?: string;
    rejectionReason?: string;
    failureReason?: string;
  };
}

/** Reasons that mean « no more uploads today » (quota of the project or of the channel). */
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'uploadLimitExceeded']);

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }

  get quotaExceeded(): boolean {
    return this.reason !== null && QUOTA_REASONS.has(this.reason);
  }
}

const FRENCH_REASONS: Record<string, string> = {
  quotaExceeded: 'quota YouTube du jour dépassé',
  dailyLimitExceeded: 'quota YouTube du jour dépassé',
  uploadLimitExceeded: 'limite d’envois de la chaîne atteinte pour aujourd’hui',
  forbidden: 'action non autorisée pour cette vidéo ou cette chaîne',
  invalidPublishAt: 'date de publication refusée par YouTube',
  videoNotFound: 'vidéo introuvable sur YouTube',
  invalidTitle: 'titre refusé par YouTube',
  invalidDescription: 'description refusée par YouTube',
  invalidTags: 'tags refusés par YouTube',
  mediaBodyRequired: 'fichier vidéo manquant',
  youtubeSignupRequired: 'ce compte Google n’a pas de chaîne YouTube',
};

export async function apiError(response: Response, what: string): Promise<YouTubeApiError> {
  let reason: string | null = null;
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as {
      error?: { message?: string; errors?: { reason?: string; message?: string }[] };
    };
    reason = body.error?.errors?.[0]?.reason ?? null;
    message = body.error?.message ?? message;
  } catch {
    // Not JSON.
  }
  const retryable =
    response.status >= 500 || response.status === 429 || reason === 'rateLimitExceeded';
  const french = reason ? FRENCH_REASONS[reason] : undefined;
  return new YouTubeApiError(
    `${what} : ${french ?? message}${french ? '' : reason ? ` (${reason})` : ''}`,
    response.status,
    reason,
    retryable,
  );
}

/** Body of videos.insert / videos.update. */
export function videoResource(metadata: VideoMetadata, id?: string) {
  return {
    ...(id ? { id } : {}),
    snippet: {
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      categoryId: MUSIC_CATEGORY_ID,
      defaultLanguage: metadata.language,
      defaultAudioLanguage: metadata.language,
    },
    status: statusPart(metadata.privacyStatus, metadata.publishAt),
  };
}

/** The whole status part: videos.update resets what is left out. */
export function statusPart(privacyStatus: VideoMetadata['privacyStatus'], publishAt?: string) {
  return {
    privacyStatus,
    ...(publishAt ? { publishAt } : {}),
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: false,
    embeddable: true,
    license: 'youtube',
    publicStatsViewable: true,
  };
}

/** Opens a resumable upload session; returns its URL. */
export async function startUpload(
  fetch: AuthorizedFetch,
  metadata: VideoMetadata,
  size: number,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(
    '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(size),
        'x-upload-content-type': 'video/mp4',
      },
      body: JSON.stringify(videoResource(metadata)),
      signal,
    },
  );
  if (!response.ok) throw await apiError(response, 'Envoi refusé');
  const location = response.headers.get('location');
  await response.body?.cancel();
  if (!location)
    throw new YouTubeApiError('Envoi refusé : pas d’adresse de session', 500, null, true);
  return location;
}

type UploadAnswer = { done: VideoResource } | { next: number } | { expired: true };

async function readAnswer(response: Response): Promise<UploadAnswer> {
  if (response.status === 200 || response.status === 201) {
    return { done: (await response.json()) as VideoResource };
  }
  if (response.status === 308) {
    const range = response.headers.get('range');
    await response.body?.cancel();
    const match = range ? /bytes=\d+-(\d+)/.exec(range) : null;
    return { next: match ? Number(match[1]) + 1 : 0 };
  }
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel();
    return { expired: true };
  }
  throw await apiError(response, 'Envoi interrompu');
}

/** Where an interrupted upload stands: bytes received, or the finished video. */
export async function queryUpload(
  fetch: AuthorizedFetch,
  sessionUrl: string,
  size: number,
  signal?: AbortSignal,
): Promise<UploadAnswer> {
  return readAnswer(
    await fetch(sessionUrl, {
      method: 'PUT',
      headers: { 'content-range': `bytes */${size}`, 'content-length': '0' },
      redirect: 'manual',
      signal,
    }),
  );
}

export interface UploadOptions {
  file: string;
  size: number;
  metadata: VideoMetadata;
  /** Session of an interrupted upload (kept in the database): resumed, not restarted. */
  sessionUrl: string | null;
  /** Called when a session starts (to keep it) or expires (null). */
  onSession: (url: string | null) => void;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
  chunkBytes?: number;
  /** Network errors and 5xx: retried with exponential backoff. */
  retries?: number;
  retryDelayMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Network error, 5xx, 429: worth another try. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof YouTubeApiError) return error.retryable;
  // fetch() failures (connection reset, DNS, cut cable) are TypeErrors.
  return error instanceof TypeError;
}

/** Uploads a video (resumable, chunked) and returns the created resource. */
export async function uploadVideo(
  fetch: AuthorizedFetch,
  options: UploadOptions,
): Promise<VideoResource> {
  const chunkBytes = options.chunkBytes ?? UPLOAD_CHUNK_BYTES;
  const retries = options.retries ?? 6;
  const delay = options.retryDelayMs ?? 2000;
  const { signal, size } = options;
  let sessionUrl = options.sessionUrl;
  let offset = 0;
  let mustQuery = sessionUrl !== null;
  let failures = 0;
  const handle = await open(options.file, 'r');
  try {
    for (;;) {
      signal?.throwIfAborted();
      try {
        if (!sessionUrl) {
          sessionUrl = await startUpload(fetch, options.metadata, size, signal);
          options.onSession(sessionUrl);
          offset = 0;
          mustQuery = false;
        }
        let answer: UploadAnswer;
        const queried = mustQuery;
        if (mustQuery) {
          answer = await queryUpload(fetch, sessionUrl, size, signal);
          mustQuery = false;
        } else {
          const end = Math.min(offset + chunkBytes, size);
          const chunk = Buffer.alloc(end - offset);
          await handle.read(chunk, 0, chunk.length, offset);
          answer = await readAnswer(
            await fetch(sessionUrl, {
              method: 'PUT',
              headers: {
                'content-type': 'video/mp4',
                'content-range': `bytes ${offset}-${end - 1}/${size}`,
              },
              body: chunk,
              redirect: 'manual',
              signal,
            }),
          );
        }
        if ('done' in answer) {
          options.onProgress(1);
          return answer.done;
        }
        if ('expired' in answer) {
          // Sessions last about a week: start again from the beginning.
          sessionUrl = null;
          options.onSession(null);
          continue;
        }
        if (answer.next > offset) failures = 0;
        else if (!queried && ++failures > retries) {
          throw new YouTubeApiError(
            'Envoi bloqué : YouTube ne reçoit plus les données',
            500,
            null,
            false,
          );
        }
        offset = answer.next;
        options.onProgress(size > 0 ? offset / size : 0);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (!isRetryable(error) || failures >= retries) throw error;
        failures++;
        await sleep(delay * 2 ** (failures - 1), signal);
        // Ask the server what it received before sending more.
        mustQuery = sessionUrl !== null;
      }
    }
  } finally {
    await handle.close();
  }
}

export async function getVideos(
  fetch: AuthorizedFetch,
  ids: string[],
): Promise<Map<string, VideoResource>> {
  const found = new Map<string, VideoResource>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const response = await fetch(
      `/youtube/v3/videos?part=status&id=${batch.map(encodeURIComponent).join(',')}`,
    );
    if (!response.ok) throw await apiError(response, 'Lecture du statut impossible');
    const body = (await response.json()) as { items?: VideoResource[] };
    for (const item of body.items ?? []) found.set(item.id, item);
  }
  return found;
}

/** Moves (or sets) the publication date; the video must be private and never published. */
export async function updateSchedule(
  fetch: AuthorizedFetch,
  videoId: string,
  privacyStatus: VideoMetadata['privacyStatus'],
  publishAt?: string,
): Promise<VideoResource> {
  const response = await fetch('/youtube/v3/videos?part=status', {
    method: 'PUT',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ id: videoId, status: statusPart(privacyStatus, publishAt) }),
  });
  if (!response.ok) throw await apiError(response, 'Programmation refusée');
  return (await response.json()) as VideoResource;
}

export async function setThumbnail(
  fetch: AuthorizedFetch,
  videoId: string,
  image: Buffer,
): Promise<void> {
  const response = await fetch(
    `/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
    { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(image) },
  );
  if (!response.ok) throw await apiError(response, 'Miniature refusée');
  await response.body?.cancel();
}

/** A playlist of the channel by its ID ("PL…") or its exact title; null when not found. */
export async function findPlaylist(
  fetch: AuthorizedFetch,
  nameOrId: string,
): Promise<{ id: string; title: string } | null> {
  const wanted = nameOrId.trim();
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const response = await fetch(
      `/youtube/v3/playlists?part=snippet&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`,
    );
    if (!response.ok) throw await apiError(response, 'Lecture des playlists impossible');
    const body = (await response.json()) as {
      items?: { id: string; snippet?: { title?: string } }[];
      nextPageToken?: string;
    };
    const match = body.items?.find(
      (item) =>
        item.id === wanted || item.snippet?.title?.trim().toLowerCase() === wanted.toLowerCase(),
    );
    if (match) return { id: match.id, title: match.snippet?.title ?? wanted };
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return null;
}

export async function addToPlaylist(
  fetch: AuthorizedFetch,
  playlistId: string,
  videoId: string,
): Promise<void> {
  const response = await fetch('/youtube/v3/playlistItems?part=snippet', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
    }),
  });
  if (!response.ok) throw await apiError(response, 'Ajout à la playlist refusé');
  await response.body?.cancel();
}

export async function deleteVideo(fetch: AuthorizedFetch, videoId: string): Promise<void> {
  const response = await fetch(`/youtube/v3/videos?id=${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) {
    throw await apiError(response, 'Suppression sur YouTube refusée');
  }
  await response.body?.cancel();
}

/** Name of the channel of the connected account. */
export async function myChannel(
  fetch: AuthorizedFetch,
): Promise<{ id: string; title: string } | null> {
  const response = await fetch('/youtube/v3/channels?part=snippet&mine=true');
  if (!response.ok) throw await apiError(response, 'Lecture de la chaîne impossible');
  const body = (await response.json()) as {
    items?: { id: string; snippet?: { title?: string } }[];
  };
  const channel = body.items?.[0];
  return channel ? { id: channel.id, title: channel.snippet?.title ?? '' } : null;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const shortUrl = (id: string) => `https://www.youtube.com/shorts/${id}`;
export const studioUrl = (id: string) => `https://studio.youtube.com/video/${id}/edit`;
