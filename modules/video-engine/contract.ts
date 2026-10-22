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

/** Effects of the Reels made from the user's videos (docs/DIRECTION-ARTISTIQUE.md). */
export type VideoEffectId = 'raw' | 'calm' | 'rhythm' | 'cine' | 'camera';
/** « Intensité » of Rythme and Caméra embarquée (EXPERIMENTAL). */
export type EffectIntensity = 'light' | 'medium' | 'max';
/** Sound of a video Reel (EXPERIMENTAL except « track »). */
export type ReelAudioMode = 'track' | 'video' | 'synced';

export interface VideoEffectInfo {
  id: VideoEffectId;
  label: string;
  description: string;
}

/** A Reel (1080×1920) made from the user's own videos, with a track excerpt as its only sound. */
export interface VideoReelRequest {
  audioPath: string;
  /** Excerpt of the track, seconds. */
  start: number;
  duration: number;
  /** Passages of the videos, chained with hard cuts (repeated if shorter than the excerpt). */
  segments: { source: string; start: number; end: number }[];
  /** « fit »: whole video over a blurred background made from itself; « fill »: cropped around `focus`. */
  framing: 'fit' | 'fill';
  /** 0..1 in the picture (fill only). */
  focus?: { x: number; y: number };
  effect: VideoEffectId;
  title: string;
  artist: string;
  /** Default 0.5 s. */
  fadeSeconds?: number;
  /**
   * EXPERIMENTAL. « track » (default): the track excerpt. « video »: the videos'
   * own sound for the chosen passages (normalised, limited). « synced »: the
   * master of the track placed exactly where it plays in the video (`syncOffsets`).
   * The Reel lasts `duration` in every mode (the passages add up to it).
   */
  audioMode?: ReelAudioMode;
  /** « synced »: per video file, track time = video time + offset (s). */
  syncOffsets?: Record<string, number>;
  /** EXPERIMENTAL: Rythme and Caméra embarquée (default « medium »). */
  intensity?: EffectIntensity;
  /** EXPERIMENTAL: free text shown discreetly at the top (safe zone). */
  overlayText?: string;
}

/** Where the track plays in a video's sound (EXPERIMENTAL, cross-correlation). */
export interface TrackSync {
  /** Track time = video time + offset (s). */
  offset: number;
  /** Normalised correlation of the best match (0..1). */
  score: number;
  /** Best match / best other match (far from it). */
  ratio: number;
  reliable: boolean;
}

export interface VideoInfo {
  durationSec: number;
  /** Displayed size (rotation of phone videos applied). */
  width: number;
  height: number;
  hasAudio: boolean;
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
  /**
   * YouTube thumbnail 16:9 (1280×720 JPEG, < 2 MB) in the same style: blurred
   * background, whole rounded cover with shadow, title, artist — no spectrum.
   */
  renderThumbnail(request: PostRequest): Promise<{ file: string; width: number; height: number }>;
  /** Duration of an audio file, in seconds. */
  probeDuration(audioPath: string): Promise<number>;
  /** The effects bank of the video Reels. */
  readonly videoEffects: VideoEffectInfo[];
  /** Full-quality video Reel to `outputPath` (one render at a time, like `render`). */
  renderVideoReel(
    request: VideoReelRequest & { outputPath: string },
    handlers?: RenderHandlers,
  ): Promise<RenderResult & { looped: boolean }>;
  /** Quick low-resolution preview of a few seconds (default 4) of a video Reel. */
  previewVideoReel(
    request: VideoReelRequest & { previewSeconds?: number },
    handlers?: RenderHandlers,
  ): Promise<RenderResult & { looped: boolean }>;
  /** Duration and displayed size of a video file. */
  probeVideo(videoPath: string): Promise<VideoInfo>;
  /** EXPERIMENTAL: finds where the track plays in the video's sound. */
  findTrackInVideo(trackPath: string, videoPath: string): Promise<TrackSync>;
  /** `count` (up to 120) small JPEG frames evenly spread over the video (timeline), written to `outputDir`. */
  filmstrip(videoPath: string, count: number, outputDir: string): Promise<string[]>;
  /** Peaks (0..1, `bars` values) of a whole audio file, for the excerpt waveform. */
  waveform(audioPath: string, bars: number): Promise<{ durationSec: number; peaks: number[] }>;
}
