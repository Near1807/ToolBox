// v0.46.0 G: « Restaurer depuis un disque… » — choose the ToolBox-Coffre
// folder, see what it holds (last update, elements, room needed), then
// confirm explicitly: the sheets taken back, the active elements copied back
// (each read back), the archived ones left on the disk. When this PC's
// Coffre already has elements, its database is saved first and no file of
// the PC is ever replaced.
import { useState } from 'react';
import {
  Button,
  ErrorMessage,
  errorMessage,
  formatBytes,
  Gauge,
  Icon,
  pickFolder,
  useJobs,
  useModule,
} from '@hub/sdk/frontend';
import { ago, plural } from './useDisk';

interface Preview {
  folder: string;
  diskName: string;
  lastUpdateAt: string | null;
  active: number;
  archived: number;
  trashed: number;
  needed: number;
  pcFree: number | null;
  pcItems: number;
  registered: 'same' | 'other' | 'none';
}
interface Report {
  copied: number;
  already: number;
  archived: number;
  conflicts: { name: string; restoredAs: string }[];
  problems: { name: string; reason: string }[];
  backup: string | null;
}

export function RestoreDialog(props: { onClose: () => void; onDone: () => void }) {
  const module = useModule();
  const { jobs, cancel } = useJobs(module.id);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const running = jobId !== null && (!job || job.status === 'queued' || job.status === 'running');
  const report = job?.status === 'succeeded' ? (job.result as Report) : null;

  const choose = async () => {
    setError(null);
    try {
      const folder = await pickFolder({
        title: 'Restaurer depuis un disque : choisir le dossier « ToolBox-Coffre »',
      });
      if (folder) setPreview(await module.api.post<Preview>('/restore/preview', { path: folder }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const start = async () => {
    if (!preview) return;
    setError(null);
    try {
      const r = await module.api.post<{ jobId: string }>('/restore/apply', {
        path: preview.folder,
        confirm: true,
      });
      setJobId(r.jobId);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const enough = !preview || preview.pcFree === null || preview.needed < preview.pcFree;

  return (
    <div
      className="coffre-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Restaurer depuis un disque"
    >
      <div className="coffre-modal__box coffre-update">
        <header className="coffre-update__head">
          <h2>Restaurer depuis un disque</h2>
          {!running && (
            <button
              type="button"
              className="icon-button"
              aria-label="Fermer"
              onClick={props.onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </header>
        {!preview && !jobId && (
          <>
            <p>
              Choisis le dossier « ToolBox-Coffre » de ton disque. Tu verras ce qu'il contient avant
              que quoi que ce soit soit écrit.
            </p>
            <footer className="coffre-update__foot">
              <Button variant="secondary" onClick={props.onClose}>
                Annuler
              </Button>
              <Button onClick={() => void choose()}>Choisir le dossier…</Button>
            </footer>
          </>
        )}
        {preview && !jobId && (
          <>
            <p>
              Disque <strong>« {preview.diskName} »</strong> · dernière mise à jour{' '}
              {ago(preview.lastUpdateAt)}.
            </p>
            <ul className="coffre-restore__facts">
              <li>
                {plural(preview.active, 'élément actif', 'éléments actifs')} recopié
                {preview.active > 1 ? 's' : ''} sur ce PC ({formatBytes(preview.needed)}
                {preview.pcFree !== null ? ` ; ${formatBytes(preview.pcFree)} libres` : ''}), chacun
                relu et vérifié
              </li>
              <li>
                {plural(preview.archived, 'élément archivé', 'éléments archivés')} :{' '}
                {preview.archived > 1 ? 'restent' : 'reste'} sur le disque, fiches sur le PC
              </li>
              {preview.trashed > 0 && (
                <li>{plural(preview.trashed, 'élément')} dans la corbeille du disque</li>
              )}
            </ul>
            {preview.registered === 'other' && (
              <p className="coffre-update__refused">
                Un autre disque est enregistré sur ce PC : « Oublier ce disque » d'abord (Réglages ›
                Coffre).
              </p>
            )}
            {!enough && (
              <p className="coffre-update__refused">
                Pas assez de place sur le PC pour les éléments actifs.
              </p>
            )}
            {preview.pcItems > 0 && (
              <p className="coffre-update__stopped">
                Le Coffre de ce PC a déjà {plural(preview.pcItems, 'élément')}. La base de ToolBox
                sera sauvegardée d'abord ; les fiches du disque remplacent celles qui ont le même
                identifiant ; aucun fichier de ce PC n'est remplacé (une autre version prend un
                autre nom).
              </p>
            )}
            <label className="coffre-restore__confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Je confirme la restauration depuis « {preview.diskName} »
            </label>
            <footer className="coffre-update__foot">
              <Button variant="secondary" onClick={props.onClose}>
                Annuler
              </Button>
              <Button
                disabled={!confirmed || !enough || preview.registered === 'other'}
                onClick={() => void start()}
              >
                Restaurer
              </Button>
            </footer>
          </>
        )}
        {running && (
          <div className="coffre-update__progress">
            <Gauge
              value={job?.progress ?? 0}
              label={`${Math.round((job?.progress ?? 0) * 100)} %`}
              sub="restauré et vérifié"
              size={140}
            />
            <div>
              <p className="coffre-update__message">{job?.message ?? 'Démarrage…'}</p>
              {job && (
                <Button variant="secondary" onClick={() => void cancel(job.id)}>
                  Annuler
                </Button>
              )}
            </div>
          </div>
        )}
        {jobId && !running && (
          <>
            {report ? (
              <p className="coffre-update__done">
                <Icon name="circle-check" /> {plural(report.copied, 'élément')} recopié
                {report.copied > 1 ? 's' : ''} et vérifié{report.copied > 1 ? 's' : ''}
                {report.already ? `, ${report.already} déjà là` : ''} ;{' '}
                {plural(report.archived, 'archivé')} sur le disque.
              </p>
            ) : (
              <ErrorMessage>{job?.error ?? 'Restauration arrêtée.'}</ErrorMessage>
            )}
            {report?.backup && <p className="muted">Base sauvegardée avant : {report.backup}</p>}
            {report && report.conflicts.length > 0 && (
              <div className="coffre-update__problems">
                <strong>Gardés sous un autre nom (un fichier différent était déjà là) :</strong>
                <ul>
                  {report.conflicts.map((c) => (
                    <li key={c.restoredAs}>
                      {c.name} → {c.restoredAs}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report && report.problems.length > 0 && (
              <div className="coffre-update__problems">
                <strong>À voir :</strong>
                <ul>
                  {report.problems.map((p, i) => (
                    <li key={i}>
                      {p.name} — {p.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <footer className="coffre-update__foot">
              <Button
                onClick={() => {
                  props.onDone();
                  props.onClose();
                }}
              >
                Fermer
              </Button>
            </footer>
          </>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
    </div>
  );
}
