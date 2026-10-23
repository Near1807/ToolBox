import type { HotkeySpec, ModuleHotkeys, ModuleLogger } from '../../packages/sdk/backend';
import type { HostAdapter, HostKeyEvent } from './host';

// System-wide keys (push-to-talk). The keyboard hook only runs while a module
// listens or captures a key: nothing is watched otherwise. Only the bound key
// codes are looked at; keystrokes are never stored or logged.

interface Binding {
  code: number;
  onPress: () => void;
  onRelease: () => void;
}

export class HotkeyManager {
  private readonly bindings = new Map<string, Binding>();
  private readonly captures: ((key: HotkeySpec) => void)[] = [];
  private readonly pressed = new Set<number>();
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
      this.pressed.add(event.code);
      const capture = this.captures.shift();
      if (capture) {
        capture({ code: event.code, label: this.host.globalKeys!.label(event.code) });
        this.update();
        return;
      }
      for (const binding of this.bindings.values()) {
        if (binding.code === event.code) this.safely(binding.onPress);
      }
    } else {
      if (!this.pressed.delete(event.code)) return;
      for (const binding of this.bindings.values()) {
        if (binding.code === event.code) this.safely(binding.onRelease);
      }
    }
  };

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
    onDispose(() => {
      this.bindings.delete(moduleId);
      this.update();
    });
    return {
      status: () => this.status(),
      hold: (key, handlers) => {
        guard();
        if (key) this.bindings.set(moduleId, { code: key.code, ...handlers });
        else this.bindings.delete(moduleId);
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
