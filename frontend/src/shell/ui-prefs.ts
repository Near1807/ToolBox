import { api } from '@hub/sdk/frontend';
import { applyTheme, cachedTheme } from '../themes';

/** Interface preferences stored by the core (GET/PUT /api/core/ui). */
export interface UiPrefs {
  theme: string;
  navigation: string;
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
    const prefs = await loadUiPrefs();
    if (prefs.theme && prefs.theme !== cachedTheme()) applyTheme(prefs.theme);
  } catch {
    // Backend not ready: the cached theme stays.
  }
}

/** Switches the theme instantly and remembers it. */
export async function chooseTheme(id: string): Promise<void> {
  applyTheme(id);
  await saveUiPrefs({ theme: id });
}
