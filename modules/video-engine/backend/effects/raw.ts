// « Brut » : the video as it is — no motion, no grade, no grain.
import type { VideoEffect } from './types';

export const raw: VideoEffect = {
  id: 'raw',
  label: 'Brut',
  description: 'La vidéo telle quelle : ni mouvement, ni retouche.',
  grade: null,
  grain: 0,
  frame: () => ({ zoom: 1, flash: 0 }),
};
