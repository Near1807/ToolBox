// Public types of the instagram-video module (types only, no runtime code).
// Consumers: ctx.services.get<InstagramPackService>('instagramPack').

export const INSTAGRAM_PACK_SERVICE = 'instagramPack';

export type PackItemState = 'draft' | 'rendering' | 'ready' | 'outdated' | 'failed' | 'missing';

/** An element of a track's Instagram pack: the post (position 0) or a Reel (1..4). */
export interface PackItem {
  id: number;
  kind: 'post' | 'reel';
  position: number;
  /** "Post", "Reel 1"… */
  label: string;
  /** null until rendered. */
  filePath: string | null;
  thumbnailPath: string | null;
  /** Caption to publish with (the Reel's own one, or the pack's). */
  caption: string;
  state: PackItemState;
  /** Excerpt of a Reel, in seconds: where it starts in the track, and how long. */
  startSec: number | null;
  durationSec: number | null;
  /** The « Publié » box of the pack (single source of truth). */
  publishedAt: string | null;
}

export interface InstagramPack {
  id: number;
  trackId: number;
  caption: string;
  items: PackItem[];
}

export interface InstagramPackService {
  getPack(trackId: number): InstagramPack | null;
  getItem(itemId: number): (PackItem & { trackId: number }) | null;
  /** Ticks or unticks « Publié » (date kept when already ticked, unless `at` is given). */
  setPublished(itemId: number, published: boolean, at?: string): PackItem;
  /**
   * Edits the caption of an element: the post carries the pack caption, a Reel
   * gets its own (null: back to the pack caption, or to the template for the post).
   */
  setCaption(itemId: number, caption: string | null): PackItem;
  /** Renders the item again (job of instagram-video, visible in Tâches). */
  renderItem(itemId: number): { jobId: string };
}
