// The effects bank of the Reels made from the user's videos (one file each).
import { calm } from './calm';
import { camera } from './camera';
import { cine } from './cine';
import { raw } from './raw';
import { rhythm } from './rhythm';
import type { VideoEffect, VideoEffectId } from './types';

export type {
  EffectFrame,
  EffectFrameInput,
  EffectIntensity,
  VideoEffect,
  VideoEffectId,
} from './types';
export { INTENSITY_FACTOR } from './types';

/** Validated effects (docs/DIRECTION-ARTISTIQUE.md). */
export const EFFECTS: Partial<Record<VideoEffectId, VideoEffect>> &
  Record<'raw' | 'calm' | 'rhythm' | 'cine', VideoEffect> = { raw, calm, rhythm, cine };

/** EXPERIMENTAL effects (prototype, shown « Expérimental »): not validated yet. */
export const EXPERIMENTAL_EFFECTS: Partial<Record<VideoEffectId, VideoEffect>> = { camera };

export function effectOf(id: string): VideoEffect {
  const effect = EFFECTS[id as VideoEffectId] ?? EXPERIMENTAL_EFFECTS[id as VideoEffectId];
  if (!effect) throw new Error(`Effet inconnu : ${id}`);
  return effect;
}
