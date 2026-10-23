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
} from '@hub/sdk/frontend';
import { fmtDay } from './charts';
import type { LinksData, StateData } from './types';

export function Data(props: { state: StateData | null; reload: () => void }) {
  const module = useModule();
  const links = useApi<LinksData>(module.url('/links'));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
                    ? `${new Date(s.lastSync.at).toLocaleString('fr-FR')} — ${s.lastSync.ok ? 'réussie' : 'échec'}`
                    : 'jamais'}
                  {s.lastSync?.message && (
                    <div className={s.lastSync.ok ? 'small muted' : 'small error'}>
                      {s.lastSync.message}
                    </div>
                  )}
                </dd>
              </div>
              <div>
                <dt>Données complètes jusqu’au</dt>
                <dd>
                  {fmtDay(s.lastDay)} (YouTube publie ses statistiques avec 2 à 3 jours de retard)
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
        {s && s.imports.length > 0 && (
          <ul className="ys-events">
            {s.imports.map((i) => (
              <li key={i.id} className="small">
                {new Date(i.imported_at).toLocaleString('fr-FR')} — {i.file_name} : {i.matched}/
                {i.rows} vidéo(s)
                {i.kind === 'daily'
                  ? ' (par jour)'
                  : i.kind === 'totals'
                    ? ' (totaux)'
                    : ' (colonnes non reconnues)'}
              </li>
            ))}
          </ul>
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
