// Réglages of the phone app: the theme (display: kept on this phone), the
// safety copies (date of the last one, « Restaurer une copie » with a
// confirmation) and what the app runs on.
import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Button, Card, Page, errorMessage } from '@hub/sdk/frontend';
import { applyTheme, cachedTheme, THEMES } from '../../../frontend/src/themes';
import { describeCounts, KEEP_COPIES, type BackupCopy } from '../../../packages/phone/backup';
import { dateFr, type Shell } from './App';

const REASONS: Record<BackupCopy['reason'], string> = {
  quotidienne: '',
  'avant-restauration': ' · avant une restauration',
  'avant-migration': ' · avant une mise à jour des données',
};

export function SettingsPage(props: { shell: Shell }) {
  const { shell } = props;
  const [theme, setTheme] = useState(cachedTheme());
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [build, setBuild] = useState<string | null>(null);
  const last = shell.copies[0];

  useEffect(() => {
    CapacitorApp.getInfo().then(
      (info) => setBuild(`${info.version} (versionCode ${info.build})`),
      () => setBuild(null),
    );
  }, []);

  const restore = async (copy: BackupCopy) => {
    const replace = shell.base.rows > 0;
    const question = replace
      ? `Remplacer les données actuelles du téléphone par la copie du ${dateFr(copy.createdAt)} (${describeCounts(copy)}) ?\n\nUne copie des données actuelles est faite avant.`
      : `Restaurer la copie du ${dateFr(copy.createdAt)} (${describeCounts(copy)}) ?`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      await shell.restore(copy);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Page title="Réglages">
      <Card title="Copies de sauvegarde">
        <p>
          Dernière copie :{' '}
          <strong>{last ? dateFr(last.createdAt) : 'aucune pour l’instant'}</strong>
        </p>
        <p className="small muted">
          Une copie par jour, à l’ouverture de l’appli, dans le stockage propre de ToolBox (jamais
          vidé par Android), et une juste avant chaque mise à jour qui modifie la structure des
          données. Les {KEEP_COPIES} plus récentes sont gardées.
        </p>
        {error && <p className="error">{error}</p>}
        {!choosing ? (
          <Button
            variant="secondary"
            disabled={shell.copies.length === 0}
            onClick={() => setChoosing(true)}
          >
            Restaurer une copie
          </Button>
        ) : (
          <ul className="m-list">
            {shell.copies.map((copy) => (
              <li key={copy.file} className="m-list__item">
                <div>
                  <strong>{dateFr(copy.createdAt)}</strong>
                  <div className="small muted">
                    {describeCounts(copy)}
                    {REASONS[copy.reason]} · version {copy.appVersion}
                  </div>
                </div>
                <Button variant="secondary" disabled={busy} onClick={() => void restore(copy)}>
                  Restaurer
                </Button>
              </li>
            ))}
            <li>
              <Button variant="secondary" disabled={busy} onClick={() => setChoosing(false)}>
                Annuler
              </Button>
            </li>
          </ul>
        )}
      </Card>

      <Card title="Thème">
        <div className="m-themes" role="radiogroup" aria-label="Thème">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              className={`m-theme${theme === t.id ? ' m-theme--active' : ''}`}
              onClick={() => {
                applyTheme(t.id);
                setTheme(t.id);
              }}
            >
              <span className="m-theme__swatch" aria-hidden="true">
                {t.swatch.map((c) => (
                  <span key={c} style={{ background: c }} />
                ))}
              </span>
              {t.label}
            </button>
          ))}
        </div>
        <p className="small muted">Le thème reste sur ce téléphone.</p>
      </Card>

      <Card title="À propos">
        <dl className="m-about small">
          <dt>ToolBox</dt>
          <dd>{build ?? __APP_VERSION__}</dd>
          <dt>Base</dt>
          <dd>
            SQLite {shell.base.sqlite} · {shell.base.vfs} (OPFS)
          </dd>
          <dt>Modules</dt>
          <dd>
            {shell.base.modules
              .map((m) => `${m.id} : ${m.status === 'loaded' ? 'chargé' : (m.error ?? m.status)}`)
              .join(' · ')}
          </dd>
        </dl>
      </Card>
    </Page>
  );
}
