// Interface themes: every file of this folder is a theme (tokens only, see
// docs/THEMES.md). Adding a theme = adding a .css file with an @theme header.
const files = import.meta.glob('./*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface ThemeInfo {
  id: string;
  label: string;
  scheme: 'dark' | 'light';
  /** Colours shown in the theme picker: background, accent, second accent. */
  swatch: string[];
}

export const DEFAULT_THEME = 'nebula';

function parseHeader(css: string): ThemeInfo | null {
  const match = /@theme\s+([^*]+)\*\//.exec(css);
  if (!match) return null;
  const fields = Object.fromEntries(
    match[1]!
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2)
      .map(([key, value]) => [key!.trim(), value!.trim()]),
  );
  if (!fields.id || !fields.label) return null;
  return {
    id: fields.id,
    label: fields.label,
    scheme: fields.scheme === 'light' ? 'light' : 'dark',
    swatch: (fields.swatch ?? '').split(',').filter(Boolean),
  };
}

export const THEMES: ThemeInfo[] = Object.values(files)
  .map(parseHeader)
  .filter((theme): theme is ThemeInfo => theme !== null)
  .sort((a, b) =>
    a.id === DEFAULT_THEME ? -1 : b.id === DEFAULT_THEME ? 1 : a.label.localeCompare(b.label),
  );

/**
 * A theme's CSS, also applied to a preview inside the page (the gallery of
 * Réglages › Apparence): `[data-theme-preview='<id>']` gets the same tokens.
 */
export function withPreview(css: string): string {
  return css.replace(
    /:root\[data-theme='([a-z0-9-]+)'\]/g,
    ":root[data-theme='$1'], [data-theme-preview='$1'][data-theme-preview]",
  );
}

/** Injects every theme once (each one is scoped by :root[data-theme=…]). */
export function installThemes(): void {
  if (document.getElementById('toolbox-themes')) return;
  const style = document.createElement('style');
  style.id = 'toolbox-themes';
  style.textContent = Object.values(files).map(withPreview).join('\n');
  document.head.prepend(style);
}

const STORAGE_KEY = 'toolbox.theme';

/** Applies a theme now (the saved choice comes from the core settings, see useTheme). */
export function applyTheme(id: string): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME);
  if (!theme) return;
  document.documentElement.dataset.theme = theme.id;
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // Storage unavailable: the theme still applies, the core setting remembers it.
  }
  window.toolbox?.window?.setColorScheme?.(theme.scheme);
}

/** Another window (the floating one) changed the theme: this one follows. */
export function followThemeOfOtherWindows(): void {
  window.addEventListener('storage', (event) => {
    if (
      event.key === STORAGE_KEY &&
      event.newValue &&
      event.newValue !== document.documentElement.dataset.theme
    )
      applyTheme(event.newValue);
  });
}

/** Last theme used on this PC, applied before the first render (no flash). */
export function cachedTheme(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
