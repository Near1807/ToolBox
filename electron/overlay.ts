import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

// Floating indicator (« HUD ») of a module, e.g. the assistant listening /
// thinking / speaking: a small transparent window, always on top, visible even
// when ToolBox is minimised. It never takes the focus nor the mouse. It shows
// the `Overlay` components of the modules (route #/overlay). ADR 0028.

const WIDTH = 360;
const HEIGHT = 96;

let appUrl: string | null = null;
let overlay: BrowserWindow | null = null;
let wanted = false;

function create(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
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
    title: 'ToolBox — indicateur',
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
  });
  return window;
}

function place(window: BrowserWindow): void {
  const area = screen.getPrimaryDisplay().workArea;
  window.setBounds({
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: area.y + area.height - HEIGHT - 24,
    width: WIDTH,
    height: HEIGHT,
  });
}

function apply(): void {
  if (!appUrl) return;
  if (wanted) {
    overlay ??= create(appUrl);
    place(overlay);
    overlay.showInactive();
  } else {
    overlay?.hide();
  }
}

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
