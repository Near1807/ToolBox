// « Rythme » : the picture zooms in on each bass hit and comes back, with a
// light flash. Driven directly by the bass envelope (instant attack on the
// frame of the attack, soft release; no event detection), so the motion is
// on the beat to the frame. More marked than the cover Reels (6 % against
// 1.8 %): it is the user's footage, made to move with the track.
import type { VideoEffect } from './types';

/** Zoom at full bass, and flash opacity at full bass. */
export const RHYTHM_ZOOM = 0.06;
export const RHYTHM_FLASH = 0.12;

export const rhythm: VideoEffect = {
  id: 'rhythm',
  label: 'Rythme',
  description: 'Zoom et léger flash sur les basses, à l’image près.',
  grade: 'eq=contrast=1.04:saturation=1.05',
  grain: 3,
  releaseSec: 0.2,
  frame: ({ envelope }) => ({
    zoom: 1 + RHYTHM_ZOOM * envelope,
    // Squared: only the real hits flash, the small bass movements do not.
    flash: RHYTHM_FLASH * envelope * envelope,
  }),
};
