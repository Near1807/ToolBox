// Public types of the music-library module (types only, no runtime code).
// Other modules may `import type` from this file and use the service through
// ctx.services.get<MusicLibraryService>('musicLibrary') — see docs/MODULES.md §5.8.

export const MUSIC_LIBRARY_SERVICE = 'musicLibrary';

export interface Track {
  id: number;
  title: string;
  /** Effective artist: the track's own, or the "default artist" setting. */
  artist: string;
  /** Artist set on the track itself (null = use the default). */
  artistOverride: string | null;
  /** YYYY-MM-DD */
  releaseDate: string | null;
  notes: string;
  tags: string[];
  durationSec: number | null;
  audioFormat: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitRate: number | null;
  /** Absolute path of the library's copy of the audio file. */
  audioPath: string;
  originalAudioName: string;
  /** Absolute path of the cover image, or null. */
  coverPath: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A file generated from a track by another module (video, extract…). */
export interface TrackOutput {
  id: number;
  trackId: number;
  moduleId: string;
  kind: string;
  label: string;
  filePath: string;
  createdAt: string;
}

/** A line of information another module shows on the track page (e.g. "Pack Instagram : 2/5 publiés"). */
export interface TrackInfoProvider {
  moduleId: string;
  label: string;
  /** Short text for this track, or null when there is nothing to show. */
  get(trackId: number): string | null;
}

/** Where a generated element stands in the release (beyond « généré »). */
export type ProjectStatus = 'planned' | 'scheduled' | 'published';

/** Status of one generated element (identified like in ctx.outputs: module + ref). */
export interface ProjectStatusEntry {
  moduleId: string;
  ref: string;
  status: ProjectStatus;
  /** Short French detail shown on the project page (e.g. « Short 2 le 12/11 »). */
  detail?: string;
}

/** A module telling the project page where the elements of a track stand (planner, Instagram…). */
export interface ProjectStatusProvider {
  moduleId: string;
  get(trackId: number): ProjectStatusEntry[];
}

export interface MusicLibraryService {
  listTracks(): Track[];
  getTrack(id: number): Track | null;
  /**
   * The track of a project subject (`music-library:track:<id>`), or null when
   * the subject is not a track or the track does not exist. For onReattach.
   */
  trackIdOf(subject: string): number | null;
  /**
   * @deprecated Since v0.7 generated files go through ctx.outputs with the subject
   * `music-library:track:<id>`: the track page lists them from there. Kept for compatibility.
   */
  recordOutput(
    trackId: number,
    output: { moduleId: string; kind: string; label: string; filePath: string },
  ): TrackOutput;
  listOutputs(trackId: number): TrackOutput[];
  /** Adds a line to the track page; returns a function that removes it. */
  registerTrackInfo(provider: TrackInfoProvider): () => void;
  /** Statuses shown on the project page (the most advanced one wins); returns a remover. */
  registerProjectStatus(provider: ProjectStatusProvider): () => void;
  /**
   * « Inclure dans la sortie », ticked on the project page (true by default).
   * The release planner only proposes the included elements.
   */
  isIncluded(moduleId: string, ref: string): boolean;
}

/** Track as sent to the UI (with media URLs). */
export interface TrackDto extends Omit<Track, 'audioPath' | 'coverPath'> {
  audioUrl: string;
  coverUrl: string | null;
}

export interface TrackOutputDto extends Omit<TrackOutput, 'filePath'> {
  fileName: string;
  exists: boolean;
  /** Playable URL when the file still exists. */
  url: string | null;
}
