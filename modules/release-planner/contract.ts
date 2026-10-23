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

/**
 * The YouTube quota of the day, shared by the modules that call the YouTube
 * Data API with the same Google project. The uploads of the Planning come
 * first: another module (youtube-stats) checks this before spending units.
 */
export interface YouTubeQuotaOutlook {
  /** Quota day (YYYY-MM-DD, Pacific time: reset at midnight in California). */
  day: string;
  unitsPerDay: number;
  /** Units used today: by the Planning (uploads and their follow-ups), by each other module. */
  used: { planner: number; uploads: number; byModule: Record<string, number>; total: number };
  /** YouTube answered « quota exceeded » today (to the Planning or another module). */
  exhausted: boolean;
  /** Who got the « quota exceeded » answer first, when known (« release-planner », « youtube-stats »). */
  exhaustedBy: string | null;
  /** Uploads queued or running now. */
  uploadsActive: number;
  /** Elements to upload within 24 h: planned that soon, or picked by the automatic upload. */
  uploadsSoon: number;
}

export interface ReleasePlannerService {
  /** Every YouTube element of every release, by planned date. */
  listYouTubeItems(): PlannedYouTubeItem[];
  /** Today's YouTube quota and what the uploads need (Planning before Stats). */
  youtubeQuota(): YouTubeQuotaOutlook;
  /** Records units spent by another module on the YouTube Data API (and a « quota exceeded » answer). */
  recordYouTubeQuota(moduleId: string, units: number, exhausted?: boolean): void;
  /** « Aujourd'hui : 3 envois du Planning (300 unités), 12 unités pour Stats YouTube. » */
  quotaOrigin(): string;
}
