// Effects of the Reels made from the user's own videos (custom-reels).
// One file per effect; docs/DIRECTION-ARTISTIQUE.md « Reels depuis mes vidéos ».
// Every motion is driven directly by the sound (bass envelope with an instant
// attack), never by detected events; no effect may hide the video's content.
import type { SKRSContext2D } from '@napi-rs/canvas';

export type VideoEffectId = 'raw' | 'calm' | 'rhythm' | 'cine' | 'camera';

/** « Intensité » of the energetic effects (Rythme, Caméra embarquée). EXPERIMENTAL. */
export type EffectIntensity = 'light' | 'medium' | 'max';
export const INTENSITY_FACTOR: Record<EffectIntensity, number> = {
  light: 0.55,
  medium: 1,
  max: 1.6,
};

export interface EffectFrameInput {
  frame: number;
  frames: number;
  /** Bass envelope 0..1 at this frame (instant attack, soft release). */
  envelope: number;
  /** Percussion / highs envelope 0..1 (instant attack, fast release). EXPERIMENTAL. */
  high?: number;
  /** +1 / −1, flipped on each bass attack of the final sound (the sway changes side). */
  side?: number;
  /** Factor of the « Intensité » setting (1 = Moyen). */
  intensity?: number;
}

export interface EffectFrame {
  /** Scale of the whole picture around its centre (1 = none, never below 1). */
  zoom: number;
  /** Light flash 0..1 (white, added on top of the picture). */
  flash: number;
  /** « Caméra embarquée » (EXPERIMENTAL): rotation (rad), shake (fraction of the width), keystone, motion blur 0..1. */
  camera?: { rotation: number; shiftX: number; shiftY: number; keystone: number; blur: number };
}

export interface VideoEffect {
  id: VideoEffectId;
  /** French name and one-line description (shown in the module). */
  label: string;
  description: string;
  /**
   * Static colour grade, as FFmpeg filters applied to the decoded picture
   * (comma-separated), or null. Kept light: the video stays itself.
   */
  grade: string | null;
  /** Grain strength of the encoder (FFmpeg noise filter, 0 = none). */
  grain: number;
  /** Release of the bass envelope (s), for the effects that follow the bass. */
  releaseSec?: number;
  /** Motion of one frame. */
  frame(input: EffectFrameInput): EffectFrame;
  /** Still layer drawn over every frame (bars, vignette), at output size. */
  overlay?(ctx: SKRSContext2D, width: number, height: number): void;
}
