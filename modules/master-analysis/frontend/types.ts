// Shapes of the module's API answers (the interface's side of backend/index.ts).
import type { AnalysisSummary } from '../backend/store';
import type { Difference } from '../shared/measures';
import type { Measures, Platform, PlatformResult, Section } from '../shared/types';

export type { AnalysisSummary };

export interface VersionDto {
  id: number;
  groupId: number;
  number: number;
  name: string;
  originalName: string;
  source: 'import' | 'library' | 'watch';
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  error: string | null;
  jobId: string | null;
  createdAt: string;
  offset: number | null;
  identicalTo: string | null;
  exists: boolean;
  audioUrl: string | null;
  summary: AnalysisSummary | null;
  analysisMs: number | null;
}

export interface ProjectDto {
  groupId: number;
  trackId: number | null;
  title: string;
  artist: string;
  coverUrl: string | null;
  kind: 'track' | 'free';
  missingTrack: boolean;
  suggestedTrack: { id: number; title: string } | null;
  versions: VersionDto[];
}

export interface RefDto {
  id: number;
  profileId: number;
  name: string;
  originalName: string;
  status: VersionDto['status'];
  error: string | null;
  jobId: string | null;
  exists: boolean;
  audioUrl: string | null;
  summary: AnalysisSummary | null;
}

export interface StateDto {
  library: boolean;
  projects: ProjectDto[];
  tracks: { id: number; title: string; artist: string; coverUrl: string | null }[];
  profiles: { id: number; name: string; created_at: string; refs: RefDto[] }[];
  settings: { overThreshold: number; platforms: Platform[] };
  watch: { enabled: boolean; folder: string; lastScan: string | null; error: string | null };
}

export interface AnalysisDto {
  text: string;
  sections: Section[];
  autoSections: Section[];
  version: VersionDto;
  platforms: PlatformResult[];
  threshold: number;
}

export interface CompareDto {
  a: VersionDto;
  b: VersionDto;
  auto: { offset: number; confidence: number };
  offset: number;
  manual: boolean;
  measures: { a: Measures; b: Measures };
  overlay: { t: number; a: number | null; b: number | null }[];
  global: Difference;
  sections: { section: Section; difference: Difference }[];
  map: { seconds: number; loudness: (number | null)[]; bands: (number | null)[][] };
}

type Pair = { track: number | null; references: number | null };
export interface ReferencesDto {
  references: (RefDto & { gain: number })[];
  global: {
    integrated: Pair;
    truePeak: Pair;
    lra: Pair;
    plr: Pair;
    width: Pair;
    correlation: Pair;
  };
  bands: {
    id: string;
    label: string;
    track: number | null;
    references: number | null;
    difference: number | null;
  }[];
  thirdOctave: {
    f: number;
    track: number | null;
    references: number | null;
    difference: number | null;
  }[];
  sections: {
    section: Section;
    integrated: Pair;
    width: Pair;
    plr: Pair;
    bands: { id: string; difference: number | null }[];
  }[];
}
