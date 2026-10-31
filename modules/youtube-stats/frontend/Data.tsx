// « Données »: the Google account (incremental authorization), the sync and its
// state, the YouTube Studio CSV import, manual links of videos published
// outside ToolBox, and what the API can and cannot give.
import { useState } from 'react';
import {
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  pickFiles,
  useApi,
  useModule,
  Icon,
  type IconName,
} from '@hub/sdk/frontend';
import { fmtDay } from './charts';
import type { DiagnosticCheck, ImportInfo, LinksData, StateData } from './types';

const STATUS_LABELS: Record<DiagnosticCheck['status'], string> = {
  ok: 'OK',
  problem: 'Problème',
  warning: 'À savoir',
  info: 'Info',
};
const STATUS_ICONS: Record<DiagnosticCheck['status'], IconName> = {
  ok: 'circle-check',
  problem: 'circle-x',
  warning: 'circle-alert',
  info: 'help',
};

const metricsLabel = (i: ImportInfo) =>
  i.metrics.length === 0
    ? 'aucune métrique reconnue'
    : i.metrics.map((m) => (m === 'ctr' ? 'taux de clics' : 'impressions')).join(', ');

export function Data(props: { state: StateData | null; reload: () => void }) {
  const module = useModule();
  const links = useApi<LinksData>(module.url('/links'));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ checks: DiagnosticCheck[]; at: string } | null>(
    null,
  );
  const [diagnosing, setDiagnosing] = useState(false);
  const diagnose = async () => {
    setDiagnosing(true);
    setError(null);
    try {
      setDiagnostic(await module.api.post('/diagnostic'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDiagnosing(false);
    }
  };
  const deleteImport = async (target: ImportInfo | 'all') => {
    const id = target === 'all' ? 'all' : target.id;
    let footprint: { text: string };
    try {
      footprint = await module.api.get(`/imports/${id}/footprint`);
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    const what =
      target === 'all'
        ? 'toutes les données venues d’imports CSV'
        : `l’import « ${target.file_name} » du ${new Date(target.imported_at).toLocaleString('fr-FR')}`;
    const ok = window.confirm(
      `Supprimer ${what} ?\n\nCe qui part : ${footprint.text}.\nCe qui reste : toutes les données de l’API YouTube (vues, durée, j’aime…), qui ne sont jamais touchées.\n\nUne sauvegarde de la base est faite juste avant (Réglages › Sauvegardes).`,
    );
    if (!ok) return;
    await run(
      () => module.api.delete(`/imports/${id}`),
      (result: { text: string; backup: string }) =>
        `Supprimé : ${result.text}. Sauvegarde faite avant : ${result.backup}.`,
    );
  };
  const run = async (
    action: () => Promise<unknown>,
    done: string | ((result: never) => string),
  ) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      setMessage(typeof done === 'string' ? done : done(result as never));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      props.reload();
      links.reload();
    }
  };
  const s = props.state;
  const demo = s?.mode === 'demo';

  const importCsv = async () => {
    const files = await pickFiles({
      title: 'Export de YouTube Studio',
      filters: [{ name: 'Export YouTube Studio', extensions: ['zip', 'csv'] }],
    });
    if (!files[0]) return;
    await run(
      () => module.api.post('/import', { path: files[0] }),
      (result: { report: { file: string; rows: number; matched: number; kind: string }[] }) =>
        result.report
          .map(
            (r) =>
              `${r.file} : ${r.matched} vidéo(s) reconnue(s) sur ${r.rows}${r.kind === 'unknown' ? ' (colonnes non reconnues)' : ''}`,
          )
          .join(' · '),
    );
  };

  return (
    <>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {message && <p className="success">{message}</p>}
      <Card title="Compte Google et synchronisation">
        {!s ? (
          <p className="muted">…</p>
        ) : (
          <>
            <dl className="ys-info">
              <div>
                <dt>Compte Google</dt>
                <dd>
                  {!s.account.configured
                    ? 'Pas encore configuré (Planning de sortie › Compte Google, ou Réglages › Comptes connectés)'
                    : !s.account.connected
                      ? 'Non connecté'
                      : s.account.needsReconnect
                        ? 'À reconnecter (autorisation expirée)'
                        : `Connecté${s.channel ? ` — ${s.channel.title}` : ''}`}
                </dd>
              </div>
              <div>
                <dt>Accès aux statistiques</dt>
                <dd>{s.account.scopesOk ? 'Autorisé (lecture seule)' : 'Pas encore autorisé'}</dd>
              </div>
              <div>
                <dt>Dernière synchronisation</dt>
                <dd>
                  {s.lastSync
                    ? `${new Date(s.lastSync.at).toLocaleString('fr-FR')} — ${s.lastSync.postponed ? 'reportée (envois du Planning d’abord)' : s.lastSync.minimal ? 'minimale (envois prévus dans les 24 h)' : s.lastSync.ok ? 'réussie' : 'échec'}`
                    : 'jamais'}
                  {s.lastSync?.message && (
                    <div className={s.lastSync.ok ? 'small muted' : 'small error'}>
                      {s.lastSync.message}
                    </div>
                  )}
                  {s.lastSync?.report && <div className="small">{s.lastSync.report}</div>}
                  <div className="small muted">
                    Automatique toutes les {s.autoSyncHours} h tant que l’app est ouverte.
                  </div>
                </dd>
              </div>
              <div>
                <dt>Données consolidées jusqu’au</dt>
                <dd>
                  {fmtDay(s.lastDay)} (YouTube Analytics, publié avec 2 à 3 jours de retard :
                  courbes, Labo, théories)
                  <div className="small muted">
                    Les compteurs « en direct » (abonnés, vues totales, j’aime, commentaires)
                    viennent de l’API Data à chaque synchronisation.
                  </div>
                  {s.fullResync && (
                    <div className="small">
                      La prochaine synchronisation reprend tout l’historique (réparation des jours
                      qu’un import CSV faisait passer pour connus).
                    </div>
                  )}
                </dd>
              </div>
              <div>
                <dt>Impressions et taux de clics</dt>
                <dd>
                  {s.reach === 'api'
                    ? 'Fournis par l’API'
                    : s.reach === 'unavailable'
                      ? 'Non fournis par l’API pour ta chaîne : importe l’export CSV de Studio ci-dessous'
                      : 'Testés à la prochaine synchronisation'}
                </dd>
              </div>
            </dl>
            {s.syncing && (
              <p>
                Synchronisation en cours… {s.syncing.message ?? ''}
                {s.syncing.progress !== null ? ` (${Math.round(s.syncing.progress * 100)} %)` : ''}
              </p>
            )}
            <div className="toolbar">
              {(!s.account.connected || !s.account.scopesOk || s.account.needsReconnect) &&
                s.account.configured && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => module.api.post('/account/connect'),
                        'Accès autorisé : la synchronisation démarre.',
                      )
                    }
                  >
                    {s.account.connected
                      ? 'Autoriser les statistiques'
                      : 'Connecter le compte Google'}
                  </Button>
                )}
              <Button
                variant="secondary"
                disabled={busy || !s.account.connected || !s.account.scopesOk || Boolean(s.syncing)}
                onClick={() =>
                  run(
                    () => module.api.post('/sync'),
                    'Synchronisation lancée (visible dans Tâches).',
                  )
                }
              >
                Synchroniser maintenant
              </Button>
            </div>
            <p className="small muted">
              L’autorisation demandée est en lecture seule (YouTube Analytics + YouTube en lecture).
              Elle s’ajoute à celle du Planning de sortie : rien à reconnecter, juste à accepter une
              fois. Dans Google Cloud, active aussi « YouTube Analytics API » (API et services ›
              Bibliothèque) dans le même projet que l’envoi des vidéos.
            </p>
          </>
        )}
      </Card>

      <Card
        title="Diagnostic"
        actions={
          <Button variant="secondary" disabled={diagnosing || busy} onClick={() => void diagnose()}>
            {diagnosing ? 'Vérification…' : 'Lancer le diagnostic'}
          </Button>
        }
      >
        <p className="small muted">
          Vérifie maintenant chaque point (compte, autorisation, jeton, API activées, retard de
          YouTube, quota et priorité aux envois, dernière synchronisation, imports CSV). Lecture
          seule : une requête à chaque API (1 unité de quota YouTube Data).
        </p>
        {diagnostic && (
          <ul className="ys-checks">
            {diagnostic.checks.map((c) => (
              <li key={c.id} className={`ys-check ys-check--${c.status}`}>
                <span className="ys-check__badge" aria-label={STATUS_LABELS[c.status]}>
                  <Icon name={STATUS_ICONS[c.status]} /> {STATUS_LABELS[c.status]}
                </span>
                <div>
                  <strong>{c.label}</strong> — {c.detail}
                  {c.action && <div className="small">À faire : {c.action}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {diagnostic && (
          <p className="small muted">
            Vérifié le {new Date(diagnostic.at).toLocaleString('fr-FR')}.
          </p>
        )}
      </Card>

      <Card title="Import de l’export YouTube Studio (impressions, taux de clics)">
        <p className="small">
          Dans YouTube Studio : <strong>Statistiques › Mode avancé</strong>, onglet « Contenu »,
          choisis la période et les métriques (Impressions, Taux de clics des impressions…), puis{' '}
          <strong>Exporter › Valeurs séparées par des virgules (.csv)</strong>. Importe le .zip tel
          quel (ou un des fichiers .csv). Les colonnes sont reconnues automatiquement (français ou
          anglais) et fusionnées avec les données de l’API, vidéo par vidéo.
        </p>
        <Button disabled={busy || demo} onClick={() => void importCsv()}>
          Importer un export…
        </Button>
        {demo && <p className="small muted">Indisponible en mode démo.</p>}
        <p className="small muted">
          Priorité : les données de l’API passent toujours avant celles d’un CSV, jour par jour. Un
          CSV ne fournit que les impressions et le taux de clics, et seulement là où l’API n’en
          donne pas. La source de chaque nombre s’affiche au survol.
        </p>
        {s && s.imports.length > 0 && (
          <table className="ys-table">
            <thead>
              <tr>
                <th>Import</th>
                <th>Période</th>
                <th className="num">Lignes</th>
                <th>Métriques</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.imports.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.file_name}
                    <div className="small muted">
                      {new Date(i.imported_at).toLocaleString('fr-FR')} ·{' '}
                      {i.kind === 'daily'
                        ? 'par jour'
                        : i.kind === 'totals'
                          ? 'totaux par vidéo'
                          : 'colonnes non reconnues'}
                      {i.legacy && ' · importé avant la v0.18'}
                    </div>
                  </td>
                  <td className="nowrap">
                    {i.period_from && i.period_to
                      ? `${fmtDay(i.period_from)} → ${fmtDay(i.period_to)}`
                      : i.kind === 'totals'
                        ? 'à la date de l’export'
                        : '—'}
                  </td>
                  <td className="num">
                    {i.matched}/{i.rows} vidéo(s)
                    <div className="small muted">
                      {i.kind === 'totals' ? `${i.videos} en usage` : `${i.days} jour(s) en usage`}
                    </div>
                  </td>
                  <td className="small">{metricsLabel(i)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={busy || demo}
                      onClick={() => void deleteImport(i)}
                    >
                      Supprimer cet import
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {s && s.unattributedCsv.days + s.unattributedCsv.videos > 0 && (
          <p className="small">
            {s.unattributedCsv.days > 0 &&
              `${s.unattributedCsv.days} jour(s)-vidéo d’impressions / taux de clics `}
            {s.unattributedCsv.days > 0 && s.unattributedCsv.videos > 0 && 'et '}
            {s.unattributedCsv.videos > 0 && `les totaux de ${s.unattributedCsv.videos} vidéo(s) `}
            viennent d’imports faits avant la v0.18 et ne peuvent pas être rattachés avec certitude
            à un import précis : plutôt que deviner, tu peux tout retirer d’un coup.
          </p>
        )}
        {s && (s.imports.length > 0 || s.unattributedCsv.days + s.unattributedCsv.videos > 0) && (
          <Button
            variant="secondary"
            disabled={busy || demo}
            onClick={() => void deleteImport('all')}
          >
            Supprimer toutes les données CSV
          </Button>
        )}
      </Card>

      <Card title="Vidéos publiées hors de ToolBox">
        <p className="small muted">
          Les vidéos envoyées par le Planning de sortie sont liées toutes seules à leur morceau
          (vidéo longue, Short n, Reel perso, extrait, effet). Les autres se lient ici ; une
          suggestion est faite d’après le titre.
        </p>
        {links.error && <ErrorMessage>{links.error}</ErrorMessage>}
        {links.data && links.data.videos.length === 0 && <p className="muted">Aucune.</p>}
        {links.data && links.data.videos.length > 0 && (
          <table className="ys-table">
            <thead>
              <tr>
                <th>Vidéo</th>
                <th>Morceau</th>
              </tr>
            </thead>
            <tbody>
              {links.data.videos.map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.title}
                    <div className="small muted">
                      {v.kind === 'short' ? 'Short' : 'Vidéo longue'} ·{' '}
                      {fmtDay(v.publishedAt.slice(0, 10))}
                    </div>
                  </td>
                  <td>
                    <select
                      className="input"
                      disabled={busy || demo}
                      value={
                        v.mode === 'none' ? 'none' : v.trackId === null ? '' : String(v.trackId)
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        void run(
                          () =>
                            module.api.put(`/videos/${v.id}/link`, {
                              trackId:
                                value === '' ? null : value === 'none' ? 'none' : Number(value),
                            }),
                          'Liaison enregistrée.',
                        );
                      }}
                    >
                      <option value="">— Non liée —</option>
                      <option value="none">Pas un morceau (ignorer)</option>
                      {links.data!.tracks.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                    {v.suggestion && v.trackId === null && (
                      <button
                        type="button"
                        className="ys-link small"
                        disabled={busy || demo}
                        onClick={() =>
                          void run(
                            () =>
                              module.api.put(`/videos/${v.id}/link`, { trackId: v.suggestion!.id }),
                            'Liaison enregistrée.',
                          )
                        }
                      >
                        Suggestion : « {v.suggestion.title} »
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Ce que l’API YouTube donne (et ne donne pas)">
        <ul className="small ys-limits">
          <li>
            <strong>Par jour et par vidéo</strong> : vues, vues engagées, durée de visionnage, durée
            moyenne, % moyen regardé, j’aime, commentaires, partages, abonnés gagnés et perdus.
          </li>
          <li>
            <strong>Par vidéo</strong> (rafraîchi tous les quelques jours) : courbe de rétention
            (100 points, audience restante et rétention relative), sources de trafic, pays,
            appareils, lieux de lecture, âge et genre, type (Short / vidéo longue), vidéos suggérées
            qui ont amené des vues.
          </li>
          <li>
            <strong>Impressions et taux de clics</strong> : pas toujours fournis par l’API ; sinon,
            import CSV de Studio.
          </li>
          <li>
            <strong>Démographie</strong> : masquée par YouTube sous un certain volume de vues.
          </li>
          <li>
            <strong>Délai</strong> : 2 à 3 jours ; les derniers jours sont revus à chaque
            synchronisation. Abonnés et vues totales « en direct » viennent de l’API Data (arrondis
            par YouTube au-delà de 1 000 abonnés).
          </li>
          <li>
            <strong>Quota</strong> : l’API Analytics a son propre quota ; en cas de dépassement, la
            synchronisation s’arrête proprement et reprend à la suivante.
          </li>
        </ul>
      </Card>
    </>
  );
}
