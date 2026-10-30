import { useEffect } from 'react';
import { applyTheme, THEMES } from '../themes';
import { effectiveTheme, nextTheme, shortcutOf, type ThemePrefs } from '../themes/automation';
import { chooseTheme, loadUiPrefs, themePrefs } from './ui-prefs';

/** Sent by Réglages › Apparence after a change of the theme preferences. */
export const THEME_PREFS_EVENT = 'toolbox:theme-prefs';

/**
 * Main window: « Thème du soir » (checked every 30 s) and the shortcut to
 * the next theme, both only when Thomas turned them on (off by default).
 */
export function useThemeAutomation(): void {
  useEffect(() => {
    let prefs: ThemePrefs | null = null;
    const check = () => {
      if (!prefs) return;
      const wanted = effectiveTheme(prefs, new Date());
      if (wanted && wanted !== document.documentElement.dataset.theme) applyTheme(wanted);
    };
    const load = () =>
      loadUiPrefs()
        .then((p) => {
          prefs = themePrefs(p);
          check();
        })
        .catch(() => {
          // Backend not ready: tried again with the next change.
        });
    void load();
    const timer = setInterval(check, 30_000);
    const onKey = (event: KeyboardEvent) => {
      if (!prefs?.themeShortcut || event.defaultPrevented || event.repeat) return;
      if (shortcutOf(event) !== prefs.themeShortcut) return;
      event.preventDefault();
      const current = document.documentElement.dataset.theme ?? prefs.theme;
      const next = nextTheme(
        THEMES.map((t) => t.id),
        current,
      );
      void chooseTheme(next, prefs).then(load);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(THEME_PREFS_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(THEME_PREFS_EVENT, load);
    };
  }, []);
}
