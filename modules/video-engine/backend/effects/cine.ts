// « Ciné » : thin black bars at the top and bottom, a film grade (cooler
// shadows, warmer highlights, a little contrast), grain and a soft vignette.
// The bars stay thin (90 px of 1920): they frame the picture, never hide it.
import type { VideoEffect } from './types';

/** Height of each bar at full size (1080×1920). */
export const CINE_BAR = 90;

export const cine: VideoEffect = {
  id: 'cine',
  label: 'Ciné',
  description: 'Fines bandes noires, étalonnage film, grain, vignette.',
  grade:
    'eq=contrast=1.06:saturation=0.92,' +
    'colorbalance=rs=-0.04:bs=0.05:rh=0.05:bh=-0.04,' +
    "curves=all='0/0.02 0.5/0.5 1/0.97'",
  grain: 9,
  frame: () => ({ zoom: 1, flash: 0 }),
  overlay(ctx, width, height) {
    // Vignette: transparent in the middle, darker in the corners.
    const radius = Math.hypot(width, height) / 2;
    const gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      radius * 0.45,
      width / 2,
      height / 2,
      radius,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.38)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    const bar = Math.round((CINE_BAR * height) / 1920);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, bar);
    ctx.fillRect(0, height - bar, width, bar);
  },
};
