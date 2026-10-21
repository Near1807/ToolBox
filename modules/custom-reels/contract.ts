// Public types of the custom-reels module (types only, no runtime code).
// Consumers: ctx.services.get<CustomReelsService>('customReels') — e.g. the release planner.

export const CUSTOM_REELS_SERVICE = 'customReels';

export type CustomReelState = 'draft' | 'rendering' | 'ready' | 'outdated' | 'failed' | 'missing';

/** A Reel made from the user's videos, on an excerpt of a track. */
export interface CustomReel {
  id: number;
  trackId: number;
  /** 1..4 */
  position: number;
  /** « Reel perso 1 » */
  label: string;
  startSec: number;
  durationSec: number;
  effect: 'raw' | 'calm' | 'rhythm' | 'cine' | 'camera';
  state: CustomReelState;
  /** Rendered file, null until rendered. */
  filePath: string | null;
  exists: boolean;
  thumbnailPath: string | null;
  /** Caption to publish (own, or the template's). */
  caption: string;
  publishedAt: string | null;
}

export interface CustomReelsService {
  /** Reels of a track, by position. */
  listReels(trackId: number): CustomReel[];
  getReel(id: number): CustomReel | null;
  /** Ticks or unticks « Publié » (date kept when already ticked, unless `at` is given). */
  setPublished(id: number, published: boolean, at?: string): CustomReel;
  /** Edits the caption (null: back to the template). */
  setCaption(id: number, caption: string | null): CustomReel;
  /** Renders the Reel again (job of custom-reels, visible in Tâches). */
  renderReel(id: number): { jobId: string };
}
