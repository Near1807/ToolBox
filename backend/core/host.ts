import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  /** Moves a file to the OS Recycle Bin (recoverable deletion). */
  trashItem(path: string): Promise<void>;
  /** Native folder picker; null when cancelled. */
  selectFolder(options: { title: string; defaultPath?: string }): Promise<string | null>;
  /** Native file picker; empty when cancelled. */
  selectFiles(options: {
    title: string;
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
  }): Promise<string[]>;
  /** Native "save as" dialog; null when cancelled. */
  selectSaveFile(options: {
    title: string;
    defaultPath: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  /** Default root for generated files (e.g. the user's Videos folder). */
  getDefaultOutputRoot(): string;
  /** Restarts the whole application. */
  relaunch(): void;
  /** True when OS-level encryption (Electron safeStorage / DPAPI) is usable. */
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Host used by tests and by a standalone backend: no OS integration, no encryption. */
export function createNullHost(overrides: Partial<HostAdapter> = {}): HostAdapter {
  const unavailable = () => {
    throw new Error('Chiffrement indisponible hors Electron');
  };
  return {
    openPath: async () => {},
    showItemInFolder: () => {},
    // Outside Electron there is no Recycle Bin: tests and the standalone backend delete.
    trashItem: async (target) => rm(target, { force: true }),
    selectFolder: async () => null,
    selectFiles: async () => [],
    selectSaveFile: async () => null,
    getDefaultOutputRoot: () => path.join(os.tmpdir(), 'ToolBox'),
    relaunch: () => {},
    isEncryptionAvailable: () => false,
    encryptString: unavailable,
    decryptString: unavailable,
    ...overrides,
  };
}
