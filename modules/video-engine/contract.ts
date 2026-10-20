// Public types of the video-engine module (types only, no runtime code).
// Consumers: ctx.services.get<VideoEngineService>('videoEngine').

export const VIDEO_ENGINE_SERVICE = 'videoEngine';

export type VideoFormat = 'youtube' | 'instagram';

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
   * Length of the fade in and fade out (picture and sound), in seconds.
   * Default: 1.5 s in, 2 s out (Reels of the Instagram pack: 0.5 s).
   */
  fadeSeconds?: number;
}

export interface PostRequest {
  coverPath: string;
  title: string;
  artist: string;
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
