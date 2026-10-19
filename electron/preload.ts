import { contextBridge, ipcRenderer } from 'electron';

// The only thing the UI receives from the desktop shell is the API session
// token. Everything else goes through the REST API (see docs/ARCHITECTURE.md).
const config = ipcRenderer.sendSync('toolbox:get-config') as { token: string };

contextBridge.exposeInMainWorld('toolbox', {
  token: config.token,
});
