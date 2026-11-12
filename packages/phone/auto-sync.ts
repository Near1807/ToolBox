// The automatic synchronisation of the phone (ADR 0044, v0.33.0). OFF by
// default: Thomas turns it on (Réglages › Synchro avec le PC). When on, and
// only while the app is on screen:
// - a synchronisation at opening and when the app comes back to the screen;
// - one shortly after his changes (grouped: 3 s after the last one);
// - a live channel to the PC (WebSocket, pinned certificate, device token):
//   the PC says « changed », the phone synchronises (about a second).
// Never in the background (closed: nothing; caught up at opening). Never the
// first synchronisation (always its preview and Thomas's choice). Versions
// different, unknown device, first synchronisation to do: it stops and says
// why, as the manual one does. Discreet: a state (à jour / en cours / PC
// introuvable…), no message for each success; conflicts stay signalled.
// Portable: no Node import, no Capacitor import (the channel is given).
import { SyncFailure } from './sync-client';

export type LiveConnect = (
  target: { url: string; pin: string; token: string },
  handlers: { onOpen(): void; onChanged(): void; onClosed(code: number): void },
) => () => void;

export type AutoState =
  'off' | 'idle' | 'syncing' | 'ok' | 'offline' | 'version' | 'first' | 'auth' | 'error';

export interface AutoStatus {
  enabled: boolean;
  state: AutoState;
  /** Last synchronisation that worked (ISO), this session of the app. */
  at: string | null;
  /** What to tell Thomas (failures), or null. */
  message: string | null;
  /** Conflicts added by the last synchronisation. */
  conflicts: number;
  /** The live channel is open. */
  live: boolean;
}

export interface AutoResult {
  received: number;
  sent: number;
  conflicts: number;
  /** The modules whose data changed here (to refresh the screens). */
  scopes: string[];
}

export interface AutoDeps {
  /** One synchronisation (the manual one's code); throws a SyncFailure. */
  run(): Promise<AutoResult>;
  /** Where the live channel goes (the PC's current address, its pin, the token). */
  target(): Promise<{ url: string; pin: string; token: string } | null>;
  /** The live channel (null: none, the triggers still work). */
  connect: LiveConnect | null;
  onSynced(result: AutoResult): void;
  onStatus(status: AutoStatus): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

/** Changes grouped: one synchronisation 3 s after the last one. */
export const CHANGE_DELAY = 3000;
/** A « changed » of the PC: almost at once (a few grouped). */
export const PUSH_DELAY = 200;
/** The live channel closed: tried again after 5 s, then 15 s, then every 30 s. */
export const RECONNECT = [5000, 15000, 30000];

/** States that stop the automatic synchronisation until Thomas acts. */
const STOPS: AutoState[] = ['version', 'first', 'auth'];

export class AutoSync {
  private enabled = false;
  private visible = true;
  private running = false;
  private again = false;
  private status: AutoStatus = {
    enabled: false,
    state: 'off',
    at: null,
    message: null,
    conflicts: 0,
    live: false,
  };
  private closeLive: (() => void) | null = null;
  private changeTimer: unknown = null;
  private pushTimer: unknown = null;
  private retryTimer: unknown = null;
  private retries = 0;
  private readonly set: (fn: () => void, ms: number) => unknown;
  private readonly clear: (handle: unknown) => void;

  constructor(private readonly deps: AutoDeps) {
    this.set = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clear = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get current(): AutoStatus {
    return this.status;
  }

  private update(patch: Partial<AutoStatus>) {
    this.status = { ...this.status, ...patch, enabled: this.enabled };
    this.deps.onStatus(this.status);
  }

  private get stopped(): boolean {
    return STOPS.includes(this.status.state);
  }

  private get active(): boolean {
    return this.enabled && this.visible && !this.stopped;
  }

  /** The setting (off by default). On: a synchronisation now, then the triggers. */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.halt();
      this.update({ state: 'off', message: null, live: false });
      return;
    }
    this.update({ state: 'idle', message: null });
    this.trigger();
  }

  /** The app comes to the screen (a synchronisation) or leaves it (everything closed). */
  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      this.halt();
      this.update({ live: false });
    } else this.trigger();
  }

  /** A change made here (an API call that writes): grouped, then synchronised. */
  localChange() {
    if (!this.active) return;
    if (this.changeTimer) this.clear(this.changeTimer);
    this.changeTimer = this.set(() => {
      this.changeTimer = null;
      this.trigger();
    }, CHANGE_DELAY);
  }

  /** A manual synchronisation succeeded: a stop (versions, first sync) is lifted. */
  resumeAfterManual() {
    if (!this.enabled) return;
    if (this.stopped) this.update({ state: 'idle', message: null });
    this.trigger();
  }

  private halt() {
    for (const t of [this.changeTimer, this.pushTimer, this.retryTimer]) if (t) this.clear(t);
    this.changeTimer = this.pushTimer = this.retryTimer = null;
    this.closeLive?.();
    this.closeLive = null;
  }

  /** One synchronisation now (or right after the one in progress). */
  trigger() {
    if (!this.active) return;
    if (this.running) {
      this.again = true;
      return;
    }
    void this.runOnce();
  }

  private async runOnce() {
    this.running = true;
    this.update({ state: 'syncing' });
    try {
      const result = await this.deps.run();
      this.retries = 0;
      this.update({
        state: 'ok',
        at: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
        message: null,
        conflicts: result.conflicts,
      });
      this.deps.onSynced(result);
      await this.openLive();
    } catch (error) {
      const kind = error instanceof SyncFailure ? error.kind : 'other';
      const message = error instanceof Error ? error.message : String(error);
      const state: AutoState =
        kind === 'offline' || kind === 'pin'
          ? 'offline'
          : kind === 'version'
            ? 'version'
            : kind === 'first'
              ? 'first'
              : kind === 'auth'
                ? 'auth'
                : 'error';
      this.update({ state, message });
      if (this.stopped) this.halt();
      else if (state === 'offline') this.scheduleRetry();
    } finally {
      this.running = false;
    }
    if (this.again) {
      this.again = false;
      this.trigger();
    }
  }

  private async openLive() {
    if (!this.active || this.closeLive || !this.deps.connect) return;
    const target = await this.deps.target().catch(() => null);
    if (!target || !this.active || this.closeLive) return;
    this.closeLive = this.deps.connect(target, {
      onOpen: () => {
        this.retries = 0;
        this.update({ live: true });
      },
      onChanged: () => {
        if (this.pushTimer) return;
        this.pushTimer = this.set(() => {
          this.pushTimer = null;
          this.trigger();
        }, PUSH_DELAY);
      },
      onClosed: (code) => {
        this.closeLive = null;
        this.update({ live: false });
        if (code === 401 || code === 4401) {
          this.update({
            state: 'auth',
            message: 'Ce téléphone n’est plus reconnu par le PC : appaire-le de nouveau.',
          });
          this.halt();
          return;
        }
        this.scheduleRetry();
      },
    });
  }

  /** PC not found or channel closed: tried again later, while on screen. */
  private scheduleRetry() {
    if (!this.active || this.retryTimer) return;
    const wait = RECONNECT[Math.min(this.retries, RECONNECT.length - 1)]!;
    this.retries++;
    this.retryTimer = this.set(() => {
      this.retryTimer = null;
      this.trigger();
    }, wait);
  }
}
