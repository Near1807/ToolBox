// Shapes returned by the instagram-video backend.

export type ItemState = 'draft' | 'rendering' | 'ready' | 'outdated' | 'failed' | 'missing';

export interface PackItem {
  id: number;
  packId: number;
  kind: 'post' | 'reel';
  position: number;
  label: string;
  startSec: number | null;
  durationSec: number | null;
  ownCaption: string | null;
  caption: string;
  state: ItemState;
  jobId: string | null;
  error: string | null;
  fileName: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  renderedAt: string | null;
  publishedAt: string | null;
}

export interface Pack {
  id: number;
  trackId: number;
  clipDuration: number;
  caption: string;
  perReelCaptions: boolean;
  folder: string;
  items: PackItem[];
  published: number;
  total: number;
}

export interface TrackSummary {
  id: number;
  title: string;
  artist: string;
  durationSec: number | null;
  coverUrl: string | null;
  pack: { published: number; total: number } | null;
}

export interface LegacyReel {
  id: number;
  fileName: string;
  startSec: number;
  durationSec: number;
  createdAt: string;
  exists: boolean;
}

export interface TrackDetail extends Omit<TrackSummary, 'pack'> {
  audioUrl: string;
  defaultClip: number;
  pack: Pack | null;
  legacyReels: LegacyReel[];
}

export interface WaveformData {
  durationSec: number;
  peaks: number[];
  capacity: { distinct: number; overlapping: number };
}

export const STATE_LABELS: Record<ItemState, string> = {
  draft: 'À générer',
  rendering: 'Rendu…',
  ready: 'Prêt',
  outdated: 'À régénérer',
  failed: 'Échec',
  missing: 'Fichier introuvable',
};
