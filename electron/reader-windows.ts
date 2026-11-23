import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, screen, shell, type Rectangle } from 'electron';
import { windowBackground } from './window-controls';

// v0.47.0 (Expérimental): the reading windows (ADR 0058) — a module's page
// in a window of its own, WITHOUT the ToolBox interface (route #/w/m/<id>/…):
// Alt+Tab, several at once, F11 for full screen (this window only), closed by
// its own button (Échap closes nothing). Its place and size are remembered
// (<userData>/reader-window.json: the last one moved or resized). Same protections as the main window: the
// app's pages only, links to the default browser, no other navigation.

let appUrl: string | null = null;
let preload: string | null = null;
const open = new Set<BrowserWindow>();

interface Saved {
  bounds: Rectangle;
  maximized: boolean;
}
const stateFile = () => path.join(app.getPath('userData'), 'reader-window.json');

function readSaved(): Saved | null {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<Saved>;
    const b = s.bounds;
    if (!b || ![b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) return null;
    return { bounds: b, maximized: s.maximized === true };
  } catch {
    return null;
  }
}
function save(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isFullScreen() || window.isMinimized()) return;
  try {
    writeFileSync(
      stateFile(),
      JSON.stringify({ bounds: window.getNormalBounds(), maximized: window.isMaximized() }),
    );
  } catch {
    // Not saved: the next window opens with the defaults.
  }
}

/** Where a new window goes: the saved place (on a screen that exists), shifted when one is open. */
function placeOf(saved: Saved | null): Rectangle {
  const work = screen.getPrimaryDisplay().workArea;
  const base = saved?.bounds ?? {
    width: Math.min(1100, work.width - 80),
    height: Math.min(900, work.height - 60),
    x: work.x + Math.round((work.width - Math.min(1100, work.width - 80)) / 2),
    y: work.y + 30,
  };
  // Back on a visible screen when the screens changed.
  const area = screen.getDisplayMatching(base).workArea;
  const width = Math.min(base.width, area.width);
  const height = Math.min(base.height, area.height);
  const shift = 32 * open.size;
  return {
    width,
    height,
    x: Math.min(Math.max(area.x, base.x + shift), area.x + area.width - width),
    y: Math.min(Math.max(area.y, base.y + shift), area.y + area.height - height),
  };
}

export function initReaderWindows(url: string, preloadPath: string): void {
  appUrl = url;
  preload = preloadPath;
}

/** Opens `route` (« /m/coffre/lire/<id> ») in a new reading window. */
export function openReaderWindow(route: string, title: string): void {
  if (!appUrl || !preload) return;
  if (!/^\/m\/[a-z0-9-]+\/[\w\-/%.?=&]*$/i.test(route)) return;
  const saved = readSaved();
  const window = new BrowserWindow({
    ...placeOf(saved),
    minWidth: 480,
    minHeight: 360,
    title: title || 'ToolBox',
    backgroundColor: windowBackground(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  open.add(window);
  const base = appUrl;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(base)) event.preventDefault();
  });
  // F11: this window only (the main window's choice is not changed).
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.alt && !input.control) {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
  const notify = () =>
    !window.isDestroyed() && window.webContents.send('toolbox:fullscreen', window.isFullScreen());
  window.on('enter-full-screen', notify);
  window.on('leave-full-screen', notify);
  // The place Thomas gives a window (moved, resized, maximised) is the one kept: a window
  // only opened then closed (shifted from another one) changes nothing.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let changed = false;
  const later = () => {
    if (!window.isVisible()) return;
    changed = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => save(window), 400);
  };
  window.on('move', later);
  window.on('resize', later);
  window.on('close', () => changed && save(window));
  window.on('closed', () => {
    if (timer) clearTimeout(timer);
    open.delete(window);
  });
  window.once('ready-to-show', () => {
    if (saved?.maximized) window.maximize();
    window.show();
    window.focus();
  });
  void window.loadURL(`${base}#/w${route}`);
}

/** The main window is gone (ToolBox quits): the reading windows go too. */
export function closeReaderWindows(): void {
  for (const w of open) if (!w.isDestroyed()) w.close();
}

/** How many are open (the smoke test). */
export const readerWindowCount = () => open.size;
