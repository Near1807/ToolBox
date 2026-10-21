// Shapes returned by the backend of the release planner (backend/index.ts).

export type ItemKind = 'youtube' | 'short' | 'insta-post' | 'insta-reel';
export type Platform = 'youtube' | 'instagram';
export type ItemStatus =
  'planned' | 'queued' | 'uploading' | 'scheduled' | 'to-schedule' | 'published' | 'failed';
export type Visibility = 'scheduled' | 'public' | 'unlisted' | 'private';

export interface PlannerItem {
  id: number;
  releaseId: number;
  trackId: number;
  trackTitle: string;
  artist: string;
  colorIndex: number;
  kind: ItemKind;
  position: number;
  label: string;
  platform: Platform;
  scheduledAt: string;
  date: string;
  time: string;
  shiftedFrom: string | null;
  state: ItemStatus;
  status: ItemStatus;
  late: boolean;
  visibility: Visibility;
  title: string | null;
  description: string | null;
  tags: string[];
  caption: string | null;
  /** Title / description / tags edited (otherwise they follow the templates). */
  textsCustom: boolean;
  publishedAt: string | null;
  source: {
    gone: boolean;
    exists: boolean;
    rendered: boolean;
    fileName: string | null;
    url: string | null;
    thumbnailUrl: string | null;
    outputId: number | null;
  };
  youtube: {
    id: string;
    url: string;
    studioUrl: string;
    privacy: string | null;
    publishAt: string | null;
  } | null;
  warning: string | null;
  error: string | null;
  notBefore: string | null;
  job: { id: string; progress: number | null; message: string | null } | null;
}

export interface Release {
  id: number;
  trackId: number;
  trackTitle: string;
  artist: string;
  coverUrl: string | null;
  colorIndex: number;
  date: string;
  time: string;
  videoId: number | null;
  videos: { id: number; fileName: string; createdAt: string; exists: boolean }[];
  thumbnailUrl: string | null;
  items: PlannerItem[];
}

export interface AccountStatus {
  provider: string;
  label: string;
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  scopes: string[];
  connectedAt: string | null;
  error: string | null;
  connecting: boolean;
}

export interface Summary {
  today: string;
  timeZone: string;
  defaultTime: string;
  maxPerDay: number;
  account: AccountStatus;
  quota: {
    day: string;
    uploads: number;
    units: number;
    exhausted: boolean;
    uploadsPerDay: number;
    unitsPerDay: number;
    nextReset: string;
  };
  queue: number;
  quotaMessage: string | null;
  templateErrors: string[];
}

export interface TrackChoice {
  id: number;
  title: string;
  artist: string;
  coverUrl: string | null;
  videos: number;
  pack: { items: number; rendered: number } | null;
  releaseId: number | null;
  releaseDate: string | null;
}

export interface PlanProposal {
  track: { id: number; title: string; artist: string };
  videoId: number | null;
  videos: { id: number; fileName: string; exists: boolean; createdAt: string }[];
  pack: { id: number; items: number } | null;
  items: {
    kind: ItemKind;
    position: number;
    label: string;
    platform: Platform;
    date: string;
    time: string;
    templateDate: string;
    shifted: boolean;
    title: string;
    description: string;
  }[];
  shifts: { label: string; from: string; to: string }[];
  warnings: string[];
}

export const STATUS_LABELS: Record<ItemStatus, string> = {
  planned: 'Planifié',
  queued: 'En attente d’envoi',
  uploading: 'Envoi en cours',
  scheduled: 'Programmé sur YouTube',
  'to-schedule': 'À programmer dans Studio',
  published: 'Publié',
  failed: 'Erreur',
};

/** One colour per track (colorIndex 0..7): the theme's series tokens (docs/THEMES.md). */
export const TRACK_COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
