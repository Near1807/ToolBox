import { useState } from 'react';
import { api, Button, Card, ErrorMessage, errorMessage, Page, useApi } from '@hub/sdk/frontend';
import type { SystemInfo } from '../../../../backend/routes/core';
import { useModules } from '../../modules/ModulesContext';
import { formatDateTime, formatSize } from '../format';
import { AppearanceCard } from './AppearanceCard';
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

type BackupKind = 'migration' | 'module';

interface BackupsInfo {
  folder: string;
  kept: Record<BackupKind, number>;
  automatic: { name: string; kind: BackupKind; size: number; createdAt: string }[];
}

const BACKUP_GROUPS: { kind: BackupKind; title: string; text: (kept: number) => string }[] = [
  {
    kind: 'migration',
    title: 'Avant les mises à jour de la base',
    text: (kept) =>
      `Avant chaque mise à jour de la base, une copie est faite automatiquement (${kept} dernières conservées).`,
  },
  {
    kind: 'module',
    title: 'Avant les suppressions',
    text: (kept) =>
      `Avant certaines suppressions (par exemple des imports des Stats YouTube), une copie est faite automatiquement (${kept} dernières conservées, comptées à part : elles ne remplacent jamais celles d’avant mise à jour).`,
  },
];

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
        sortie. Les moteurs et modèles téléchargés (reconnaissance vocale, voix, modèle des
        commandes…) n’y sont pas non plus : ils se retéléchargent d’un clic depuis leur outil.
      </p>
      {result && <p className={result.ok ? 'success' : 'error'}>{result.message}</p>}
      <h3>Sauvegardes automatiques</h3>
      {BACKUP_GROUPS.map((group) => {
        const list = backups.data?.automatic.filter((b) => b.kind === group.kind) ?? [];
        return (
          <section key={group.kind}>
            <h4>{group.title}</h4>
            <p className="muted">{group.text(backups.data?.kept[group.kind] ?? 10)}</p>
            {backups.data && list.length === 0 && <p className="muted">Aucune pour l’instant.</p>}
            <ul className="list">
              {list.map((backup) => (
                <li key={backup.name} className="list__item">
                  <span>{formatDateTime(backup.createdAt)}</span>
                  <span className="muted">
                    {backup.name} · {formatSize(backup.size)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
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

interface AccountInfo {
  provider: string;
  label: string;
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  scopes: string[];
  connectedAt: string | null;
  error: string | null;
  connecting: boolean;
}

/** OAuth client (ID, secret) of each provider, and the state of the connected accounts. */
function AccountsCard(props: { section?: SettingsSectionData; onSaved: () => void }) {
  const accounts = useApi<AccountInfo[]>('/api/core/accounts');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (provider: string, action: 'reconnect' | 'disconnect') => {
    if (
      action === 'disconnect' &&
      !window.confirm(
        'Déconnecter ce compte ? ToolBox perd l’accès (envois et programmations en attente compris) jusqu’à la prochaine connexion.',
      )
    ) {
      return;
    }
    setBusy(provider);
    setError(null);
    try {
      if (action === 'reconnect') await api.post(`/api/core/accounts/${provider}/reconnect`);
      else await api.delete(`/api/core/accounts/${provider}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      accounts.reload();
    }
  };

  return (
    <Card title="Comptes connectés">
      <p className="muted">
        Les outils qui publient pour toi (Planning de sortie…) utilisent ces comptes. Les
        autorisations sont enregistrées chiffrées sur ce PC ; l’ID client vient de ton propre projet
        Google Cloud (voir l’aide du Planning de sortie).
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <ul className="list">
        {accounts.data?.map((account) => (
          <li key={account.provider} className="list__item list__item--top">
            <div>
              <strong>{account.label}</strong>{' '}
              {account.connected ? (
                account.needsReconnect ? (
                  <span className="badge badge--failed">À reconnecter</span>
                ) : (
                  <span className="badge badge--loaded">Connecté</span>
                )
              ) : (
                <span className="badge">
                  {account.configured ? 'Non connecté' : 'Non configuré'}
                </span>
              )}
              {account.connectedAt && (
                <span className="muted small">
                  {' '}
                  depuis le {formatDateTime(account.connectedAt)}
                </span>
              )}
              {account.error && <p className="error small">{account.error}</p>}
              {account.scopes.length > 0 && (
                <p className="muted small">Autorisations : {account.scopes.join(', ')}</p>
              )}
            </div>
            {account.connected && (
              <span className="inline-form">
                {account.needsReconnect && (
                  <Button
                    small
                    disabled={busy === account.provider}
                    onClick={() => void act(account.provider, 'reconnect')}
                  >
                    {busy === account.provider ? 'Dans le navigateur…' : 'Reconnecter'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  small
                  disabled={busy === account.provider}
                  onClick={() => void act(account.provider, 'disconnect')}
                >
                  Déconnecter
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {props.section && <SettingsForm section={props.section} onSaved={props.onSaved} />}
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
  const accountSection = settings.data?.find((s) => s.scope === 'accounts');
  const moduleSections =
    settings.data?.filter(
      (s) => s.scope !== 'core' && s.scope !== 'accounts' && s.fields.length > 0,
    ) ?? [];

  return (
    <Page title="Réglages">
      {settings.error && <ErrorMessage>{settings.error}</ErrorMessage>}
      {general && (
        <Card title="Général">
          <SettingsForm section={general} onSaved={settings.reload} />
        </Card>
      )}
      <AppearanceCard />
      <ModulesCard />
      <AccountsCard section={accountSection} onSaved={settings.reload} />
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
