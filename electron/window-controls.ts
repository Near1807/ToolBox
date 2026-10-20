import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';

// Window chrome: the native title bar follows the app's dark theme, and the UI
// can switch to full screen (F11 or its own button), where it draws its own
// minimise / leave full screen / close buttons. The choice is remembered.

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function readState(): { fullscreen: boolean } {
  try {
    const state = JSON.parse(readFileSync(stateFile(), 'utf8')) as { fullscreen?: unknown };
    return { fullscreen: state.fullscreen === true };
  } catch {
    return { fullscreen: false };
  }
}

function saveState(fullscreen: boolean): void {
  try {
    writeFileSync(stateFile(), JSON.stringify({ fullscreen }));
  } catch {
    // Not critical: the window simply opens windowed next time.
  }
}

/** Dark native title bar (Windows 10/11), instead of the light system default. */
export function applyDarkWindowChrome(): void {
  nativeTheme.themeSource = 'dark';
}

/** Whether the window should open in full screen (last choice of the user). */
export function startsFullscreen(): boolean {
  return readState().fullscreen;
}

/** Wires F11, the UI's window buttons and the full-screen notifications. */
export function attachWindowControls(window: BrowserWindow): void {
  const notify = () => {
    if (window.isDestroyed()) return;
    const fullscreen = window.isFullScreen();
    window.webContents.send('toolbox:fullscreen', fullscreen);
    saveState(fullscreen);
  };
  window.on('enter-full-screen', notify);
  window.on('leave-full-screen', notify);
  // Electron has no F11 binding once the menu is hidden.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.alt && !input.control) {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
}

ipcMain.handle('toolbox:is-fullscreen', (event) =>
  Boolean(BrowserWindow.fromWebContents(event.sender)?.isFullScreen()),
);

ipcMain.on('toolbox:window', (event, action: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (action === 'toggle-fullscreen') window.setFullScreen(!window.isFullScreen());
  else if (action === 'minimize') window.minimize();
  else if (action === 'close') window.close();
});
