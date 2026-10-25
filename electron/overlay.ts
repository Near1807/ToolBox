import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { overlayBounds, parseLayout, type OverlayLayout } from './overlay-layout';

// The one floating window of the hub: transparent, always on top, visible
// over the application in use even when ToolBox is minimised. It shows the
// `Overlay` components of the modules (route #/overlay), stacked in a column,
// and takes the size of that content. By default it never takes the focus nor
// the mouse; a panel with buttons makes it take the mouse (clicks without
// activating it), a panel with a text field makes it take the keyboard focus
// until the panel goes. ADR 0028, 0036; MODULES.md §5.16.

let appUrl: string | null = null;
let overlay: BrowserWindow | null = null;
let wanted = false;
let layout: OverlayLayout = { width: 0, height: 0, interactive: false, focus: false };
let focused = false;

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
  window.setIgnoreMouseEvents(true);
  window.setVisibleOnAllWorkspaces(true);
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
  overlay.setBounds(overlayBounds(screen.getPrimaryDisplay().workArea, layout));
  overlay.setIgnoreMouseEvents(empty || !layout.interactive);
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
