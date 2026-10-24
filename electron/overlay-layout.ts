// Placement of the floating window (pure, tested in tests/overlay-layout.test.ts).

export interface OverlayLayout {
  width: number;
  height: number;
  interactive: boolean;
  focus: boolean;
}

export const MAX_WIDTH = 560;
export const MAX_HEIGHT = 640;
/** Space kept between the window and the bottom of the work area (taskbar excluded). */
export const BOTTOM_GAP = 24;

/** The layout sent by the overlay page, checked (it comes from a renderer). */
export function parseLayout(value: unknown): OverlayLayout | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const size = (n: unknown, max: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.ceil(n))) : 0;
  return {
    width: size(v.width, MAX_WIDTH),
    height: size(v.height, MAX_HEIGHT),
    interactive: v.interactive === true,
    focus: v.focus === true,
  };
}

/** Bottom centre of the work area; the content grows upwards. */
export function overlayBounds(
  area: { x: number; y: number; width: number; height: number },
  layout: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(1, layout.width);
  const height = Math.max(1, layout.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - BOTTOM_GAP),
    width,
    height,
  };
}
