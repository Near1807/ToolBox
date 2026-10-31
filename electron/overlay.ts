import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  draggedPosition,
  overlayBounds,
  parseLayout,
  parsePosition,
  type OverlayLayout,
  type OverlayPosition,
} from './overlay-layout';
import { takeKeyboard, type FocusOutcome } from './overlay-focus';
import { canTapAlt, tapAlt } from './global-keys';

// The one floating window of the hub: transparent, always on top, visible
// over the application in use even when ToolBox is minimised. It shows the
// `Overlay` components of the modules (route #/overlay), stacked in a column,
// and takes the size of that content. By default it never takes the focus nor
// the mouse; a panel with buttons makes it take the mouse (clicks without
// activating it), a panel with a text field makes it take the keyboard focus
// until the panel goes. It goes where Thomas wants it: a corner or a centre
// chosen in the Settings, or dragged by its grip (position kept in
// <userData>/overlay-position.json, brought back on screen when the
// resolution changes; « Verrouiller » hides the grip). The grip is a native
// drag region (-webkit-app-region: drag): the system moves the window, so the
// move follows the mouse exactly, whatever the display scaling. ADR 0028, 0036; MODULES.md §5.16.

let appUrl: string | null = null;
let overlay: BrowserWindow | null = null;
let wanted = false;
let layout: OverlayLayout = { width: 0, height: 0, interactive: false, focus: false };
let focused = false;
let hovering = false;
/** The grip is hovered: checked every 200 ms until the cursor leaves the window. */
let hoverWatch: ReturnType<typeof setInterval> | null = null;
/** The system is moving the window (native drag); ends when the moves stop. */
let moving = false;
let moveEnd: ReturnType<typeof setTimeout> | null = null;
/** The bounds the hub gave the window last: a `move` elsewhere is a drag. */
let placed: { x: number; y: number } | null = null;

const positionFile = () => path.join(app.getPath('userData'), 'overlay-position.json');
let position: OverlayPosition = (() => {
  try {
    return parsePosition(JSON.parse(readFileSync(positionFile(), 'utf8')));
  } catch {
    return parsePosition(null);
  }
})();
function savePosition(next: OverlayPosition): void {
  position = next;
  try {
    writeFileSync(positionFile(), JSON.stringify(position));
  } catch {
    // Not saved: the window still goes there for this session.
  }
  overlay?.webContents.send('toolbox:overlay-prefs', { locked: position.locked });
  overlay?.setMovable(!position.locked);
  if (position.locked) stopHover();
  apply();
}
/** The screen of the window: the one nearest to where it was dragged, else the main one. */
function workArea() {
  if (position.anchor === 'custom' && position.x !== undefined && position.y !== undefined)
    return screen.getDisplayNearestPoint({ x: position.x, y: position.y }).workArea;
  return screen.getPrimaryDisplay().workArea;
}

function create(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    resizable: false,
    movable: !position.locked,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: 'ToolBox — fenêtre flottante',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(true, { forward: true });
  window.setVisibleOnAllWorkspaces(true);
  window.webContents.on('did-finish-load', () =>
    window.webContents.send('toolbox:overlay-prefs', { locked: position.locked }),
  );
  // Native drag by the grip: `will-move` / `moved` on Windows and macOS, a
  // pause in the `move` events elsewhere. The window ends where it was dropped
  // (brought back inside the screen, at the size of its content).
  window.on('will-move', () => {
    moving = true;
  });
  window.on('move', () => {
    const b = window.getBounds();
    // Ours (a pixel of rounding at 125 % or 150 % allowed): not a drag.
    if (!moving && placed && Math.abs(b.x - placed.x) <= 2 && Math.abs(b.y - placed.y) <= 2) return;
    moving = true;
    if (moveEnd) clearTimeout(moveEnd);
    moveEnd = setTimeout(endMove, 600);
  });
  window.on('moved', () => endMove());
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void window.loadURL(`${url}#/overlay`);
  window.on('closed', () => {
    overlay = null;
    focused = false;
    moving = false;
    stopHover();
  });
  return window;
}

function apply(): void {
  if (!appUrl) return;
  if (wanted) overlay ??= create(appUrl);
  if (!overlay) return;
  if (!wanted) {
    if (focused) release(overlay);
    overlay.hide();
    return;
  }
  // Nothing to show yet: 1 × 1 transparent pixel, kept shown so that the page
  // lays out and measures its content (a hidden window may not).
  const empty = layout.width === 0 || layout.height === 0;
  if (!moving) {
    const bounds = overlayBounds(workArea(), layout, position);
    placed = { x: bounds.x, y: bounds.y };
    overlay.setBounds(bounds);
  }
  // Clicks go through, except over a panel with buttons or the grip
  // (mouse moves are still forwarded, so that the page sees the grip hovered).
  const takeMouse = !empty && (layout.interactive || hovering || moving);
  overlay.setIgnoreMouseEvents(!takeMouse, { forward: true });
  if (empty && focused) {
    release(overlay);
    overlay.showInactive();
    return;
  }
  if (layout.focus && !focused) {
    // A text field: the window takes the keyboard (the user typed the shortcut for it).
    focused = true;
    const window = overlay;
    void takeKeyboard(window, {
      canTapAlt: canTapAlt(),
      tapAlt,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    }).then((outcome: FocusOutcome) => {
      if (window.isDestroyed()) return;
      // The page shows « clique dans le champ » when the keyboard stayed elsewhere.
      window.webContents.send('toolbox:overlay-keyboard', outcome !== 'not-focused');
      if (outcome !== 'focused') console.info(`[overlay] keyboard: ${outcome}`);
    });
  } else if (!layout.focus && focused) {
    release(overlay);
    overlay.showInactive();
  } else if (!overlay.isVisible()) {
    overlay.showInactive();
  }
}

/** Gives the keyboard back: hiding the window returns it to the application below. */
function release(window: BrowserWindow): void {
  focused = false;
  window.setFocusable(false);
  window.hide();
}

ipcMain.on('toolbox:overlay-layout', (event, value: unknown) => {
  if (!overlay || event.sender !== overlay.webContents) return;
  const next = parseLayout(value);
  if (!next) return;
  layout = next;
  apply();
});

// The grip hovered: the window takes the mouse, so that the system can drag it
// by the grip. Not given back by the page (a drag region gets no mouse events):
// the main process checks that the cursor is still over the window.
ipcMain.on('toolbox:overlay-hover', (event, value: unknown) => {
  if (!overlay || event.sender !== overlay.webContents) return;
  if (value !== true || position.locked || hovering) return;
  hovering = true;
  const window = overlay;
  hoverWatch = setInterval(() => {
    if (moving || window.isDestroyed()) return;
    const c = screen.getCursorScreenPoint();
    const b = window.getBounds();
    if (c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height) return;
    stopHover();
    apply();
  }, 200);
  apply();
});
function stopHover(): void {
  hovering = false;
  if (hoverWatch) clearInterval(hoverWatch);
  hoverWatch = null;
}
/** The drag is over: the position is kept, and the window placed again. */
function endMove(): void {
  if (moveEnd) clearTimeout(moveEnd);
  moveEnd = null;
  if (!moving || !overlay) return;
  moving = false;
  const bounds = overlay.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  savePosition(draggedPosition(area, bounds, position.locked));
}
// The Settings page (main window): read or change the position.
ipcMain.handle('toolbox:overlay-position', (event, value: unknown) => {
  if (overlay && event.sender === overlay.webContents) return position;
  if (value !== undefined) savePosition(parsePosition(value));
  return position;
});
app.whenReady().then(
  () => {
    // Resolution or screens changed: back inside the screen.
    for (const name of ['display-metrics-changed', 'display-added', 'display-removed'] as const)
      screen.on(name as 'display-added', () => apply());
  },
  () => {},
);

/** Called once the UI address is known (after the backend started). */
export function initOverlay(url: string): void {
  appUrl = url;
  apply();
}

export function setOverlayVisible(visible: boolean): void {
  wanted = visible;
  apply();
}

export function closeOverlay(): void {
  overlay?.destroy();
  overlay = null;
}
