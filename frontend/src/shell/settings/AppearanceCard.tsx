import { useState } from 'react';
import { Card, ErrorMessage, errorMessage } from '@hub/sdk/frontend';
import { cachedTheme, THEMES } from '../../themes';
import { chooseTheme } from '../ui-prefs';

/** Réglages › Apparence: theme picker, applied instantly and remembered. */
export function AppearanceCard() {
  const [current, setCurrent] = useState(cachedTheme());
  const [error, setError] = useState<string | null>(null);

  const pick = (id: string) => {
    setCurrent(id);
    setError(null);
    chooseTheme(id).catch((err: unknown) => setError(errorMessage(err)));
  };

  return (
    <Card title="Apparence">
      <p className="muted small">
        Thème de l’interface, appliqué tout de suite et retenu. Il ne change pas les visuels générés
        (vidéos, Reels), qui suivent la direction artistique.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="theme-grid" role="radiogroup" aria-label="Thème">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={theme.id === current}
            className={`theme-option${theme.id === current ? ' theme-option--active' : ''}`}
            onClick={() => pick(theme.id)}
          >
            <span className="theme-option__swatch" aria-hidden>
              {theme.swatch.map((color) => (
                <span key={color} style={{ background: color }} />
              ))}
            </span>
            <span>{theme.label}</span>
            <span className="faint small">{theme.scheme === 'light' ? 'Clair' : 'Sombre'}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
