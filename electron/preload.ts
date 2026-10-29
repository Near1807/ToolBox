import { contextBridge, ipcRenderer, webUtils } from 'electron';

// The UI receives from the desktop shell only: the API session token, the real
// path of files dropped onto the window (browsers hide it), dragging a file
// out of the window (identified by its signed media URL, checked by the main
// process), the window buttons (full screen, minimise, close), the light/dark scheme of the title bar, the size of the floating
// window and the page to open when a notification is clicked. Everything else goes through the REST API (see docs/ARCHITECTURE.md).
const config = ipcRenderer.sendSync('toolbox:get-config') as { token: string };

contextBridge.exposeInMainWorld('toolbox', {
  token: config.token,
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  startDrag: (mediaUrl: string): void => ipcRenderer.send('toolbox:start-drag', mediaUrl),
  window: {
    isFullscreen: (): Promise<boolean> =>
      ipcRenderer.invoke('toolbox:is-fullscreen') as Promise<boolean>,
    onFullscreenChange: (listener: (fullscreen: boolean) => void): (() => void) => {
      const handler = (_event: unknown, fullscreen: unknown) => listener(fullscreen === true);
      ipcRenderer.on('toolbox:fullscreen', handler);
      return () => ipcRenderer.removeListener('toolbox:fullscreen', handler);
    },
    toggleFullscreen: (): void => ipcRenderer.send('toolbox:window', 'toggle-fullscreen'),
    minimize: (): void => ipcRenderer.send('toolbox:window', 'minimize'),
    close: (): void => ipcRenderer.send('toolbox:window', 'close'),
    setColorScheme: (scheme: 'dark' | 'light'): void =>
      ipcRenderer.send('toolbox:color-scheme', scheme),
  },
  // Floating window only: its size and whether it takes the mouse / the keyboard
  // (checked by the main process, which ignores it from any other window).
  overlay: {
    layout: (layout: unknown): void => ipcRenderer.send('toolbox:overlay-layout', layout),
    hover: (over: boolean): void => ipcRenderer.send('toolbox:overlay-hover', over),
    drag: (phase: 'start' | 'end'): void => ipcRenderer.send('toolbox:overlay-drag', phase),
    onPrefs: (listener: (prefs: { locked: boolean }) => void): (() => void) => {
      const handler = (_event: unknown, prefs: unknown) => listener(prefs as { locked: boolean });
      ipcRenderer.on('toolbox:overlay-prefs', handler);
      return () => ipcRenderer.removeListener('toolbox:overlay-prefs', handler);
    },
    /** Settings page: the position (read, or changed when `value` is given). */
    position: (value?: unknown): Promise<unknown> =>
      ipcRenderer.invoke('toolbox:overlay-position', value),
  },
  // A notification was clicked: the shell opens this route (e.g. "/m/release-planner").
  onNavigate: (listener: (target: string) => void): (() => void) => {
    const handler = (_event: unknown, target: unknown) => {
      if (typeof target === 'string' && target.startsWith('/')) listener(target);
    };
    ipcRenderer.on('toolbox:navigate', handler);
    return () => ipcRenderer.removeListener('toolbox:navigate', handler);
  },
});
