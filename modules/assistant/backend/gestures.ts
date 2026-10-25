// Gestures of the assistant's keys: the microphone key (held = talk while
// held, quick tap = tap again to finish) and the key of the written command
// bar (single or double press). When both are the same key, the gestures are
// told apart here: held → microphone; double press → bar (the recording
// started by the first press is cancelled); single press with the bar in
// « Appui simple » → bar (the microphone then only works held). Pure: the
// clock and the timers are given, tested in tests/gestures.test.ts.

export type BarMode = 'single' | 'double';

export interface GestureActions {
  /** Starts recording (key down). */
  micStart(): void;
  /** Stops and sends the recording (key released after holding, or tapped again). */
  micStop(): void;
  /** A quick tap: keep recording until the next press. */
  micToggle(): void;
  /** Throws the recording away (the press was for the bar). */
  micCancel(): void;
  /** Whether the microphone records now (toggle mode included). */
  listening(): boolean;
  openBar(): void;
}

export interface GestureOptions {
  /** A press at least this long is « held » (ms). */
  holdMs: number;
  /** Two presses closer than this make a double press (ms). */
  doubleMs: number;
  barMode: BarMode;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

export type KeyRole = 'mic' | 'bar' | 'both';

/**
 * The bar and the microphone on the same key: how the gestures are told apart
 * (`warning` when it is not reliable, said in the settings).
 */
export function conflictOf(
  sameKey: boolean,
  barMode: BarMode,
): { warning: boolean; text: string } | null {
  if (!sameKey) return null;
  if (barMode === 'double')
    return {
      warning: false,
      text: 'Même touche que le micro : maintenir = micro, appui court = micro jusqu’au prochain appui, double appui = barre écrite (l’enregistrement commencé au premier appui est jeté).',
    };
  return {
    warning: true,
    text: 'Même touche que le micro en « Appui simple » : un appui court ouvre la barre, le micro ne marche plus qu’en maintenant la touche (les touches qui envoient leur relâchement tout de suite, comme la touche Copilot, ne peuvent plus lancer le micro). Recommandé : « Double appui », ou une autre touche.',
  };
}

/** The state machine of one physical key. */
export class KeyGestures {
  private pressedAt = 0;
  /** The previous short press, waiting for a second one (double press). */
  private lastTapAt: number | null = null;
  private pending: unknown = null;
  /** This press started the microphone (provisionally when the key is shared). */
  private startedMic = false;

  constructor(
    private readonly role: KeyRole,
    private readonly actions: GestureActions,
    private readonly options: GestureOptions,
  ) {}

  press(): void {
    const now = this.options.now();
    this.pressedAt = now;
    const { barMode, doubleMs } = this.options;
    if (this.role === 'bar') {
      if (barMode === 'single') return this.actions.openBar();
      if (this.lastTapAt !== null && now - this.lastTapAt <= doubleMs) {
        this.lastTapAt = null;
        return this.actions.openBar();
      }
      this.lastTapAt = now;
      return;
    }
    if (this.role === 'both' && barMode === 'double' && this.lastTapAt !== null) {
      if (now - this.lastTapAt <= doubleMs) {
        // Second press: it was for the bar.
        this.lastTapAt = null;
        this.clearPending();
        this.actions.micCancel();
        this.startedMic = false;
        return this.actions.openBar();
      }
      this.lastTapAt = null;
    }
    // Microphone: a press while it records (toggle mode) finishes.
    if (this.actions.listening()) {
      this.clearPending();
      this.startedMic = false;
      return this.actions.micStop();
    }
    this.startedMic = true;
    this.actions.micStart();
  }

  release(): void {
    if (this.role === 'bar' || !this.startedMic) return;
    const held = this.options.now() - this.pressedAt >= this.options.holdMs;
    if (held) {
      this.startedMic = false;
      return this.actions.micStop();
    }
    if (this.role === 'both' && this.options.barMode === 'single') {
      // A short press is the bar's.
      this.startedMic = false;
      this.actions.micCancel();
      return this.actions.openBar();
    }
    // Quick tap: toggle mode (tap again to finish). With a shared key in
    // « Double appui », a second press may still come and make it the bar's.
    this.actions.micToggle();
    if (this.role === 'both') {
      this.lastTapAt = this.pressedAt;
      this.clearPending();
      this.pending = this.options.setTimer(() => {
        this.pending = null;
        this.lastTapAt = null;
      }, this.options.doubleMs);
    }
  }

  private clearPending(): void {
    if (this.pending !== null) this.options.clearTimer(this.pending);
    this.pending = null;
  }

  dispose(): void {
    this.clearPending();
  }
}
