import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';

// Window chrome: the native title bar follows the theme chosen in the app
// (light or dark, remembered for the next start), and the UI
// can switch to full screen (F11 or its own button), where it draws its own
// minimise / leave full screen / close buttons. The choice is remembered.

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

type ColorScheme = 'dark' | 'light';

interface WindowState {
  fullscreen: boolean;
  colorScheme: ColorScheme;
}

function readState(): WindowState {
  try {
    const state = JSON.parse(readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;
    return {
      fullscreen: state.fullscreen === true,
      colorScheme: state.colorScheme === 'light' ? 'light' : 'dark',
    };
  } catch {
    return { fullscreen: false, colorScheme: 'dark' };
  }
}

function saveState(change: Partial<WindowState>): void {
  try {
    writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...change }));
  } catch {
    // Not critical: the window simply opens with the defaults next time.
  }
}

/** Native title bar (Windows 10/11) in the scheme of the last theme used (dark by default). */
export function applyWindowChrome(): void {
  nativeTheme.themeSource = readState().colorScheme;
}

/** Window background shown before the page paints (avoids a flash of the wrong colour). */
export function windowBackground(): string {
  return readState().colorScheme === 'light' ? '#f3f4f9' : '#06070c';
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
    saveState({ fullscreen });
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

// The UI switched theme: the title bar follows its light/dark scheme.
ipcMain.on('toolbox:color-scheme', (_event, scheme: unknown) => {
  if (scheme !== 'dark' && scheme !== 'light') return;
  nativeTheme.themeSource = scheme;
  saveState({ colorScheme: scheme });
});
