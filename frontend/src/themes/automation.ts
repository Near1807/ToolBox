// Theme automation, pure (tested in tests/theme-automation.test.ts): the
// « Thème du soir » (a light theme by day, a dark one from a chosen hour)
// and the optional shortcut to the next theme. Both are off by default.

export interface ThemePrefs {
  /** The theme chosen in the gallery (by day when « Thème du soir » is on). */
  theme: string;
  /** « Thème du soir » on. */
  themeEvening: boolean;
  /** The evening theme. */
  themeNight: string;
  /** « HH:MM »: from when the evening theme applies… */
  themeEveningFrom: string;
  /** …and until when (next morning). */
  themeEveningTo: string;
  /** « Ctrl+Alt+T »; empty: no shortcut. */
  themeShortcut: string;
}

export const DEFAULT_PREFS: Omit<ThemePrefs, 'theme'> = {
  themeEvening: false,
  themeNight: '',
  themeEveningFrom: '20:00',
  themeEveningTo: '07:00',
  themeShortcut: '',
};

const minutes = (hhmm: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Whether `now` is in the evening period (from `from` to `to`, over midnight when `to` < `from`). */
export function isEvening(
  prefs: Pick<ThemePrefs, 'themeEveningFrom' | 'themeEveningTo'>,
  now: Date,
): boolean {
  const from = minutes(prefs.themeEveningFrom);
  const to = minutes(prefs.themeEveningTo);
  if (from === null || to === null || from === to) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return from < to ? t >= from && t < to : t >= from || t < to;
}

/** The theme to show now. */
export function effectiveTheme(prefs: ThemePrefs, now: Date): string {
  if (prefs.themeEvening && prefs.themeNight && isEvening(prefs, now)) return prefs.themeNight;
  return prefs.theme;
}

/** Which preference the shortcut or a gallery click changes now: the evening theme in the evening, else the theme. */
export function activeSlot(prefs: ThemePrefs, now: Date): 'theme' | 'themeNight' {
  return prefs.themeEvening && prefs.themeNight && isEvening(prefs, now) ? 'themeNight' : 'theme';
}

/** The theme after `current` in the list (wraps around). */
export function nextTheme(ids: string[], current: string): string {
  if (!ids.length) return current;
  const i = ids.indexOf(current);
  return ids[(i + 1) % ids.length]!;
}

/** Keys that never make a shortcut on their own (typing, navigation, the app's own F11). */
const RESERVED = new Set(['F11', 'Tab', 'Enter', 'Escape', 'Backspace', ' ']);

/**
 * A key press as a shortcut, « Ctrl+Alt+T », or null when it cannot be one:
 * a letter, digit or symbol needs Ctrl or Alt (so that typing never triggers
 * it); a function key (F1–F12 except F11) works alone.
 */
export function shortcutOf(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  const { key } = event;
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(key) || RESERVED.has(key))
    return null;
  const fn = /^F([1-9]|1[0-2])$/.test(key);
  if (!fn && !event.ctrlKey && !event.altKey) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Maj');
  if (event.metaKey) parts.push('Win');
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}
