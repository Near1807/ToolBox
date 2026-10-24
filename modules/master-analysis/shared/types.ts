// Shapes shared by the backend and the interface of « Analyse du master ».
// The analysis only describes the audio: it never modifies it, never advises.

/** Bands of the timeline and of the tonal balance (Hz). */
export const BANDS = [
  { id: 'sub', label: 'Sub', from: 20, to: 60 },
  { id: 'bass', label: 'Graves', from: 60, to: 250 },
  { id: 'lowMid', label: 'Bas-médium', from: 250, to: 500 },
  { id: 'mid', label: 'Médium', from: 500, to: 2000 },
  { id: 'highMid', label: 'Haut-médium', from: 2000, to: 6000 },
  { id: 'high', label: 'Aigus', from: 6000, to: 12000 },
  { id: 'air', label: 'Air', from: 12000, to: 20000 },
] as const;
export type BandId = (typeof BANDS)[number]['id'];

/** Version of the analysis algorithm: an analysis made by an older one is made again. */
export const ANALYZER_VERSION = 1;

/** Time step of every curve of the timeline (seconds). */
export const BLOCK = 0.1;
/** Time step of the waveform and of the true peak markers (seconds). */
export const FINE = 0.01;

export interface FileInfo {
  format: string;
  codec: string;
  sampleRate: number;
  /** Bits per sample of the file (null for lossy formats). */
  bitDepth: number | null;
  /** 'float' when the file holds floating-point samples (values above 0 dBFS possible). */
  sampleFormat: string;
  channels: number;
  /** Channels analysed (more than 2 are mixed down to stereo). */
  analysedChannels: number;
  durationSec: number;
  lossy: boolean;
  bitRate: number | null;
}

/** The whole analysis, as stored (big arrays as base64) and decoded. */
export interface Analysis {
  analyzer: number;
  file: FileInfo;
  /** Number of 100 ms blocks. */
  blocks: number;
  /** K-weighted mean square, summed over channels, per block (BS.1770). */
  power: Float32Array;
  /** Unweighted mean square averaged over channels, per block. */
  meanSquare: Float32Array;
  /** Sample peak (linear, max over channels) per block. */
  peak: Float32Array;
  /** True peak (linear, max over channels) per block. */
  truePeak: Float32Array;
  /** Mean square of mid (L+R)/2 and side (L-R)/2 per block (stereo; side 0 in mono). */
  mid: Float32Array;
  side: Float32Array;
  /** L·R / √(L²·R²) per block (1 in mono, 0 when silent). */
  correlation: Float32Array;
  /** Power per band per block: mid and side parts (bands[b].mid + bands[b].side = total). */
  bandMid: Float32Array[];
  bandSide: Float32Array[];
  /** Onsets per second around each block. */
  density: Float32Array;
  /** Waveform per 10 ms: min and max over channels (−1…1). */
  waveMin: Float32Array;
  waveMax: Float32Array;
  /** True peak per 10 ms (linear, max over channels): overs at any threshold. */
  truePeakFine: Float32Array;
  spectrogram: {
    bins: number;
    fmin: number;
    fmax: number;
    hopSec: number;
    frames: number;
    data: Uint8Array;
  };
  /** Long-term average spectrum: third-octave bands and a smoothed curve (dB, like the RMS). */
  thirdOctave: { f: number; db: number }[];
  spectrum: { f: number; db: number }[];
  clipping: { time: number; channel: number; samples: number; aboveFullScale: boolean }[];
  /** Mean of each channel (DC offset, linear). */
  dc: number[];
  leadingSilence: number;
  trailingSilence: number;
  samplePeak: number;
  truePeakMax: number;
  /** Samples above 0 dBFS (floating-point files only). */
  aboveFullScale: number;
  sectionsAuto: Section[];
  analysisMs: number;
}

export interface Section {
  start: number;
  end: number;
  label: string;
}

/** Global measures of an analysis (or of a part of it). */
export interface Measures {
  integrated: number | null;
  lra: number | null;
  truePeak: number | null;
  samplePeak: number | null;
  /** True peak − integrated loudness (LU). */
  plr: number | null;
  /** Sample peak − RMS (dB). */
  crest: number | null;
  rms: number | null;
  correlation: number | null;
  /** Side share of the energy, 0 (mono) … 0.5 (uncorrelated) … 1 (out of phase). */
  width: number | null;
  /** Level change when summed to mono (dB, ≤ 0). */
  monoLoss: number | null;
  /** Energy per band (dB, same scale as the RMS) and relative to the integrated loudness. */
  bands: {
    id: BandId;
    db: number | null;
    relative: number | null;
    width: number | null;
    monoLoss: number | null;
  }[];
  density: number | null;
}

export interface Platform {
  name: string;
  target: number;
  /** 'both': turned down and up (up only as far as the true peak allows); 'down': only down. */
  mode: 'both' | 'down';
  /** Peak limit kept when turning up (dBTP). */
  ceiling: number;
}

export interface PlatformResult extends Platform {
  gain: number;
  result: number;
  /** Why the gain is what it is (« baissé », « monté, limité par la crête »…). */
  note: string;
}

export interface Marker {
  kind: 'over' | 'clip' | 'phase' | 'silence';
  start: number;
  end: number;
  /** dBTP for an over, number of samples for a clip, correlation for phase, null otherwise. */
  value: number | null;
  channel?: number;
}

/** Light result for the quick check before a generation. */
export interface QuickCheck {
  ok: boolean;
  issues: { kind: 'truePeak' | 'clipping' | 'silence' | 'mono'; text: string }[];
  /** Analysis it comes from, if any (« Voir l'analyse »). */
  versionId: number | null;
  measuredAt: string;
}
