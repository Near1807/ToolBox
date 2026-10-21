// « Sans projet » > Rattacher with the real modules: the core record AND each
// module's own row follow (ctx.outputs.onReattach), all or nothing.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutputRecord } from '@hub/sdk/backend';
import {
  createTestHost,
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type TestHub,
} from '@hub/sdk/testing';
import type { TrackDto } from '../contract';
import { createMediaFixtures } from './fixtures';

const MODULES = path.resolve(import.meta.dirname, '../..');
const LIB = '/api/modules/music-library';

interface YouTubeTrack {
  videos: { id: number; fileName: string }[];
}
interface InstaTrack {
  pack: {
    id: number;
    items: { id: number; kind: string; position: number; fileName: string | null }[];
  } | null;
}
interface ReelsTrack {
  sources: { id: number }[];
  reels: { id: number; position: number; fileName: string | null }[];
}

describe('reattaching « Sans projet » elements, module by module', () => {
  let modules: DiscoveredModule[];
  let dataDir: string;
  let dir: string;
  let hub: TestHub;
  const now = new Date().toISOString();

  const start = async () =>
    createTestHub({
      modules,
      dataDir,
      host: createTestHost({ getDefaultOutputRoot: () => path.join(dir, 'out') }),
    });
  const file = (name: string) => {
    const target = path.join(dir, 'out', name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'x');
    return target;
  };
  const sql = (statement: string, ...values: unknown[]) =>
    Number(hub.hub.handle.db.prepare(statement).run(...values).lastInsertRowid);
  const get = async <T>(url: string) => (await hub.request<T>('GET', url)).body;
  const orphans = () => get<OutputRecord[]>(`${LIB}/orphans`);
  const attach = (ids: number[], trackId: number) =>
    hub.request<{ attached?: number; error?: string }>('POST', `${LIB}/orphans/attach`, {
      ids,
      trackId,
    });

  beforeAll(async () => {
    const media = createMediaFixtures();
    dir = mkdtempSync(path.join(tmpdir(), 'toolbox-reattach-'));
    dataDir = path.join(dir, 'data');
    modules = await Promise.all(
      [
        'music-library',
        'video-engine',
        'youtube-video',
        'instagram-video',
        'custom-reels',
        'release-planner',
      ].map((m) => loadModuleFolder(path.join(MODULES, m))),
    );
    hub = await start();
    const track = async () =>
      (await hub.request<TrackDto>('POST', `${LIB}/tracks`, { audioPath: media.wav })).body.id;
    const [gone, gone2, target, full] = [
      await track(),
      await track(),
      await track(),
      await track(),
    ];

    // Elements made from « gone » and « gone2 » (as their renders would leave them).
    sql(
      'INSERT INTO youtube_video__videos (track_id, file_path, title, created_at) VALUES (?, ?, ?, ?)',
      gone,
      file('gone.mp4'),
      'Vidéo',
      now,
    );
    const pack = (trackId: number) =>
      sql(
        `INSERT INTO instagram_video__packs (track_id, clip_duration, caption, folder, created_at, updated_at)
         VALUES (?, 15, 'Légende', ?, ?, ?)`,
        trackId,
        path.join(dir, 'out', `pack${trackId}`),
        now,
        now,
      );
    const item = (packId: number, position: number, filePath: string | null) =>
      sql(
        `INSERT INTO instagram_video__pack_items (pack_id, kind, position, start_sec, duration_sec, file_path, rendered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        packId,
        position === 0 ? 'post' : 'reel',
        position,
        position === 0 ? null : 10,
        position === 0 ? null : 15,
        filePath,
        filePath ? now : null,
      );
    const goneKit = pack(gone);
    item(goneKit, 0, file('gone-post.jpg'));
    item(goneKit, 1, file('gone-reel1.mp4'));
    const gone2Kit = pack(gone2);
    item(gone2Kit, 0, file('gone2-post.jpg'));
    item(gone2Kit, 1, file('gone2-reel1.mp4'));
    // « full » already has a pack: an empty post, a rendered Reel 1.
    const fullKit = pack(full);
    item(fullKit, 0, null);
    item(fullKit, 1, file('full-reel1.mp4'));

    const source = sql(
      `INSERT INTO custom_reels__sources (track_id, file_path, name, duration_sec, width, height, created_at)
       VALUES (?, ?, 'clip.mp4', 6, 640, 360, ?)`,
      gone,
      file('clip.mp4'),
      now,
    );
    sql(
      `INSERT INTO custom_reels__reels (track_id, position, start_sec, duration_sec, segments, file_path, rendered_at, created_at, updated_at)
       VALUES (?, 2, 0, 15, ?, ?, ?, ?, ?)`,
      gone,
      JSON.stringify([{ sourceId: source, start: 0, end: 6 }]),
      file('gone-perso.mp4'),
      now,
      now,
      now,
    );
    // Next start: each module registers its files (ctx.outputs), as after an update.
    await hub.close();
    hub = await start();
    for (const id of [gone, gone2]) await hub.request('DELETE', `${LIB}/tracks/${id}`);
    Object.assign(ids, { gone, gone2, target, full });
  }, 60_000);

  const ids = { gone: 0, gone2: 0, target: 0, full: 0 };

  afterAll(async () => {
    await hub.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('moves the video, the whole pack and the Reel perso (with its video) to the chosen track', async () => {
    const list = await orphans();
    const ofGone = list.filter((r) => r.subject === `music-library:track:${ids.gone}`);
    expect(ofGone.map((r) => r.moduleId).sort()).toEqual([
      'custom-reels',
      'instagram-video',
      'instagram-video',
      'youtube-video',
    ]);
    const res = await attach(
      ofGone.filter((r) => r.ref !== 'item:2').map((r) => r.id), // the Reel 1 follows its pack
      ids.target,
    );
    expect(res.body).toEqual({ attached: 3 });

    const yt = await get<YouTubeTrack>(`/api/modules/youtube-video/tracks/${ids.target}`);
    expect(yt.videos.map((v) => v.fileName)).toEqual(['gone.mp4']);
    const insta = await get<InstaTrack>(`/api/modules/instagram-video/tracks/${ids.target}`);
    expect(insta.pack?.items.map((i) => i.fileName)).toEqual(['gone-post.jpg', 'gone-reel1.mp4']);
    const reels = await get<ReelsTrack>(`/api/modules/custom-reels/tracks/${ids.target}`);
    expect(reels.reels).toMatchObject([{ position: 1, fileName: 'gone-perso.mp4' }]);
    expect(reels.sources).toHaveLength(1);
    // Everything is in the project of the track now, nothing left « Sans projet » from it.
    const project = await get<OutputRecord[]>(`${LIB}/tracks/${ids.target}/project`);
    expect(project.map((r) => r.fileName).sort()).toEqual([
      'gone-perso.mp4',
      'gone-post.jpg',
      'gone-reel1.mp4',
      'gone.mp4',
    ]);
    expect((await orphans()).filter((r) => r.subject?.endsWith(`:${ids.gone}`))).toEqual([]);
  });

  it('takes the same place in an existing pack, and refuses a taken one (all or nothing)', async () => {
    const list = (await orphans()).filter((r) => r.subject === `music-library:track:${ids.gone2}`);
    const post = list.find((r) => r.fileName === 'gone2-post.jpg')!;
    const reel = list.find((r) => r.fileName === 'gone2-reel1.mp4')!;
    // Reel 1 of « full » already has a file: refused, and the post did not move either.
    const refused = await attach([post.id, reel.id], ids.full);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/déjà un fichier pour « Reel 1 »/);
    expect((await orphans()).map((r) => r.id)).toEqual(expect.arrayContaining([post.id, reel.id]));
    // The post alone: it takes the empty post of the pack.
    expect((await attach([post.id], ids.full)).body).toEqual({ attached: 1 });
    const insta = await get<InstaTrack>(`/api/modules/instagram-video/tracks/${ids.full}`);
    expect(insta.pack?.items.map((i) => i.fileName)).toEqual(['gone2-post.jpg', 'full-reel1.mp4']);
    const record = (await get<OutputRecord[]>(`${LIB}/tracks/${ids.full}/project`)).find(
      (r) => r.id === post.id,
    );
    expect(record?.ref).toBe(`item:${insta.pack!.items[0]!.id}`);
  });
});
