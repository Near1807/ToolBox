// v0.47.0 (Expérimental): Réglages › Sauvegardes › « Restaurer ToolBox depuis
// une sauvegarde » (ADR 0063). Choose a copy (an automatic backup, or a file:
// the Coffre's disk keeps one in ToolBox-Coffre/_ToolBox/Base/hub.db), see
// what it holds, then — confirmed — the current base is saved first and the
// copy replaces it at the next start (any failure: the base of before comes
// back by itself).
import { useState } from 'react';
import {
  api,
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  pickFiles,
  useApi,
} from '@hub/sdk/frontend';
import { formatDateTime, formatSize } from '../format';

interface Status {
  pending: { source: string; stagedAt: string; backup: string } | null;
  result: { ok: boolean; at: string; source: string; reason?: string } | null;
  automatic: { file: string; name: string; size: number; createdAt: string }[];
}
interface Preview {
  file: string;
  size: number;
  modifiedAt: string;
  appVersion: string | null;
  modules: { scope: string; name: string; version: number; items: number }[];
  refused: string | null;
}

export function RestoreCard() {
  const status = useApi<Status>('/api/core/restore');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = status.data;

  const look = (file: string) => {
    setError(null);
    setPreview(null);
    api
      .post<Preview>('/api/core/restore/preview', { file })
      .then(setPreview)
      .catch((e: unknown) => setError(errorMessage(e)));
  };
  const choose = async () => {
    try {
      const [file] = await pickFiles({
        title: 'Choisir une copie de la base de ToolBox (hub.db)',
        filters: [{ name: 'Base de ToolBox', extensions: ['db'] }],
      });
      if (file) look(file);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const stage = () => {
    if (!preview) return;
    if (
      !window.confirm(
        `Restaurer ToolBox depuis cette copie ?\n\n• La base actuelle est d’abord sauvegardée (Sauvegardes automatiques).\n• La copie la remplace au prochain démarrage de ToolBox (pas avant).\n• En cas d’échec au démarrage, la base d’avant revient toute seule.\n• Le téléphone demandera une première synchro : choisis « Fusionner ».`,
      )
    )
      return;
    setBusy(true);
    api
      .post('/api/core/restore/stage', { file: preview.file, confirm: true })
      .then(() => {
        setPreview(null);
        status.reload();
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div id="restore">
      <Card
        title="Restaurer ToolBox depuis une sauvegarde"
        actions={<span className="badge badge--warning">Expérimental</span>}
      >
        {s?.result && (
          <div className={s.result.ok ? 'success' : 'error'}>
            <p>
              {s.result.ok
                ? `Base restaurée le ${formatDateTime(s.result.at)} depuis ${s.result.source}.`
                : `Restauration annulée le ${formatDateTime(s.result.at)} : la base d’avant est revenue. Raison : ${s.result.reason ?? 'inconnue'}`}
            </p>
            <Button
              variant="secondary"
              small
              onClick={() =>
                void api.delete('/api/core/restore/result').then(() => status.reload())
              }
            >
              OK
            </Button>
          </div>
        )}
        {s?.pending ? (
          <>
            <p>
              <strong>Restauration prête</strong> depuis {s.pending.source} : elle aura lieu au
              prochain démarrage de ToolBox. La base actuelle est sauvegardée.
            </p>
            <div className="settings-restore__actions">
              <Button onClick={() => void api.post('/api/core/restart')}>
                Redémarrer maintenant
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void api.post('/api/core/restore/cancel').then(() => status.reload())
                }
              >
                Annuler la restauration
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Choisis une copie : une sauvegarde automatique, ou un fichier (le disque du coffre en
              garde une : <code>ToolBox-Coffre\_ToolBox\Base\hub.db</code>). Tu vois d’abord ce
              qu’elle contient ; rien ne change avant ta confirmation, et le remplacement n’a lieu
              qu’au redémarrage.
            </p>
            <div className="settings-restore__actions">
              <Button variant="secondary" onClick={() => void choose()}>
                Choisir un fichier…
              </Button>
            </div>
            {(s?.automatic.length ?? 0) > 0 && (
              <ul className="list settings-restore__list">
                {s!.automatic.map((b) => (
                  <li key={b.file} className="list__item">
                    <span>{formatDateTime(b.createdAt)}</span>
                    <span className="muted">
                      {b.name} · {formatSize(b.size)}
                    </span>
                    <Button variant="secondary" small onClick={() => look(b.file)}>
                      Voir
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {preview && (
          <section className="settings-restore__preview" aria-label="Aperçu de la copie">
            <h4>Aperçu</h4>
            <p>
              {preview.file}
              <br />
              <span className="muted">
                Écrite le {formatDateTime(preview.modifiedAt)} · {formatSize(preview.size)} ·{' '}
                {preview.appVersion
                  ? `ToolBox ${preview.appVersion}`
                  : 'version de ToolBox inconnue (avant 0.47)'}
              </span>
            </p>
            <table className="settings-restore__table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Éléments</th>
                  <th>Version de ses données</th>
                </tr>
              </thead>
              <tbody>
                {preview.modules
                  .filter((m) => m.scope !== 'core')
                  .map((m) => (
                    <tr key={m.scope}>
                      <td>{m.name}</td>
                      <td>{m.items}</td>
                      <td>v{m.version}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {preview.refused ? (
              <p className="error">{preview.refused}</p>
            ) : (
              <Button disabled={busy} onClick={stage}>
                Restaurer cette copie…
              </Button>
            )}
          </section>
        )}
      </Card>
    </div>
  );
}
