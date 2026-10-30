import { api } from '@hub/sdk/frontend';
import { applyTheme, cachedTheme } from '../themes';
import { activeSlot, DEFAULT_PREFS, effectiveTheme, type ThemePrefs } from '../themes/automation';

/** Interface preferences stored by the core (GET/PUT /api/core/ui). */
export interface UiPrefs extends ThemePrefs {
  navigation: string;
}

/** The theme preferences of the core, with their defaults. */
export function themePrefs(prefs: Partial<UiPrefs>): ThemePrefs {
  return {
    ...DEFAULT_PREFS,
    ...Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== null && v !== undefined)),
    theme: prefs.theme || cachedTheme(),
  } as ThemePrefs;
}

export function loadUiPrefs(): Promise<UiPrefs> {
  return api.get<UiPrefs>('/api/core/ui');
}

export function saveUiPrefs(change: Partial<UiPrefs>): Promise<unknown> {
  return api.put('/api/core/ui', change);
}

/** At start: the theme saved by the core wins over the copy cached by the browser. */
export async function syncThemeFromCore(): Promise<void> {
  try {
    const prefs = themePrefs(await loadUiPrefs());
    const now = effectiveTheme(prefs, new Date());
    if (now !== cachedTheme()) applyTheme(now);
  } catch {
    // Backend not ready: the cached theme stays.
  }
}

/**
 * Switches the theme instantly and remembers it: the gallery's theme, or
 * the evening theme while « Thème du soir » is showing it.
 */
export async function chooseTheme(id: string, prefs?: ThemePrefs): Promise<void> {
  applyTheme(id);
  const slot = prefs ? activeSlot(prefs, new Date()) : 'theme';
  await saveUiPrefs({ [slot]: id });
}
