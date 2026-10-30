import type { HostAdapter, HostKeyEvent } from '../backend/core/host';

// System-wide keyboard hook (push-to-talk) with uiohook-napi (libuiohook,
// N-API prebuilds: no rebuild for Electron). Loaded only when a module listens.
// Only the key code goes to the backend; nothing is stored. ADR 0028.

type Uiohook = typeof import('uiohook-napi');

let library: Uiohook | null = null;
let listener: ((event: HostKeyEvent) => void) | null = null;
/** Our own simulated Alt (floating window focus): never seen as a key of the user. */
let synthetic = false;

const LABELS: Record<string, string> = {
  F23: 'Touche Copilot (Win+Maj+F23)',
  Ctrl: 'Ctrl gauche',
  CtrlRight: 'Ctrl droit',
  Alt: 'Alt',
  AltRight: 'Alt Gr',
  Shift: 'Maj gauche',
  ShiftRight: 'Maj droite',
  Meta: 'Windows',
  MetaRight: 'Windows droite',
  Space: 'Espace',
  CapsLock: 'Verr. Maj',
  ScrollLock: 'Arrêt défil',
  PrintScreen: 'Impr. écran',
  Insert: 'Inser',
  Delete: 'Suppr',
  Pause: 'Pause',
  Escape: 'Échap',
  Enter: 'Entrée',
  Backquote: '²',
};

function load(): Uiohook {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  library ??= require('uiohook-napi') as Uiohook;
  return library;
}

export function createGlobalKeys(): NonNullable<HostAdapter['globalKeys']> {
  let names: Map<number, string> | null = null;
  return {
    start(next) {
      const { uIOhook } = load();
      if (!listener) {
        uIOhook.on('keydown', (e) => synthetic || listener?.({ type: 'down', code: e.keycode }));
        uIOhook.on('keyup', (e) => synthetic || listener?.({ type: 'up', code: e.keycode }));
      }
      listener = next;
      uIOhook.start();
    },
    stop() {
      if (!library) return;
      library.uIOhook.stop();
    },
    label(code) {
      names ??= new Map(
        Object.entries(load().UiohookKey).map(([name, value]) => [value as number, name]),
      );
      const name = names.get(code);
      if (!name) return `Touche ${code}`;
      return LABELS[name] ?? (name.length === 1 ? name.toUpperCase() : name);
    },
  };
}

/**
 * Presses Alt, runs `between`, releases Alt (Windows only, once the hook is
 * loaded): lets the floating window take the keyboard from the application
 * in front (electron/overlay-focus.ts). The hook ignores these two events.
 */
export function canTapAlt(): boolean {
  return process.platform === 'win32' && library !== null;
}
export function tapAlt(between: () => void): void {
  if (!canTapAlt()) return between();
  const { uIOhook, UiohookKey } = library!;
  synthetic = true;
  try {
    uIOhook.keyToggle(UiohookKey.Alt, 'down');
    between();
  } finally {
    uIOhook.keyToggle(UiohookKey.Alt, 'up');
    // The hook sees the events a moment later, on its own thread.
    setTimeout(() => {
      synthetic = false;
    }, 100);
  }
}
