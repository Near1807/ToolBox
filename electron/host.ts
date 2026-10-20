import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron';
import path from 'node:path';
import type { HostAdapter } from '../backend/core/host';

/** Electron implementation of the backend's HostAdapter. */
export function createElectronHost(): HostAdapter {
  const parent = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  return {
    openPath: async (target) => {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    },
    showItemInFolder: (target) => shell.showItemInFolder(target),
    trashItem: (target) => shell.trashItem(target),
    selectFolder: async ({ title, defaultPath }) => {
      const window = parent();
      const options: Electron.OpenDialogOptions = {
        title,
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    selectFiles: async ({ title, filters, multiple }) => {
      const window = parent();
      const options: Electron.OpenDialogOptions = {
        title,
        filters,
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    },
    selectSaveFile: async ({ title, defaultPath, filters }) => {
      const window = parent();
      const options: Electron.SaveDialogOptions = { title, defaultPath, filters };
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      return result.canceled ? null : (result.filePath ?? null);
    },
    getDefaultOutputRoot: () => path.join(app.getPath('videos'), 'ToolBox'),
    relaunch: () => {
      app.relaunch();
      app.quit();
    },
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plainText) => safeStorage.encryptString(plainText),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  };
}
