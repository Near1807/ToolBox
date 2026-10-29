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

export type OverlayAnchor =
  | 'bottom-center'
  | 'top-center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'custom';

export const ANCHORS: OverlayAnchor[] = [
  'bottom-center',
  'top-center',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'custom',
];

/**
 * Where the floating window goes: a corner or a centre of the screen, or
 * where it was dragged (`custom`: horizontal centre `x`, and the edge that
 * stays put while the content grows: its top `y`, or its bottom `y`).
 */
export interface OverlayPosition {
  anchor: OverlayAnchor;
  x?: number;
  y?: number;
  edge?: 'top' | 'bottom';
  /** The grip is hidden: the window cannot be dragged. */
  locked: boolean;
}

export const DEFAULT_POSITION: OverlayPosition = { anchor: 'bottom-center', locked: false };

/** A position read from the file or sent by the Settings page, checked. */
export function parsePosition(value: unknown): OverlayPosition {
  if (!value || typeof value !== 'object') return DEFAULT_POSITION;
  const v = value as Record<string, unknown>;
  const anchor = ANCHORS.includes(v.anchor as OverlayAnchor)
    ? (v.anchor as OverlayAnchor)
    : 'bottom-center';
  const num = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : undefined;
  const position: OverlayPosition = { anchor, locked: v.locked === true };
  if (anchor === 'custom') {
    const x = num(v.x);
    const y = num(v.y);
    if (x === undefined || y === undefined)
      return { anchor: 'bottom-center', locked: position.locked };
    position.x = x;
    position.y = y;
    position.edge = v.edge === 'top' ? 'top' : 'bottom';
  }
  return position;
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Bounds of the window for its content and its position, always inside the
 * work area (taskbar excluded) of the screen given: a dragged position from
 * another resolution comes back on screen. Bottom anchors grow upwards, top
 * anchors downwards.
 */
export function overlayBounds(
  area: Rect,
  layout: { width: number; height: number },
  position: OverlayPosition = DEFAULT_POSITION,
): Rect {
  const width = Math.max(1, layout.width);
  const height = Math.max(1, layout.height);
  const gap = BOTTOM_GAP;
  let x: number;
  let y: number;
  const { anchor } = position;
  if (anchor === 'custom') {
    x = (position.x ?? area.x + area.width / 2) - width / 2;
    y =
      position.edge === 'top'
        ? (position.y ?? area.y)
        : (position.y ?? area.y + area.height) - height;
  } else {
    const [vertical, horizontal] = anchor.split('-') as [
      'top' | 'bottom',
      'left' | 'center' | 'right',
    ];
    x =
      horizontal === 'left'
        ? area.x + gap
        : horizontal === 'right'
          ? area.x + area.width - width - gap
          : area.x + (area.width - width) / 2;
    y = vertical === 'top' ? area.y + gap : area.y + area.height - height - gap;
  }
  // Inside the screen, whatever happened to the resolution.
  x = Math.min(Math.max(x, area.x), area.x + area.width - width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/** The position a dragged window keeps: its centre, and the edge nearest to its side of the screen. */
export function draggedPosition(area: Rect, bounds: Rect, locked: boolean): OverlayPosition {
  const top = bounds.y + bounds.height / 2 < area.y + area.height / 2;
  return {
    anchor: 'custom',
    x: Math.round(bounds.x + bounds.width / 2),
    y: top ? bounds.y : bounds.y + bounds.height,
    edge: top ? 'top' : 'bottom',
    locked,
  };
}
