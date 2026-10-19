import { apiFetch } from '../api/client';
import { useApi } from '../api/useApi';

interface SystemInfo {
  appVersion: string;
  dataDir: string;
  sqliteVersion: string;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  runtime: { node: string; electron: string | null; platform: string; arch: string };
}

export function SettingsPage() {
  const { data, error, loading } = useApi<SystemInfo>('/api/core/system');

  return (
    <div className="page">
      <header className="page__header">
        <h1>Réglages</h1>
      </header>

      <section className="card">
        <h2>À propos</h2>
        {loading && <p className="muted">Chargement…</p>}
        {error && <p className="error">Impossible de joindre le backend : {error}</p>}
        {data && (
          <dl className="info-list">
            <dt>Version</dt>
            <dd>ToolBox {data.appVersion}</dd>
            <dt>Dossier de données</dt>
            <dd>
              <code>{data.dataDir}</code>{' '}
              <button
                type="button"
                className="button button--small"
                onClick={() => void apiFetch('/api/core/open-data-dir', { method: 'POST' })}
              >
                Ouvrir
              </button>
            </dd>
            <dt>SQLite</dt>
            <dd>{data.sqliteVersion}</dd>
            <dt>FFmpeg</dt>
            <dd>{data.ffmpegVersion ?? <span className="error">introuvable</span>}</dd>
            <dt>FFprobe</dt>
            <dd>{data.ffprobeVersion ?? <span className="error">introuvable</span>}</dd>
            <dt>Environnement</dt>
            <dd>
              Electron {data.runtime.electron ?? '—'} · Node {data.runtime.node} ·{' '}
              {data.runtime.platform}/{data.runtime.arch}
            </dd>
          </dl>
        )}
      </section>
    </div>
  );
}
