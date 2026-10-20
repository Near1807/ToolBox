// video-engine: the single render engine shared by the video generators.
// No page of its own: renders run inside the callers' jobs (Tâches page).
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { defineBackendModule } from '@hub/sdk/backend';
import {
  VIDEO_ENGINE_SERVICE,
  type RenderHandlers,
  type VideoEngineService,
  type VideoFormat,
  type VideoFormatInfo,
} from '../contract';
import { FORMATS, THUMBNAIL_SPEC } from './commands';
import {
  FONT_FILE,
  probeDuration,
  renderPostImage,
  renderVideo,
  type EngineEnvironment,
} from './engine';

const PREVIEW_SCALE = 1 / 3;
const PREVIEWS_KEPT = 6;

/** One full render at a time: FFmpeg already uses every CPU core. */
export class RenderQueue {
  private tail: Promise<void> = Promise.resolve();
  /** Renders running or waiting. */
  private pending = 0;

  run<T>(task: () => Promise<T>, handlers: RenderHandlers): Promise<T> {
    if (this.pending > 0) {
      handlers.onProgress?.(null, 'En attente du moteur (un autre rendu est en cours)…');
    }
    this.pending++;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => (release = resolve));
    return previous.then(task).finally(() => {
      this.pending--;
      release();
    });
  }
}

export default defineBackendModule({
  register(ctx) {
    const fontsDir = ctx.files.assetPath('fonts');
    if (!existsSync(path.join(fontsDir, FONT_FILE))) {
      throw new Error(`Police introuvable : ${path.join(fontsDir, FONT_FILE)}`);
    }

    const workRoot = ctx.files.dataPath('work');
    const previewsDir = ctx.files.dataPath('previews');
    // Leftovers of an interrupted render.
    rmSync(workRoot, { recursive: true, force: true });
    mkdirSync(previewsDir, { recursive: true });

    const env = (): EngineEnvironment => ({
      ffmpeg: ctx.binaries.ffmpeg,
      ffprobe: ctx.binaries.ffprobe,
      fontsDir,
      workRoot,
    });
    const queue = new RenderQueue();

    const prunePreviews = () => {
      const files = readdirSync(previewsDir)
        .filter((f) => f.endsWith('.mp4'))
        .sort()
        .reverse();
      for (const file of files.slice(PREVIEWS_KEPT))
        rmSync(path.join(previewsDir, file), { force: true });
    };

    const formats = Object.fromEntries(
      Object.entries(FORMATS).map(([key, spec]) => [
        key,
        { label: spec.label, width: spec.width, height: spec.height },
      ]),
    ) as Record<VideoFormat, VideoFormatInfo>;

    const service: VideoEngineService = {
      formats,
      render: (request, handlers = {}) =>
        queue.run(async () => {
          ctx.logger.info(`Rendu ${request.format} : ${path.basename(request.outputPath)}`);
          const result = await renderVideo(env(), request, handlers);
          ctx.logger.info(`Rendu terminé : ${result.file}`);
          return result;
        }, handlers),
      // Previews skip the queue: a few seconds at low resolution.
      preview: async (request, handlers = {}) => {
        const outputPath = path.join(previewsDir, `${Date.now()}-${request.format}.mp4`);
        const result = await renderVideo(
          env(),
          {
            ...request,
            duration: request.previewSeconds ?? 6,
            outputPath,
            scale: PREVIEW_SCALE,
            quality: 'preview',
          },
          handlers,
        );
        prunePreviews();
        return result;
      },
      // A still image takes a second or two: no queue.
      renderPost: (request) => renderPostImage(env(), request),
      renderThumbnail: (request) => renderPostImage(env(), request, THUMBNAIL_SPEC),
      probeDuration: (audioPath) => probeDuration(ctx.binaries.ffprobe, audioPath),
    };

    ctx.services.provide(VIDEO_ENGINE_SERVICE, service);
  },
});
