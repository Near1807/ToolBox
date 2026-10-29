import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  api,
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  Page,
  useApi,
  type FloatingPosition,
} from '@hub/sdk/frontend';
import type { SystemInfo } from '../../../../backend/routes/core';
import { useModules } from '../../modules/ModulesContext';
import { formatDateTime, formatSize } from '../format';
import { useNavigation } from '../NavigationContext';
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

/** Settings > Général > Fenêtre flottante: where it goes, and the lock (desktop app only). */
function FloatingCard() {
  const bridge = window.toolbox?.overlay;
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  useEffect(() => {
    void bridge?.position().then(setPosition);
  }, [bridge]);
  const change = (next: Partial<FloatingPosition>) => {
    if (!bridge || !position) return;
    void bridge.position({ ...position, ...next }).then(setPosition);
  };
  return (
    <Card title="Fenêtre flottante">
      <p className="muted">
        Mini-timer, questions, barre écrite et indicateur du micro s’affichent dans une petite
        fenêtre toujours au premier plan. Fais-la glisser par sa poignée ⠿, ou choisis sa place ici.{' '}
        <span className="badge badge--warning">Expérimental</span>
      </p>
      {!bridge ? (
        <p className="muted small">Disponible seulement dans l’app de bureau.</p>
      ) : (
        position && (
          <div className="settings-form">
            <div className="settings-form__field" id="setting-floating-anchor">
              <label htmlFor="floating-anchor">Position</label>
              <select
                id="floating-anchor"
                className="input"
                value={position.anchor}
                onChange={(e) => change({ anchor: e.target.value as FloatingPosition['anchor'] })}
              >
                {POSITIONS.map(([value, label]) => (
                  <option key={value} value={value} disabled={value === 'custom'}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="muted settings-form__help">
                Après un glisser, « Là où je l’ai posée » est retenu. Si la résolution change, la
                fenêtre revient dans l’écran.
              </p>
            </div>
            <div className="settings-form__field" id="setting-floating-locked">
              <label>
                <input
                  type="checkbox"
                  checked={position.locked}
                  onChange={(e) => change({ locked: e.target.checked })}
                />{' '}
                Verrouiller la position (cache la poignée)
              </label>
            </div>
          </div>
        )
      )}
    </Card>
  );
}

const POSITIONS: [FloatingPosition['anchor'], string][] = [
  ['bottom-center', 'En bas au centre'],
  ['top-center', 'En haut au centre'],
  ['top-left', 'En haut à gauche'],
  ['top-right', 'En haut à droite'],
  ['bottom-left', 'En bas à gauche'],
  ['bottom-right', 'En bas à droite'],
  ['custom', 'Là où je l’ai posée'],
];

interface RightInfo {
  id: string;
  label: string;
  moduleName: string;
  granted: boolean;
}

/** Settings > Général > Droits de l'assistant (the same switches as on the assistant's page). */
function RightsCard() {
  const rights = useApi<RightInfo[]>('/api/core/assistant/rights');
  const [error, setError] = useState<string | null>(null);
  const set = async (id: string, granted: boolean) => {
    setError(null);
    try {
      await api.put(`/api/core/assistant/rights/${encodeURIComponent(id)}`, { granted });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      rights.reload();
    }
  };
  return (
    <Card title="Droits de l’assistant">
      <p className="muted">
        Ce que l’assistant (voix et barre écrite) peut modifier. Tout est désactivé par défaut ; il
        lit toujours sans droit.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {rights.data?.length === 0 && <p className="muted">Aucun droit déclaré.</p>}
      <ul className="list">
        {rights.data?.map((r) => (
          <li key={r.id} className="list__item" id={`setting-rights-${r.id}`}>
            <label>
              <input
                type="checkbox"
                checked={r.granted}
                onChange={(e) => void set(r.id, e.target.checked)}
              />{' '}
              {r.label}
            </label>
            <span className="muted small">{r.moduleName}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface Section {
  id: string;
  title: string;
  group: string;
  icon?: string;
  /** Searched: the settings it holds (title, description). */
  entries: { key: string; label: string; description?: string }[];
}

const GENERAL_GROUP = 'Général';
const LAST_SECTION = 'toolbox.settings.section';

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function lastSection(): string | null {
  try {
    return localStorage.getItem(LAST_SECTION);
  } catch {
    return null;
  }
}

/**
 * Réglages: a menu of sections (« Général » first, then one per tool, grouped
 * like the sidebar), a search over every setting, one section shown at a time.
 * `?s=<module id>` opens a tool's section (gear button of the tool pages); the
 * last section opened comes back. No setting changes value or behaviour.
 */
export function SettingsPage() {
  const settings = useApi<SettingsSectionData[]>('/api/core/settings');
  const { home } = useNavigation();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const general = settings.data?.find((s) => s.scope === 'core');
  const accountSection = settings.data?.find((s) => s.scope === 'accounts');
  const byScope = new Map((settings.data ?? []).map((s) => [s.scope, s]));
  const fieldsOf = (scope: string) =>
    (byScope.get(scope)?.fields ?? []).map(({ field }) => ({
      key: `setting-${scope}-${field.key}`,
      label: field.label,
      description: field.description,
    }));

  const sections: Section[] = [
    { id: 'general', title: 'Général', group: GENERAL_GROUP, entries: fieldsOf('core') },
    {
      id: 'appearance',
      title: 'Apparence',
      group: GENERAL_GROUP,
      entries: [{ key: 'appearance', label: 'Thème de l’interface' }],
    },
    {
      id: 'floating',
      title: 'Fenêtre flottante',
      group: GENERAL_GROUP,
      entries: [
        { key: 'setting-floating-anchor', label: 'Position de la fenêtre flottante' },
        { key: 'setting-floating-locked', label: 'Verrouiller la position' },
      ],
    },
    {
      id: 'rights',
      title: 'Droits de l’assistant',
      group: GENERAL_GROUP,
      entries: [{ key: 'rights', label: 'Droits de l’assistant', description: 'interrupteurs' }],
    },
    {
      id: 'accounts',
      title: 'Comptes connectés',
      group: GENERAL_GROUP,
      entries: [
        { key: 'accounts', label: 'Comptes connectés', description: 'Google, YouTube, OAuth' },
        ...fieldsOf('accounts'),
      ],
    },
    {
      id: 'modules',
      title: 'Modules',
      group: GENERAL_GROUP,
      entries: [{ key: 'modules', label: 'Activer ou désactiver un module' }],
    },
    {
      id: 'backups',
      title: 'Sauvegardes',
      group: GENERAL_GROUP,
      entries: [{ key: 'backups', label: 'Exporter une sauvegarde', description: 'automatiques' }],
    },
    {
      id: 'about',
      title: 'À propos',
      group: GENERAL_GROUP,
      entries: [{ key: 'about', label: 'Version, dossier de données' }],
    },
    ...home.flatMap((category) =>
      category.tools
        .filter((tool) => tool.module.status === 'loaded')
        .map((tool) => ({
          id: tool.id,
          title: tool.module.manifest.name,
          group: category.name,
          icon: tool.module.manifest.icon,
          entries: fieldsOf(tool.id),
        })),
    ),
  ];
  const wanted = params.get('s') ?? lastSection() ?? 'general';
  const current = sections.find((s) => s.id === wanted) ?? sections[0]!;
  // The section shown (from the menu, a search or a tool's gear) is remembered.
  useEffect(() => {
    try {
      localStorage.setItem(LAST_SECTION, current.id);
    } catch {
      // Not remembered: fine.
    }
  }, [current.id]);
  const open = (id: string, scrollTo?: string) => {
    setParams({ s: id });
    setTarget(scrollTo ?? null);
    setQuery('');
  };
  // A search result: the section opens at the setting, highlighted a moment.
  useEffect(() => {
    if (!target) return;
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('settings-hit');
    const timer = setTimeout(() => el.classList.remove('settings-hit'), 1600);
    return () => clearTimeout(timer);
  }, [target, current.id, settings.data]);

  const words = fold(query).split(/\s+/).filter(Boolean);
  const results = words.length
    ? sections.flatMap((section) =>
        [{ key: '', label: section.title, description: section.group }, ...section.entries]
          .filter((e) => {
            const text = fold(`${section.title} ${e.label} ${e.description ?? ''}`);
            return words.every((w) => text.includes(w));
          })
          .map((e) => ({ section, entry: e })),
      )
    : [];
  const groups = [...new Set(sections.map((s) => s.group))];
  const scopeSection = byScope.get(current.id);

  return (
    <Page title="Réglages">
      {settings.error && <ErrorMessage>{settings.error}</ErrorMessage>}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Sections des réglages">
          <input
            className="input settings-nav__search"
            type="search"
            value={query}
            placeholder="Rechercher un réglage…"
            aria-label="Rechercher un réglage"
            onChange={(e) => setQuery(e.target.value)}
          />
          {words.length > 0 ? (
            <ul className="settings-nav__results">
              {results.length === 0 && <li className="muted small">Aucun réglage trouvé.</li>}
              {results.slice(0, 30).map(({ section, entry }) => (
                <li key={`${section.id}-${entry.key}`}>
                  <button type="button" onClick={() => open(section.id, entry.key || undefined)}>
                    <span className="small muted">{section.title} ›</span>{' '}
                    {entry.label || section.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            groups.map((group) => (
              <div key={group} className="settings-nav__group">
                <p className="settings-nav__title">{group}</p>
                {sections
                  .filter((s) => s.group === group)
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`settings-nav__item${s.id === current.id ? ' settings-nav__item--active' : ''}`}
                      aria-current={s.id === current.id ? 'page' : undefined}
                      onClick={() => open(s.id)}
                    >
                      {s.icon && <span aria-hidden>{s.icon}</span>} {s.title}
                    </button>
                  ))}
              </div>
            ))
          )}
        </nav>
        <div className="settings-content">
          {current.id === 'general' && general && (
            <Card title="Général">
              <SettingsForm section={general} onSaved={settings.reload} />
            </Card>
          )}
          {current.id === 'appearance' && <AppearanceCard />}
          {current.id === 'floating' && <FloatingCard />}
          {current.id === 'rights' && <RightsCard />}
          {current.id === 'accounts' && (
            <AccountsCard section={accountSection} onSaved={settings.reload} />
          )}
          {current.id === 'modules' && <ModulesCard />}
          {current.id === 'backups' && <BackupsCard />}
          {current.id === 'about' && <AboutCard />}
          {current.group !== GENERAL_GROUP && (
            <Card title={`${current.icon ?? ''} ${current.title}`}>
              {scopeSection && scopeSection.fields.length > 0 ? (
                <SettingsForm key={current.id} section={scopeSection} onSaved={settings.reload} />
              ) : (
                <p className="muted">Cet outil n’a pas de réglage ici.</p>
              )}
              <p className="small">
                <Link to={`/m/${current.id}`}>Ouvrir {current.title}</Link>
              </p>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
