import { contextBridge, ipcRenderer, webUtils } from 'electron';

// The UI receives from the desktop shell only: the API session token, the real
// path of files dropped onto the window (browsers hide it), dragging a file
// out of the window (identified by its signed media URL, checked by the main
// process), the window buttons (full screen, minimise, close) and the page to
// open when a notification is clicked. Everything else goes through the REST API (see docs/ARCHITECTURE.md).
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
