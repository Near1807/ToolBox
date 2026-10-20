// Public types of the video-engine module (types only, no runtime code).
// Consumers: ctx.services.get<VideoEngineService>('videoEngine').

export const VIDEO_ENGINE_SERVICE = 'videoEngine';

export type VideoFormat = 'youtube' | 'instagram';

/**
 * Styles of the vertical Reels (format "instagram"), one per Reel of a pack:
 * - reveal « Révélation »: starts on a close-up of the cover, slowly zooms out to the whole image;
 * - cuts « Coupes sur le rythme »: 4–6 framings of the cover, changing on the beats;
 * - hook « Phrase d'accroche »: a big short phrase from the first second, over the moving cover;
 * - ambient « Ambiance »: the cover full screen, floating dust, film grain, fine progress bar.
 */
export type ReelStyle = 'reveal' | 'cuts' | 'hook' | 'ambient';

export interface VideoFormatInfo {
  label: string;
  width: number;
  height: number;
}

export interface RenderRequest {
  format: VideoFormat;
  audioPath: string;
  coverPath: string;
  title: string;
  artist: string;
  /** Where the excerpt starts in the audio, in seconds (default 0). */
  start?: number;
  /** Excerpt length in seconds (default: until the end of the audio). */
  duration?: number;
  /**
   * Length of the fades, in seconds. YouTube: picture and sound, default 1.5 s in
   * and 2 s out. Reels: fade-out only (0.5 s by default): no fade-in, the hook is immediate.
   */
  fadeSeconds?: number;
  /** Reels only: the style (default "reveal"). */
  reelStyle?: ReelStyle;
  /** Reels in the "hook" style: the phrase shown during the first seconds. */
  hookText?: string;
}

export interface PostRequest {
  coverPath: string;
  title: string;
  artist: string;
  /** Small discreet mention at the top (e.g. "Nouveau son"); empty = none. */
  badge?: string;
  /** Output JPEG path. */
  outputPath: string;
}

export interface RenderHandlers {
  /** Abort to cancel: FFmpeg is stopped and the partial file deleted. */
  signal?: AbortSignal;
  /** Progress 0..1 and a short French status message. */
  onProgress?: (fraction: number | null, message: string) => void;
}

export interface RenderResult {
  file: string;
  durationSec: number;
  width: number;
  height: number;
}

export interface VideoEngineService {
  readonly formats: Record<VideoFormat, VideoFormatInfo>;
  /**
   * Full-quality render to `outputPath` (.mp4, H.264 + AAC). Renders run one at
   * a time: a second call waits for the first ("En attente du moteur…").
   */
  render(
    request: RenderRequest & { outputPath: string },
    handlers?: RenderHandlers,
  ): Promise<RenderResult>;
  /** Quick low-resolution preview of a few seconds, written to the engine's own folder. */
  preview(
    request: RenderRequest & { previewSeconds?: number },
    handlers?: RenderHandlers,
  ): Promise<RenderResult>;
  /**
   * Still image 4:5 (1080×1350, high-quality JPEG) in the same style as the
   * videos: colour-wash background, rounded cover with shadow, title, artist.
   */
  renderPost(request: PostRequest): Promise<{ file: string; width: number; height: number }>;
  /** Duration of an audio file, in seconds. */
  probeDuration(audioPath: string): Promise<number>;
}
