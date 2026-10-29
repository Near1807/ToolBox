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

// The one floating window of the hub: transparent, always on top, visible
// over the application in use even when ToolBox is minimised. It shows the
// `Overlay` components of the modules (route #/overlay), stacked in a column,
// and takes the size of that content. By default it never takes the focus nor
// the mouse; a panel with buttons makes it take the mouse (clicks without
// activating it), a panel with a text field makes it take the keyboard focus
// until the panel goes. It goes where Thomas wants it: a corner or a centre
// chosen in the Settings, or dragged by its grip (position kept in
// <userData>/overlay-position.json, brought back on screen when the
// resolution changes; « Verrouiller » hides the grip). ADR 0028, 0036; MODULES.md §5.16.

let appUrl: string | null = null;
let overlay: BrowserWindow | null = null;
let wanted = false;
let layout: OverlayLayout = { width: 0, height: 0, interactive: false, focus: false };
let focused = false;
let hovering = false;
let drag: { timer: ReturnType<typeof setInterval>; dx: number; dy: number } | null = null;

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
    movable: false,
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
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void window.loadURL(`${url}#/overlay`);
  window.on('closed', () => {
    overlay = null;
    focused = false;
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
  if (!drag) overlay.setBounds(overlayBounds(workArea(), layout, position));
  // Clicks go through, except over a panel with buttons or the grip
  // (mouse moves are still forwarded, so that the page sees the grip hovered).
  const takeMouse = !empty && (layout.interactive || hovering || drag !== null);
  overlay.setIgnoreMouseEvents(!takeMouse, { forward: true });
  if (empty && focused) {
    release(overlay);
    overlay.showInactive();
    return;
  }
  if (layout.focus && !focused) {
    // A text field: the window takes the keyboard (the user typed the shortcut for it).
    focused = true;
    overlay.setFocusable(true);
    overlay.show();
    overlay.focus();
    overlay.webContents.focus();
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

// The grip: hovered (the window takes the mouse), dragged (it follows the cursor).
ipcMain.on('toolbox:overlay-hover', (event, value: unknown) => {
  if (!overlay || event.sender !== overlay.webContents) return;
  hovering = value === true && !position.locked;
  apply();
});
ipcMain.on('toolbox:overlay-drag', (event, phase: unknown) => {
  if (!overlay || event.sender !== overlay.webContents || position.locked) return;
  const window = overlay;
  if (phase === 'start' && !drag) {
    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    drag = {
      dx: cursor.x - bounds.x,
      dy: cursor.y - bounds.y,
      timer: setInterval(() => {
        if (!drag) return;
        const c = screen.getCursorScreenPoint();
        const b = window.getBounds();
        window.setBounds({ x: c.x - drag.dx, y: c.y - drag.dy, width: b.width, height: b.height });
      }, 16),
    };
    apply();
  } else if (phase === 'end' && drag) {
    clearInterval(drag.timer);
    drag = null;
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    savePosition(draggedPosition(area, bounds, position.locked));
  }
});
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
