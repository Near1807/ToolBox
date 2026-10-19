import { safeStorage, shell } from 'electron';
import type { HostAdapter } from '../backend/core/host';

/** Electron implementation of the backend's HostAdapter. */
export function createElectronHost(): HostAdapter {
  return {
    openPath: async (target) => {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    },
    showItemInFolder: (target) => shell.showItemInFolder(target),
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plainText) => safeStorage.encryptString(plainText),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  };
}
