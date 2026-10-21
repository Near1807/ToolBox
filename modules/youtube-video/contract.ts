// Public types of the youtube-video module (types only, no runtime code).
// Consumers: ctx.services.get<YouTubeVideoService>('youtubeVideo').

export const YOUTUBE_VIDEO_SERVICE = 'youtubeVideo';

/** A 16:9 video generated for a track. */
export interface YouTubeVideo {
  id: number;
  trackId: number;
  filePath: string;
  /** False when the file was moved or deleted outside the app. */
  exists: boolean;
  createdAt: string;
  /** Set once the video is on YouTube (by the module that uploaded it). */
  youtubeVideoId: string | null;
  uploadedAt: string | null;
}

/**
 * Title, description and tags of the track's video: edited under the video,
 * otherwise pre-filled from the templates of the settings (links, hashtags).
 */
export interface YouTubeTexts {
  videoTitle: string;
  description: string;
  /** Without the "#". */
  tags: string[];
  /** True when edited by the user (not the template text any more). */
  custom: boolean;
}

export interface YouTubeVideoService {
  /** Videos of a track, newest first. */
  listVideos(trackId: number): YouTubeVideo[];
  getVideo(id: number): YouTubeVideo | null;
  texts(trackId: number): YouTubeTexts | null;
  /** Edits the texts (a field equal to the template text follows the template again); null resets all. */
  setTexts(
    trackId: number,
    change: { videoTitle?: string; description?: string; tags?: string[] } | null,
  ): YouTubeTexts;
  /** Queues a new render of the track (job of youtube-video, visible in Tâches). */
  render(trackId: number): { jobId: string };
  /** Records that a video is online (shown on the module's page), or no longer (null). */
  setUploaded(videoId: number, youtubeVideoId: string | null): void;
}
