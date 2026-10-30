import { useEffect, useState } from 'react';
import { Button, Card, ErrorMessage, errorMessage } from '@hub/sdk/frontend';
import { cachedTheme, THEMES, type ThemeInfo } from '../../themes';
import {
  DEFAULT_PREFS,
  effectiveTheme,
  shortcutOf,
  type ThemePrefs,
} from '../../themes/automation';
import { THEME_PREFS_EVENT } from '../theme-automation';
import { chooseTheme, loadUiPrefs, saveUiPrefs, themePrefs } from '../ui-prefs';

/**
 * A real miniature of a theme: the same tokens as the theme itself
 * (`data-theme-preview`), drawn with its surfaces, relief, buttons, controls
 * and chart series.
 */
function ThemePreview(props: { theme: ThemeInfo }) {
  return (
    <span className="theme-preview" data-theme-preview={props.theme.id} aria-hidden>
      <span className="theme-preview__side">
        <span className="theme-preview__brand" />
        <span className="theme-preview__nav theme-preview__nav--on" />
        <span className="theme-preview__nav" />
        <span className="theme-preview__nav" />
      </span>
      <span className="theme-preview__main">
        <span className="theme-preview__title">Aa</span>
        <span className="theme-preview__card">
          <span className="theme-preview__tabs">
            <span className="theme-preview__tab theme-preview__tab--on" />
            <span className="theme-preview__tab" />
          </span>
          <span className="theme-preview__bars">
            {[62, 88, 45, 74].map((h, i) => (
              <span
                key={i}
                className="theme-preview__bar"
                style={{ height: `${h}%`, background: `var(--series-${i + 1})` }}
              />
            ))}
          </span>
          <span className="theme-preview__row">
            <span className="theme-preview__button" />
            <span className="theme-preview__button theme-preview__button--secondary" />
            <span className="theme-preview__check" />
          </span>
        </span>
      </span>
    </span>
  );
}

/** Réglages › Apparence: theme gallery, « Thème du soir », shortcut to the next theme. */
export function AppearanceCard() {
  const [prefs, setPrefs] = useState<ThemePrefs>({ ...DEFAULT_PREFS, theme: cachedTheme() });
  const [shown, setShown] = useState(cachedTheme());
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    loadUiPrefs()
      .then((p) => {
        const loaded = themePrefs(p);
        setPrefs(loaded);
        setShown(effectiveTheme(loaded, new Date()));
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  const changed = (next: ThemePrefs) => {
    setPrefs(next);
    setShown(effectiveTheme(next, new Date()));
    window.dispatchEvent(new Event(THEME_PREFS_EVENT));
  };
  const save = (change: Partial<ThemePrefs>) => {
    setError(null);
    const next = { ...prefs, ...change };
    saveUiPrefs(change)
      .then(() => changed(next))
      .catch((err: unknown) => setError(errorMessage(err)));
  };
  const pick = (id: string) => {
    setError(null);
    setShown(id);
    chooseTheme(id, prefs)
      .then(() => loadUiPrefs())
      .then((p) => changed(themePrefs(p)))
      .catch((err: unknown) => setError(errorMessage(err)));
  };
  const night = prefs.themeEvening && effectiveTheme(prefs, new Date()) === prefs.themeNight;
  const light = THEMES.filter((t) => t.scheme === 'light');
  const dark = THEMES.filter((t) => t.scheme === 'dark');

  return (
    <Card title="Apparence">
      <p className="muted small">
        Thème de l’interface, appliqué tout de suite et retenu. Il ne change pas les visuels générés
        (vidéos, Reels), qui suivent la direction artistique.
        {night && ' Thème du soir en cours : un clic change le thème du soir.'}
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="theme-grid" role="radiogroup" aria-label="Thème">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={theme.id === shown}
            className={`theme-option${theme.id === shown ? ' theme-option--active' : ''}`}
            onClick={() => pick(theme.id)}
          >
            <ThemePreview theme={theme} />
            <span className="theme-option__name">
              {theme.label}
              {theme.id === shown && <span className="badge badge--accent">Actif</span>}
              {theme.experimental && (
                <span className="badge badge--warning" title="Pas encore validé à l’usage">
                  Expérimental
                </span>
              )}
            </span>
            <span className="faint small">{theme.scheme === 'light' ? 'Clair' : 'Sombre'}</span>
          </button>
        ))}
      </div>

      <h3>
        Thème du soir <span className="badge badge--warning">Expérimental</span>
      </h3>
      <div className="appearance-options">
        <label className="appearance-options__line">
          <input
            type="checkbox"
            checked={prefs.themeEvening}
            onChange={(e) =>
              save({
                themeEvening: e.target.checked,
                themeNight: prefs.themeNight || (dark[0]?.id ?? ''),
              })
            }
          />{' '}
          Un thème le jour, un autre le soir (désactivé par défaut)
        </label>
        {prefs.themeEvening && (
          <div className="appearance-options__line">
            <span className="small">Le jour :</span>
            <select
              className="input"
              value={prefs.theme}
              aria-label="Thème du jour"
              onChange={(e) => save({ theme: e.target.value })}
            >
              {[...light, ...dark].map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="small">le soir :</span>
            <select
              className="input"
              value={prefs.themeNight}
              aria-label="Thème du soir"
              onChange={(e) => save({ themeNight: e.target.value })}
            >
              {[...dark, ...light].map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="small">de</span>
            <input
              className="input input--short"
              type="time"
              value={prefs.themeEveningFrom}
              aria-label="Début du soir"
              onChange={(e) => e.target.value && save({ themeEveningFrom: e.target.value })}
            />
            <span className="small">à</span>
            <input
              className="input input--short"
              type="time"
              value={prefs.themeEveningTo}
              aria-label="Fin du soir (le matin)"
              onChange={(e) => e.target.value && save({ themeEveningTo: e.target.value })}
            />
          </div>
        )}
      </div>

      <h3>
        Raccourci clavier <span className="badge badge--warning">Expérimental</span>
      </h3>
      <div className="appearance-options">
        <div className="appearance-options__line">
          <span className="small">Passer au thème suivant :</span>
          {recording ? (
            <button
              type="button"
              className="button button--secondary button--small appearance-options__record"
              autoFocus
              onBlur={() => setRecording(false)}
              onKeyDown={(e) => {
                e.preventDefault();
                if (e.key === 'Escape') return setRecording(false);
                const key = shortcutOf(e.nativeEvent);
                if (!key) return;
                setRecording(false);
                save({ themeShortcut: key });
              }}
            >
              Appuie sur la touche… (Échap : annuler)
            </button>
          ) : (
            <>
              {prefs.themeShortcut ? (
                <kbd>{prefs.themeShortcut}</kbd>
              ) : (
                <span className="small muted">aucun (désactivé par défaut)</span>
              )}
              <Button small variant="secondary" onClick={() => setRecording(true)}>
                {prefs.themeShortcut ? 'Changer…' : 'Choisir une touche…'}
              </Button>
              {prefs.themeShortcut && (
                <Button small variant="secondary" onClick={() => save({ themeShortcut: '' })}>
                  Désactiver
                </Button>
              )}
            </>
          )}
        </div>
        <p className="small muted">
          Une lettre ou un chiffre avec Ctrl ou Alt (ex. Ctrl+Alt+T), ou une touche F1 à F12 (sauf
          F11, le plein écran). Il marche quand la fenêtre de ToolBox est active.
        </p>
      </div>
    </Card>
  );
}
