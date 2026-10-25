import type {
  HotkeyModifier,
  HotkeySpec,
  ModuleHotkeys,
  ModuleLogger,
} from '../../packages/sdk/backend';
import type { HostAdapter, HostKeyEvent } from './host';

// System-wide keys (push-to-talk). The keyboard hook only runs while a module
// listens or captures a key: nothing is watched otherwise. Only the bound key
// codes are looked at; keystrokes are never stored or logged.

interface Binding {
  code: number;
  modifiers: HotkeyModifier[];
  onPress: () => void;
  onRelease: () => void;
}

/** libuiohook codes of the modifiers (both sides). */
const MODIFIERS = new Map<number, HotkeyModifier>([
  [29, 'ctrl'],
  [3613, 'ctrl'],
  [56, 'alt'],
  [3640, 'alt'],
  [42, 'shift'],
  [54, 'shift'],
  [3675, 'meta'],
  [3676, 'meta'],
]);
const MODIFIER_LABELS: Record<HotkeyModifier, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Maj',
  meta: 'Windows',
};
const ORDER: HotkeyModifier[] = ['ctrl', 'alt', 'shift', 'meta'];

/** « Ctrl + Maj + Espace ». */
export function comboLabel(modifiers: HotkeyModifier[], key: string): string {
  return [...ORDER.filter((m) => modifiers.includes(m)).map((m) => MODIFIER_LABELS[m]), key].join(
    ' + ',
  );
}

/** Same key and same modifiers (order ignored): two bindings that would fire together. */
export function sameHotkey(a: HotkeySpec | null, b: HotkeySpec | null): boolean {
  if (!a || !b || a.code !== b.code) return false;
  const ma = [...(a.modifiers ?? [])].sort().join();
  const mb = [...(b.modifiers ?? [])].sort().join();
  return ma === mb;
}

export class HotkeyManager {
  private readonly bindings = new Map<string, Binding>();
  private readonly captures: ((key: HotkeySpec) => void)[] = [];
  private readonly pressed = new Set<number>();
  /** A modifier pressed during a capture: captured alone if released with nothing else. */
  private captureModifier: number | null = null;
  private running = false;
  private error: string | null = null;

  constructor(
    private readonly host: HostAdapter,
    private readonly logger: ModuleLogger,
  ) {}

  status(): { available: boolean; reason: string | null } {
    if (!this.host.globalKeys) {
      return {
        available: false,
        reason: 'Touche globale disponible seulement dans l’app de bureau',
      };
    }
    if (this.error) return { available: false, reason: this.error };
    return { available: true, reason: null };
  }

  private onKey = (event: HostKeyEvent): void => {
    if (event.type === 'down') {
      if (this.pressed.has(event.code)) return; // auto-repeat
      const held = this.heldModifiers();
      this.pressed.add(event.code);
      if (this.captures.length > 0) {
        if (MODIFIERS.has(event.code)) {
          this.captureModifier = event.code;
          return;
        }
        this.captureModifier = null;
        this.resolveCapture(
          held.length
            ? {
                code: event.code,
                label: comboLabel(held, this.host.globalKeys!.label(event.code)),
                modifiers: held,
              }
            : { code: event.code, label: this.host.globalKeys!.label(event.code) },
        );
        return;
      }
      for (const binding of this.bindings.values()) {
        if (binding.code !== event.code) continue;
        // A combination needs exactly its modifiers; a single key fires whatever is held.
        if (binding.modifiers.length && !sameModifiers(binding.modifiers, held)) continue;
        this.safely(binding.onPress);
      }
    } else {
      if (!this.pressed.delete(event.code)) return;
      if (this.captures.length > 0 && this.captureModifier === event.code) {
        this.captureModifier = null;
        this.resolveCapture({ code: event.code, label: this.host.globalKeys!.label(event.code) });
        return;
      }
      for (const binding of this.bindings.values()) {
        if (binding.code === event.code) this.safely(binding.onRelease);
      }
    }
  };

  private heldModifiers(): HotkeyModifier[] {
    const held = new Set<HotkeyModifier>();
    for (const code of this.pressed) {
      const m = MODIFIERS.get(code);
      if (m) held.add(m);
    }
    return ORDER.filter((m) => held.has(m));
  }

  private resolveCapture(key: HotkeySpec): void {
    const capture = this.captures.shift();
    capture?.(key);
    this.update();
  }

  private safely(handler: () => void): void {
    try {
      handler();
    } catch (error) {
      this.logger.error('Touche globale : erreur du module', error);
    }
  }

  /** Starts the hook only when someone listens, stops it otherwise. */
  private update(): void {
    const keys = this.host.globalKeys;
    if (!keys) return;
    const needed = this.bindings.size > 0 || this.captures.length > 0;
    if (needed && !this.running) {
      try {
        keys.start(this.onKey);
        this.running = true;
        this.error = null;
      } catch (error) {
        this.error = `Écoute du clavier impossible : ${error instanceof Error ? error.message : String(error)}`;
        this.logger.warn(this.error);
      }
    } else if (!needed && this.running) {
      keys.stop();
      this.running = false;
      this.pressed.clear();
    }
  }

  stop(): void {
    this.bindings.clear();
    this.captures.length = 0;
    this.update();
  }

  forModule(
    moduleId: string,
    allowed: boolean,
    onDispose: (dispose: () => void) => void,
  ): ModuleHotkeys {
    const guard = () => {
      if (!allowed) {
        throw new Error('ctx.hotkeys : « permissions.globalKeys » non déclaré dans module.json');
      }
    };
    const prefix = `${moduleId}\u0000`;
    onDispose(() => {
      for (const id of [...this.bindings.keys()])
        if (id.startsWith(prefix)) this.bindings.delete(id);
      this.update();
    });
    return {
      status: () => this.status(),
      hold: (key, handlers, name = 'default') => {
        guard();
        const id = `${prefix}${name}`;
        if (key)
          this.bindings.set(id, { code: key.code, modifiers: key.modifiers ?? [], ...handlers });
        else this.bindings.delete(id);
        this.update();
      },
      capture: (timeoutMs = 10_000) => {
        guard();
        if (!this.status().available) return Promise.resolve(null);
        return new Promise<HotkeySpec | null>((resolve) => {
          const resolver = (key: HotkeySpec) => {
            clearTimeout(timer);
            resolve(key);
          };
          const timer = setTimeout(() => {
            const index = this.captures.indexOf(resolver);
            if (index >= 0) this.captures.splice(index, 1);
            this.update();
            resolve(null);
          }, timeoutMs);
          this.captures.push(resolver);
          this.update();
        });
      },
    };
  }
}

function sameModifiers(a: HotkeyModifier[], b: HotkeyModifier[]): boolean {
  return a.length === b.length && a.every((m) => b.includes(m));
}
