// Public types of the master-analysis module (types only, no runtime code).
// Other modules use the service through
// ctx.services.optional<MasterAnalysisService>('masterAnalysis'): it is never
// required, and nothing is blocked without it (docs/MODULES.md §5.8, ADR 0024).
import type { QuickCheck } from './shared/types';

export type { QuickCheck };

export const MASTER_ANALYSIS_SERVICE = 'masterAnalysis';

export interface MasterTrackStatus {
  versionId: number;
  versionName: string;
  /** queued | running | done | error | cancelled */
  status: string;
  analysedAt: string;
  /** Short facts for a badge (« −9,1 LUFS · +0,3 dBTP »), null until analysed. */
  badge: string | null;
  /** Number of markers that are facts worth seeing (overs above the threshold, clips). */
  overs: number;
  clips: number;
}

export interface MasterAnalysisService {
  /**
   * Analyses the current audio file of a library track: a new version when the
   * file differs from the last analysed one, the same version otherwise. The
   * file is copied, never modified.
   */
  analyseTrack(
    trackId: number,
  ): Promise<{ versionId: number; jobId: string | null; reused: boolean }>;
  /** Latest version of a track, or null. */
  trackStatus(trackId: number): MasterTrackStatus | null;
  /**
   * Quick, read-only check of an audio file before a generation (true peak
   * above 0 dBTP, clipping, long silences, mono problem). Cached by content.
   * Never blocks: the caller shows it and lets « Générer quand même ».
   */
  quickCheck(audioPath: string, trackId?: number | null): Promise<QuickCheck>;
  /** Page of the module for a track (for « Voir l'analyse »). */
  pagePath(trackId: number | null): string;
}
