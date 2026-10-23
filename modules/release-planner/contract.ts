// Public types of the release-planner module (types only, no runtime code).
// Consumers: ctx.services.optional<ReleasePlannerService>('releasePlanner') —
// e.g. youtube-stats, to know which YouTube video is which track's.

export const RELEASE_PLANNER_SERVICE = 'releasePlanner';

/** What a YouTube element of a release was made from. */
export type PlannedSource =
  /** The long video (youtube-video). */
  | { type: 'video'; videoId: number | null }
  /** A Reel of the Instagram pack, published as a Short. */
  | { type: 'cover-reel'; packItemId: number | null }
  /** A Reel perso (custom-reels), published as a Short. */
  | { type: 'custom-reel'; customReelId: number };

/** A YouTube element of a release (long video or Short), sent or not. */
export interface PlannedYouTubeItem {
  itemId: number;
  trackId: number;
  kind: 'video' | 'short';
  /** 0 for the long video; n for Short n; 100 + n for Short perso n. */
  position: number;
  /** « Vidéo YouTube », « Short 2 », « Short perso 1 ». */
  label: string;
  /** Set once uploaded. */
  youtubeVideoId: string | null;
  /** Planned publication (UTC instant). */
  scheduledAt: string;
  /** When it went public, when known. */
  publishedAt: string | null;
  source: PlannedSource;
}

export interface ReleasePlannerService {
  /** Every YouTube element of every release, by planned date. */
  listYouTubeItems(): PlannedYouTubeItem[];
}
