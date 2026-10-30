// The floating window takes the keyboard (written command bar), even while
// another application is in front. Windows refuses SetForegroundWindow to a
// process that did not receive the last input (the « foreground lock »); a
// global hook (uiohook) does not count. So, step by step, checking after each
// step whether the window really has the keyboard:
// 1. focusable, on top of everything (moveTop), shown, focused, its page focused;
// 2. still not: a simulated Alt press around the focus request (the documented
//    way for a process to be allowed to take the foreground: it then generated
//    the last input), Windows only, only if step 1 failed;
// 3. still not: `false`. The page shows it (the field asks for a click), the
//    keys never go silently to the wrong place. ADR 0039, docs/WINDOWS.md.
// Pure of Electron (tested in tests/overlay-focus.test.ts with a fake window).

export interface FocusWindow {
  isDestroyed(): boolean;
  setFocusable(focusable: boolean): void;
  moveTop(): void;
  show(): void;
  focus(): void;
  isFocused(): boolean;
  webContents: { focus(): void };
}

export interface FocusMeans {
  /** Whether simulated keys may be used (Windows, keyboard hook loaded). */
  canTapAlt: boolean;
  /** Presses Alt, runs `between`, releases Alt. */
  tapAlt(between: () => void): void;
  wait(ms: number): Promise<void>;
}

/** Time the system takes to give the keyboard, before checking. */
export const FOCUS_CHECK_MS = 120;

export type FocusOutcome = 'focused' | 'focused-with-alt' | 'not-focused';

export async function takeKeyboard(window: FocusWindow, means: FocusMeans): Promise<FocusOutcome> {
  const request = () => {
    window.moveTop();
    window.focus();
    window.webContents.focus();
  };
  window.setFocusable(true);
  window.show();
  request();
  await means.wait(FOCUS_CHECK_MS);
  if (window.isDestroyed()) return 'not-focused';
  if (window.isFocused()) return 'focused';
  if (means.canTapAlt) {
    means.tapAlt(request);
    await means.wait(FOCUS_CHECK_MS);
    if (window.isDestroyed()) return 'not-focused';
    if (window.isFocused()) return 'focused-with-alt';
  }
  return 'not-focused';
}
