// « Caméra embarquée » (EXPERIMENTAL): as if someone filmed the screen with a
// phone while dancing to the track. Over the top on purpose, but every motion
// comes from the FINAL sound of the Reel: zoom hits on the bass (instant
// attack, soft release), a sway whose side flips on each bass attack, shakes
// from the percussion / highs, a light motion blur, a slight « screen filmed
// at an angle » keystone and light bursts on the strongest hits. The frame is
// always filled (the renderer zooms in enough: never any black edge).
import type { VideoEffect } from './types';

export const camera: VideoEffect = {
  id: 'camera',
  label: 'Caméra embarquée (expérimental)',
  description: 'L’écran filmé au téléphone en dansant : coups de zoom, balancement, secousses.',
  grade: 'eq=contrast=1.06:saturation=1.1',
  grain: 5,
  releaseSec: 0.25,
  frame: ({ envelope: bass, high = 0, side = 1, frame, intensity = 1 }) => {
    // Shake direction: a fixed pseudo-random walk; its AMPLITUDE is the highs envelope.
    const angle = frame * 2.399963; // golden angle: never the same direction twice in a row
    const shake = 0.012 * intensity * high;
    return {
      zoom: 1.04 + 0.1 * intensity * bass,
      flash: Math.min(0.35, 0.28 * intensity * bass ** 3),
      camera: {
        rotation: side * (0.006 + 0.045 * bass) * intensity,
        shiftX: Math.cos(angle) * shake,
        shiftY: Math.sin(angle) * shake * 0.7,
        keystone: (0.05 + 0.04 * bass) * intensity,
        blur: Math.min(0.45, 0.35 * intensity * Math.max(bass * 0.8, high)),
      },
    };
  },
};
