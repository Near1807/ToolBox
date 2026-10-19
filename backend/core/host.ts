/**
 * Everything the backend needs from the desktop shell (Electron), behind an
 * interface so the backend stays testable in plain Node and never imports
 * `electron` directly. The Electron implementation lives in electron/host.ts.
 */
export interface HostAdapter {
  /** Opens a file or folder with the OS default application. */
  openPath(path: string): Promise<void>;
  /** Reveals a file in the OS file explorer. */
  showItemInFolder(path: string): void;
  /** True when OS-level encryption (Electron safeStorage / DPAPI) is usable. */
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Host used by tests and by the standalone backend: no OS integration. */
export function createNullHost(): HostAdapter {
  return {
    openPath: async () => {},
    showItemInFolder: () => {},
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('Chiffrement indisponible hors Electron');
    },
    decryptString: () => {
      throw new Error('Chiffrement indisponible hors Electron');
    },
  };
}
