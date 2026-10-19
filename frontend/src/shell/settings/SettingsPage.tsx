import { useState } from 'react';
import { api, Button, Card, ErrorMessage, errorMessage, Page, useApi } from '@hub/sdk/frontend';
import type { SystemInfo } from '../../../../backend/routes/core';
import { useModules } from '../../modules/ModulesContext';
import { formatDateTime, formatSize } from '../format';
import { SettingsForm, type SettingsSectionData } from './SettingsForm';

const STATUS_LABELS = {
  loaded: 'Actif',
  failed: 'En erreur',
  'missing-dependencies': 'Dépendance manquante',
  disabled: 'Désactivé',
};

function ModulesCard() {
  const { modules, reload } = useModules();
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (id: string, enabled: boolean) => {
    try {
      await api.put(`/api/core/modules/${id}/enabled`, { enabled });
      setRestartNeeded(true);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card
      title="Modules"
      actions={
        restartNeeded && (
          <Button onClick={() => void api.post('/api/core/restart')}>
            Redémarrer pour appliquer
          </Button>
        )
      }
    >
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {modules.length === 0 && <p className="muted">Aucun module installé.</p>}
      <ul className="list">
        {modules.map((module) => (
          <li key={module.id} className="list__item list__item--top">
            <div>
              <div>
                {module.manifest.icon} <strong>{module.manifest.name}</strong>{' '}
                <span className="muted">
                  v{module.manifest.version} · {module.manifest.section}
                </span>{' '}
                <span className={`badge badge--${module.status}`}>
                  {STATUS_LABELS[module.status]}
                </span>
              </div>
              {module.error && <p className="error small">{module.error}</p>}
            </div>
            {module.disabled ? (
              <Button variant="secondary" small onClick={() => void toggle(module.id, true)}>
                Réactiver
              </Button>
            ) : (
              <Button variant="secondary" small onClick={() => void toggle(module.id, false)}>
                Désactiver
              </Button>
            )}
          </li>
        ))}
      </ul>
      {restartNeeded && (
        <p className="muted small">
          Les changements prennent effet au prochain démarrage de l’app.
        </p>
      )}
    </Card>
  );
}

interface BackupsInfo {
  folder: string;
  automatic: { name: string; size: number; createdAt: string }[];
}

function BackupsCard() {
  const backups = useApi<BackupsInfo>('/api/core/backups');
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const exportBackup = async () => {
    setExporting(true);
    setResult(null);
    try {
      const response = await api.post<{
        cancelled: boolean;
        file?: string;
        size?: number;
        fileCount?: number;
      }>('/api/core/backups/export');
      if (!response.cancelled) {
        setResult({
          ok: true,
          message: `Sauvegarde créée : ${response.file} (${formatSize(response.size ?? 0)}, ${response.fileCount} fichier(s))`,
        });
      }
    } catch (error) {
      setResult({ ok: false, message: errorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card
      title="Sauvegardes"
      actions={
        <Button onClick={() => void exportBackup()} disabled={exporting}>
          {exporting ? 'Export en cours…' : 'Exporter une sauvegarde'}
        </Button>
      }
    >
      <p className="muted">
        L’export crée un fichier .zip contenant la base de données et les fichiers des outils
        (morceaux, covers…). Les vidéos générées n’y sont pas : elles sont déjà dans ton dossier de
        sortie.
      </p>
      {result && <p className={result.ok ? 'success' : 'error'}>{result.message}</p>}
      <h3>Sauvegardes automatiques</h3>
      <p className="muted">
        Avant chaque mise à jour de la base, une copie est faite automatiquement (10 dernières
        conservées).
      </p>
      {backups.data?.automatic.length === 0 && <p className="muted">Aucune pour l’instant.</p>}
      <ul className="list">
        {backups.data?.automatic.map((backup) => (
          <li key={backup.name} className="list__item">
            <span>{formatDateTime(backup.createdAt)}</span>
            <span className="muted">
              {backup.name} · {formatSize(backup.size)}
            </span>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        small
        onClick={() => void api.post('/api/core/backups/open-folder')}
      >
        Ouvrir le dossier des sauvegardes
      </Button>
    </Card>
  );
}

function AboutCard() {
  const { data, error } = useApi<SystemInfo>('/api/core/system');
  return (
    <Card title="À propos">
      {error && <ErrorMessage>Impossible de joindre le backend : {error}</ErrorMessage>}
      {data && (
        <dl className="info-list">
          <dt>Version</dt>
          <dd>ToolBox {data.appVersion}</dd>
          <dt>Dossier de données</dt>
          <dd>
            <code>{data.dataDir}</code>{' '}
            <Button
              variant="secondary"
              small
              onClick={() => void api.post('/api/core/open-data-dir')}
            >
              Ouvrir
            </Button>
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
    </Card>
  );
}

export function SettingsPage() {
  const settings = useApi<SettingsSectionData[]>('/api/core/settings');
  const general = settings.data?.find((s) => s.scope === 'core');
  const moduleSections =
    settings.data?.filter((s) => s.scope !== 'core' && s.fields.length > 0) ?? [];

  return (
    <Page title="Réglages">
      {settings.error && <ErrorMessage>{settings.error}</ErrorMessage>}
      {general && (
        <Card title="Général">
          <SettingsForm section={general} onSaved={settings.reload} />
        </Card>
      )}
      <ModulesCard />
      {moduleSections.map((section) => (
        <Card key={section.scope} title={section.title}>
          <SettingsForm section={section} onSaved={settings.reload} />
        </Card>
      ))}
      <BackupsCard />
      <AboutCard />
    </Page>
  );
}
