import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getVideos,
  updateSchedule,
  uploadVideo,
  YouTubeApiError,
  type AuthorizedFetch,
  type VideoMetadata,
} from '../backend/youtube';
import { MockGoogle } from './mock-google';

const CHUNK = 256 * 1024;
const metadata: VideoMetadata = {
  title: 'Drop',
  description: 'Le son',
  tags: ['lofi'],
  language: 'fr',
  privacyStatus: 'private',
  publishAt: '2026-11-06T17:00:00.000Z',
};

describe('YouTube client (resumable upload)', () => {
  let google: MockGoogle;
  let dir: string;
  let file: string;
  const size = CHUNK * 4 + 1234;
  let api: AuthorizedFetch;
  let token = '';

  beforeAll(async () => {
    google = await new MockGoogle().start();
    dir = mkdtempSync(path.join(tmpdir(), 'toolbox-yt-'));
    file = path.join(dir, 'video.mp4');
    writeFileSync(file, Buffer.alloc(size, 7));
    api = (url, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      return fetch(url.startsWith('/') ? `${google.base}${url}` : url, { ...init, headers });
    };
  });
  beforeEach(() => {
    token = google.issueToken();
  });
  afterAll(async () => {
    await google.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const upload = (extra: Partial<Parameters<typeof uploadVideo>[1]> = {}) => {
    const sessions: (string | null)[] = [];
    const progress: number[] = [];
    const promise = uploadVideo(api, {
      file,
      size,
      metadata,
      sessionUrl: null,
      onSession: (url) => sessions.push(url),
      onProgress: (fraction) => progress.push(fraction),
      chunkBytes: CHUNK,
      retryDelayMs: 5,
      ...extra,
    });
    return { promise, sessions, progress };
  };

  it('uploads in chunks and returns the video, scheduled', async () => {
    const { promise, sessions, progress } = upload();
    const video = await promise;
    expect(video.status).toMatchObject({ privacyStatus: 'private', publishAt: metadata.publishAt });
    expect(google.videos.get(video.id)!.bytes).toBe(size);
    expect(sessions).toHaveLength(1);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeGreaterThanOrEqual(5);
    const snippet = google.videos.get(video.id)!.snippet;
    expect(snippet).toMatchObject({ categoryId: '10', defaultLanguage: 'fr', title: 'Drop' });
  });

  it('resumes after a network cut, from the bytes YouTube received', async () => {
    google.cutAfterBytes = CHUNK * 2 + 1000;
    const before = google.log.length;
    const video = await upload().promise;
    expect(google.videos.get(video.id)!.bytes).toBe(size);
    const calls = google.log.slice(before);
    // One status query after the cut, then the upload goes on (not from 0).
    expect(calls.filter((c) => c.startsWith('POST /upload/youtube/v3/videos'))).toHaveLength(1);
    expect(google.cutAfterBytes).toBeNull();
  });

  it('retries 5xx answers, then gives up with a clear error', async () => {
    google.fail503 = 2;
    await expect(upload().promise).resolves.toMatchObject({ id: expect.any(String) });
    google.fail503 = 10;
    const failing = upload({ retries: 2 }).promise;
    await expect(failing).rejects.toBeInstanceOf(YouTubeApiError);
    google.fail503 = 0;
  });

  it('resumes a session kept from a previous run of the app', async () => {
    const controller = new AbortController();
    const first = upload({
      signal: controller.signal,
      onProgress: (fraction) => {
        if (fraction > 0.3) controller.abort();
      },
    });
    await expect(first.promise).rejects.toBeTruthy();
    const kept = first.sessions.at(-1)!;
    expect(kept).toContain('/upload-session/');
    const before = google.log.length;
    const video = await upload({ sessionUrl: kept }).promise;
    expect(google.videos.get(video.id)!.bytes).toBe(size);
    const calls = google.log.slice(before);
    expect(calls.some((c) => c.startsWith('POST /upload/youtube/v3/videos'))).toBe(false);
    // Status query + the remaining chunks only.
    expect(calls.length).toBeLessThan(5);
  });

  it('reports « quota exceeded » as such', async () => {
    google.quotaExceeded = true;
    const error = await upload().promise.catch((e: unknown) => e);
    google.quotaExceeded = false;
    expect(error).toBeInstanceOf(YouTubeApiError);
    expect((error as YouTubeApiError).quotaExceeded).toBe(true);
    expect((error as Error).message).toContain('quota YouTube du jour dépassé');
  });

  it('moves the publication date (whole status part, private)', async () => {
    const video = await upload().promise;
    const updated = await updateSchedule(api, video.id, 'private', '2026-11-08T17:00:00.000Z');
    expect(updated.status).toMatchObject({
      privacyStatus: 'private',
      publishAt: '2026-11-08T17:00:00.000Z',
    });
    const read = await getVideos(api, [video.id, 'missing']);
    expect(read.get(video.id)!.status!.publishAt).toBe('2026-11-08T17:00:00.000Z');
    expect(read.has('missing')).toBe(false);
  });
});
