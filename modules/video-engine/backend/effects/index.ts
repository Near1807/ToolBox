// The effects bank of the Reels made from the user's videos (one file each).
import { calm } from './calm';
import { cine } from './cine';
import { raw } from './raw';
import { rhythm } from './rhythm';
import type { VideoEffect, VideoEffectId } from './types';

export type { EffectFrame, EffectFrameInput, VideoEffect, VideoEffectId } from './types';

export const EFFECTS: Record<VideoEffectId, VideoEffect> = { raw, calm, rhythm, cine };

export function effectOf(id: string): VideoEffect {
  const effect = EFFECTS[id as VideoEffectId];
  if (!effect) throw new Error(`Effet inconnu : ${id}`);
  return effect;
}
