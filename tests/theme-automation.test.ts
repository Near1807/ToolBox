// « Thème du soir », the shortcut to the next theme, the previews of the gallery.
import { describe, expect, it } from 'vitest';
import {
  activeSlot,
  DEFAULT_PREFS,
  effectiveTheme,
  isEvening,
  nextTheme,
  shortcutOf,
} from '../frontend/src/themes/automation';
import { withPreview } from '../frontend/src/themes';

const at = (hhmm: string) => new Date(`2026-10-30T${hhmm}:00`);
const prefs = { ...DEFAULT_PREFS, theme: 'lilas', themeNight: 'lilas-nuit' };

describe('thème du soir', () => {
  it('is off by default: always the chosen theme', () => {
    expect(DEFAULT_PREFS.themeEvening).toBe(false);
    expect(DEFAULT_PREFS.themeShortcut).toBe('');
    expect(effectiveTheme(prefs, at('22:00'))).toBe('lilas');
  });
  it('from the evening hour to the morning, over midnight', () => {
    const on = { ...prefs, themeEvening: true };
    expect(effectiveTheme(on, at('19:59'))).toBe('lilas');
    expect(effectiveTheme(on, at('20:00'))).toBe('lilas-nuit');
    expect(effectiveTheme(on, at('03:10'))).toBe('lilas-nuit');
    expect(effectiveTheme(on, at('07:00'))).toBe('lilas');
    expect(activeSlot(on, at('23:00'))).toBe('themeNight');
    expect(activeSlot(on, at('12:00'))).toBe('theme');
    // A period inside the same day, and nonsense hours.
    expect(isEvening({ themeEveningFrom: '18:00', themeEveningTo: '23:00' }, at('22:30'))).toBe(
      true,
    );
    expect(isEvening({ themeEveningFrom: '18:00', themeEveningTo: '23:00' }, at('23:30'))).toBe(
      false,
    );
    expect(isEvening({ themeEveningFrom: '25:00', themeEveningTo: '07:00' }, at('23:30'))).toBe(
      false,
    );
  });
});

describe('raccourci', () => {
  const key = (
    k: string,
    mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {},
  ) =>
    shortcutOf({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  it('needs Ctrl or Alt for a letter, works alone for a function key except F11', () => {
    expect(key('t')).toBeNull();
    expect(key('t', { ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+T');
    expect(key('F9')).toBe('F9');
    expect(key('F11')).toBeNull();
    expect(key('Control', { ctrlKey: true })).toBeNull();
  });
  it('goes through every theme and back to the first', () => {
    expect(nextTheme(['a', 'b', 'c'], 'b')).toBe('c');
    expect(nextTheme(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextTheme(['a', 'b', 'c'], 'inconnu')).toBe('a');
  });
});

describe('galerie', () => {
  it('a theme also applies to its preview', () => {
    expect(withPreview(":root[data-theme='argile'] {")).toBe(
      ":root[data-theme='argile'], [data-theme-preview='argile'][data-theme-preview] {",
    );
  });
});
