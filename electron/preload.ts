import { contextBridge, ipcRenderer, webUtils } from 'electron';

// The UI receives from the desktop shell only the API session token and the
// real path of files dropped onto the window (browsers hide it). Everything
// else goes through the REST API (see docs/ARCHITECTURE.md).
const config = ipcRenderer.sendSync('toolbox:get-config') as { token: string };

contextBridge.exposeInMainWorld('toolbox', {
  token: config.token,
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
});
