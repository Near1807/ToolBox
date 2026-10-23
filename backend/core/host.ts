import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** A key going down or up, from the system-wide keyboard hook. */
export interface HostKeyEvent {
  type: 'down' | 'up';
  /** libuiohook key code. */
  code: number;
}

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
  /** Opens a web page in the user's default browser (OAuth consent, YouTube Studio…). */
  openExternal(url: string): Promise<void>;
  /**
   * Shows a desktop notification; clicking it brings the window to the front
   * and opens `target` (a route of the UI, e.g. "/m/release-planner").
   */
  notify(notification: { title: string; body: string; target?: string }): void;
  /** Starts the app with Windows (minimised to the notification area), or not. */
  setLaunchAtStartup(enabled: boolean): void;
  /** Shows the main window (restored, focused) and opens a UI route. */
  showWindow(target?: string): void;
  /** Shows or hides the floating indicator window (always on top, never takes the focus). */
  setOverlayVisible(visible: boolean): void;
  /**
   * System-wide keyboard hook (push-to-talk), absent outside the desktop app.
   * start() throws when the hook cannot run.
   */
  globalKeys?: {
    start(listener: (event: HostKeyEvent) => void): void;
    stop(): void;
    /** French label of a key code (« Touche Copilot (F23) », « Ctrl droit »). */
    label(code: number): string;
  };
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
    openExternal: async () => {},
    notify: () => {},
    setLaunchAtStartup: () => {},
    showWindow: () => {},
    setOverlayVisible: () => {},
    isEncryptionAvailable: () => false,
    encryptString: unavailable,
    decryptString: unavailable,
    ...overrides,
  };
}
