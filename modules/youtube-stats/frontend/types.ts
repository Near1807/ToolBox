// Shapes of the module's API answers (types only, from the backend's functions).
import type { LabResult } from '../backend/lab';
import type { JournalEntry, Theory } from '../backend/theories';
import type { overview, trackDetail, trackList, videoDetail, videoList } from '../backend/views';
import type { StatTrack } from '../shared';

type Mode = { mode: 'real' | 'demo' };

export type OverviewData = Mode & {
  channel: { id: string; title: string } | null;
  reach: 'api' | 'csv' | 'none';
  lastDay: string;
} & ReturnType<typeof overview>;

export type TrackListData = Mode & { tracks: ReturnType<typeof trackList> };
export type TrackDetailData = Mode & NonNullable<ReturnType<typeof trackDetail>>;
export type VideoListData = Mode & {
  tracks: { id: number; title: string }[];
  videos: ReturnType<typeof videoList>;
};
export type VideoDetailData = Mode & {
  reach: 'api' | 'csv' | 'none';
  track: StatTrack | null;
} & NonNullable<ReturnType<typeof videoDetail>>;
export type LabData = Mode & { tracks: { id: number; title: string }[] } & LabResult;
export type TheoriesData = Mode & { theories: Theory[]; journal: JournalEntry[] };

export interface StateData {
  mode: 'real' | 'demo';
  account: {
    connected: boolean;
    needsReconnect: boolean;
    configured: boolean;
    scopesOk: boolean;
    error: string | null;
  };
  channel: { id: string; title: string } | null;
  lastSync: {
    at: string;
    ok: boolean;
    message: string | null;
    summary: { videos: number; calls: number } | null;
  } | null;
  syncing: { id: string; progress: number | null; message: string | null } | null;
  reach: string | null;
  engagedViews: boolean | null;
  hasData: boolean;
  lastDay: string;
  imports: {
    id: number;
    file_name: string;
    imported_at: string;
    kind: string;
    rows: number;
    matched: number;
  }[];
  services: Record<'library' | 'planner' | 'packs' | 'customReels' | 'engine', boolean>;
}

export interface LinksData {
  mode: 'real' | 'demo';
  tracks: { id: number; title: string }[];
  videos: {
    id: string;
    title: string;
    kind: string;
    publishedAt: string;
    trackId: number | null;
    mode: 'manual' | 'none' | null;
    suggestion: { id: number; title: string } | null;
  }[];
}
