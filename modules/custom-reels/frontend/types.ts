// Shapes returned by the custom-reels backend.

export type ReelState = 'draft' | 'rendering' | 'ready' | 'outdated' | 'failed' | 'missing';
export type EffectId = 'raw' | 'calm' | 'rhythm' | 'cine';

export interface Source {
  id: number;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  exists: boolean;
  url: string | null;
  /** Size of the copy in ToolBox (kept after it is deleted). */
  sizeBytes: number | null;
  /** The copy was deleted to free disk space (« Réimporter » to change its Reels). */
  removedAt: string | null;
  usedBy: string[];
  /** Every Reel using it is generated. */
  allReady: boolean;
  /** « Supprimer la copie ? » offered after the render (setting), until « Garder ». */
  cleanupOffered: boolean;
}

/** Disk space of the imported copies. */
export interface Storage {
  bytes: number;
  count: number;
  freedBytes: number;
  freedCount: number;
  folder: string;
}

export interface Segment {
  sourceId: number;
  start: number;
  end: number;
}

export interface Reel {
  id: number;
  outputId: number | null;
  position: number;
  label: string;
  startSec: number;
  durationSec: number;
  segments: Segment[];
  videoSeconds: number;
  loops: boolean;
  framing: 'fit' | 'fill';
  focus: { x: number; y: number };
  effect: EffectId;
  caption: string;
  captionCustom: boolean;
  state: ReelState;
  jobId: string | null;
  error: string | null;
  fileName: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  renderedAt: string | null;
  publishedAt: string | null;
  included: boolean;
}

export interface TrackSummary {
  id: number;
  title: string;
  artist: string;
  durationSec: number | null;
  coverUrl: string | null;
  reels: { total: number; published: number } | null;
}

export interface TrackDetail {
  id: number;
  title: string;
  artist: string;
  durationSec: number | null;
  coverUrl: string | null;
  audioUrl: string | null;
  defaultClip: number;
  sources: Source[];
  storage: { track: Storage; all: Storage };
  reels: Reel[];
}

export interface EffectInfo {
  id: EffectId;
  label: string;
  description: string;
}

export const STATE_LABELS: Record<ReelState, string> = {
  draft: 'À générer',
  rendering: 'Rendu en cours',
  ready: 'Prêt',
  outdated: 'À régénérer',
  failed: 'Erreur',
  missing: 'Introuvable',
};
