// « Calme » : a very slow zoom over the whole Reel (+4 %), a soft grade
// (slightly lower contrast and saturation, a touch warmer) and light grain.
import type { VideoEffect } from './types';

/** Zoom reached at the end of the Reel. */
export const CALM_ZOOM = 0.04;

export const calm: VideoEffect = {
  id: 'calm',
  label: 'Calme',
  description: 'Zoom très lent, couleurs adoucies, grain léger.',
  grade: 'eq=contrast=0.94:saturation=0.88:brightness=0.01,colorbalance=rm=0.03:bm=-0.03',
  grain: 6,
  frame: ({ frame, frames }) => ({
    zoom: 1 + CALM_ZOOM * (frames > 1 ? frame / (frames - 1) : 0),
    flash: 0,
  }),
};
