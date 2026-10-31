// The floating window takes the keyboard step by step, checking after each
// step (electron/overlay-focus.ts): plain focus, then a simulated Alt on
// Windows only if needed, else « not focused » (the bar asks for a click).
import { describe, expect, it } from 'vitest';
import { takeKeyboard, type FocusWindow } from '../electron/overlay-focus';

function fakeWindow(focusAfter: 'first' | 'alt' | 'never') {
  const calls: string[] = [];
  let altDown = false;
  let focused = false;
  const window: FocusWindow & { calls: string[]; setAlt(v: boolean): void } = {
    calls,
    setAlt: (v) => (altDown = v),
    isDestroyed: () => false,
    setFocusable: (f) => calls.push(`focusable:${f}`),
    moveTop: () => calls.push('moveTop'),
    show: () => calls.push('show'),
    focus: () => {
      calls.push(altDown ? 'focus+alt' : 'focus');
      if (focusAfter === 'first' || (focusAfter === 'alt' && altDown)) focused = true;
    },
    isFocused: () => focused,
    webContents: { focus: () => calls.push('page') },
  };
  return window;
}
const means = (window: ReturnType<typeof fakeWindow>, canTapAlt: boolean) => ({
  canTapAlt,
  tapAlt: (between: () => void) => {
    window.setAlt(true);
    between();
    window.setAlt(false);
  },
  wait: () => Promise.resolve(),
});

describe('floating window keyboard', () => {
  it('plain focus first: no simulated key when it is enough', async () => {
    const w = fakeWindow('first');
    expect(await takeKeyboard(w, means(w, true))).toBe('focused');
    expect(w.calls).toEqual(['focusable:true', 'show', 'moveTop', 'focus', 'page']);
  });
  it('the foreground lock: Alt around a second request', async () => {
    const w = fakeWindow('alt');
    expect(await takeKeyboard(w, means(w, true))).toBe('focused-with-alt');
    expect(w.calls.filter((c) => c.startsWith('focus+'))).toEqual(['focus+alt']);
  });
  it('no simulated key outside Windows; never focused: said, not hidden', async () => {
    const w = fakeWindow('alt');
    expect(await takeKeyboard(w, means(w, false))).toBe('not-focused');
    expect(w.calls).not.toContain('focus+alt');
    const never = fakeWindow('never');
    expect(await takeKeyboard(never, means(never, true))).toBe('not-focused');
  });
});
