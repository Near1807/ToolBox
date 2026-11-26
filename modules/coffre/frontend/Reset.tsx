// v0.49.0 (Expérimental): « Réinitialiser le Coffre » — Gestion › Zone
// sensible. First the preview (what will be emptied) and the WARNINGS for what
// exists only in the Coffre, with « Exporter ces éléments d'abord »; always an
// inventory first; confirmed by typing « vider ». No « Annuler » afterwards
// (said clearly), but everything stays recoverable: the Windows Recycle Bin,
// the database saved first, the inventory, the disk's old folder renamed.
import { useEffect, useState } from 'react';
import {
  Button,
  errorMessage,
  ErrorMessage,
  formatBytes,
  Icon,
  jobCountText,
  pickFolder,
  runJob,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import type { ResetPreviewDto, ResetReport } from '../shared/types';
import { useCoffre } from './frame';

const REASONS: Record<ResetPreviewDto['onlyHere'][number]['reason'], string> = {
  'original-absent': 'l’original n’existe plus',
  'original-different': 'l’original n’est plus identique (modifié ici ou là-bas)',
  archived: 'archivé : sa seule copie gérée est sur le disque',
  'no-original': 'aucun original connu (ajouté directement dans le Coffre)',
};

/** Gestion › the sensitive zone, at the bottom. */
export function SensitiveZone() {
  const [open, setOpen] = useState(false);
  return (
    <section className="coffre-panel coffre-danger" aria-label="Zone sensible" data-coffre-danger>
      <h2 className="coffre-h2">
        Zone sensible <span className="badge badge--warning">Expérimental</span>
      </h2>
      <p className="muted small">
        Vider entièrement le Coffre pour repartir de zéro. Rien d’autre n’est touché (Agenda,
        To-do…). Un aperçu et un inventaire viennent d’abord.
      </p>
      <Button variant="danger" onClick={() => setOpen(true)} data-coffre-reset-open>
        Réinitialiser le Coffre…
      </Button>
      {open && <ResetDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

/** The disk's old folder to rename (the disk was absent at the reset): proposed, never alone. */
export function PendingDiskRename() {
  const module = useModule();
  const coffre = useCoffre();
  const pending = useApi<{ name: string; date: string; connected: boolean } | null>(
    module.url('/reset/pending'),
  );
  const p = pending.data;
  if (!p) return null;
  return (
    <div className="coffre-banner" role="status" data-coffre-reset-pending>
      <span>
        Le Coffre a été réinitialisé le {p.date} alors que le disque « {p.name} » était absent.
        {p.connected
          ? ' Il est branché : son ancien dossier « ToolBox-Coffre » doit être renommé (rien n’y est supprimé) avant toute mise à jour.'
          : ' À son prochain branchement, ToolBox proposera de renommer son ancien dossier.'}
      </span>
      {p.connected && (
        <Button
          small
          onClick={() =>
            void runJob<{ folder: string }>(module.api.post('/reset/disk-rename', {}))
              .then((r) => {
                coffre.notify(`Ancien dossier du disque renommé : ${r.folder}`);
                pending.reload();
                coffre.refresh();
              })
              .catch(coffre.fail)
          }
        >
          Renommer l’ancien dossier
        </Button>
      )}
    </div>
  );
}

function ResetDialog(props: { onClose: () => void }) {
  const coffre = useCoffre();
  const { api } = coffre;
  const [preview, setPreview] = useState<ResetPreviewDto | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inventoryDir, setInventoryDir] = useState<string | null>(null);
  const [forgetRules, setForgetRules] = useState(false);
  const [keepDisk, setKeepDisk] = useState(true);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [report, setReport] = useState<ResetReport | null>(null);

  useEffect(() => {
    let live = true;
    runJob<ResetPreviewDto>(
      api.post('/reset/preview', {}),
      (job) => live && setReading(jobCountText(job)),
    )
      .then((p) => live && setPreview(p))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [api]);

  const folder = inventoryDir ?? preview?.inventoryParent ?? '';
  const exportFirst = async () => {
    if (!preview) return;
    try {
      const dest = await pickFolder({ title: 'Exporter ces éléments : choisir un dossier' });
      if (!dest) return;
      setBusy(true);
      const r = await runJob<{ exported: number; folder: string }>(
        api.post('/reset/export', { ids: preview.onlyHere.map((o) => o.id), dest }),
      );
      setExported(`${r.exported} élément(s) exporté(s) dans ${r.folder}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const empty = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await runJob<ResetReport>(
        api.post('/reset/apply', { inventoryDir: folder, confirm: typed, forgetRules, keepDisk }),
      );
      setReport(r);
      coffre.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="coffre-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Réinitialiser le Coffre"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) {
          e.preventDefault();
          props.onClose();
        }
      }}
    >
      <div className="coffre-modal__box coffre-question coffre-reset" data-coffre-reset>
        <h2>Réinitialiser le Coffre</h2>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {!preview && !error && (
          <p className="muted" role="status">
            Vérification de ce que contient le Coffre…{reading ? ` ${reading}` : ''}
          </p>
        )}
        {report ? (
          <div role="status" data-coffre-reset-done>
            <p>
              <Icon name="circle-check" /> Coffre vidé : {report.emptied.items} élément(s),{' '}
              {report.emptied.folders} dossier(s).
            </p>
            <ul className="small">
              <li>Inventaire : {report.inventory}</li>
              <li>
                Fichiers du Coffre : dans la corbeille de Windows ({report.trashed} dossier(s)).
              </li>
              <li>Base sauvegardée avant : {report.backup}</li>
              {report.diskFolder && <li>Ancien dossier du disque renommé : {report.diskFolder}</li>}
              {report.diskPending && (
                <li>
                  Disque absent : rien n’y a été fait. À son prochain branchement, ToolBox proposera
                  de renommer son ancien dossier.
                </li>
              )}
            </ul>
            <Button onClick={props.onClose}>Fermer</Button>
          </div>
        ) : (
          preview && (
            <>
              <p>Sera vidé :</p>
              <ul className="small">
                <li>
                  {preview.items} fichier(s) dans {preview.folders} dossier(s),{' '}
                  {formatBytes(preview.bytes)} sur le PC ;
                </li>
                {preview.archived > 0 && (
                  <li>{preview.archived} fichier(s) archivé(s) sur le disque ;</li>
                )}
                <li>la recherche, les files d’attente du Coffre.</li>
              </ul>
              {preview.onlyHere.length > 0 && (
                <div className="coffre-reset__warn" role="alert" data-coffre-reset-warn>
                  <p>
                    <Icon name="warning" /> {preview.onlyHere.length} élément(s) n’existent{' '}
                    <strong>que dans le Coffre</strong> :
                  </p>
                  <ul className="small">
                    {preview.onlyHere.slice(0, 40).map((o) => (
                      <li key={o.id}>
                        {o.folderPath ? `${o.folderPath.join(' › ')} › ` : ''}
                        <strong>{o.name}</strong> — {REASONS[o.reason]}
                      </li>
                    ))}
                    {preview.onlyHere.length > 40 && (
                      <li>… et {preview.onlyHere.length - 40} autre(s) (tous dans l’inventaire)</li>
                    )}
                  </ul>
                  <Button
                    variant="secondary"
                    small
                    disabled={busy}
                    onClick={() => void exportFirst()}
                  >
                    Exporter ces éléments d’abord…
                  </Button>
                  {exported && <p className="small">{exported}</p>}
                </div>
              )}
              <div className="coffre-reset__row">
                <span>
                  Inventaire (CSV + JSON) écrit d’abord dans un dossier « ToolBox-inventaire-… » de
                  : <strong>{folder}</strong>
                </span>
                <Button
                  variant="secondary"
                  small
                  onClick={() =>
                    void pickFolder({ title: 'Où écrire l’inventaire ?' }).then(
                      (d) => d && setInventoryDir(d),
                    )
                  }
                >
                  Changer…
                </Button>
              </div>
              <label className="small">
                <input
                  type="checkbox"
                  checked={forgetRules}
                  onChange={(e) => setForgetRules(e.target.checked)}
                />{' '}
                Oublier aussi ce que le Coffre a appris ({preview.rules} règle(s))
              </label>
              {preview.disk && (
                <fieldset className="coffre-reset__disk small">
                  <legend>Disque « {preview.disk.name} »</legend>
                  <p className="muted">
                    Rien n’y est supprimé : son dossier « ToolBox-Coffre » est renommé «
                    ToolBox-Coffre-ancien-… » (tu le supprimeras toi-même)
                    {preview.disk.connected
                      ? '.'
                      : ' — il est absent : ce sera proposé à son prochain branchement.'}
                  </p>
                  <label>
                    <input type="radio" checked={keepDisk} onChange={() => setKeepDisk(true)} /> Le
                    garder pour un nouveau dossier vide
                  </label>
                  <label>
                    <input type="radio" checked={!keepDisk} onChange={() => setKeepDisk(false)} />{' '}
                    L’oublier
                  </label>
                </fieldset>
              )}
              <p className="coffre-reset__final small">
                <strong>Pas d’« Annuler » après coup.</strong> Tout reste récupérable : la corbeille
                de Windows (les fichiers), la sauvegarde de la base faite juste avant, l’inventaire,
                et l’ancien dossier sur le disque.
              </p>
              <label className="coffre-reset__type">
                <span>
                  Pour confirmer, tape <strong>vider</strong> :
                </span>
                <input
                  className="input"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-label="Taper vider pour confirmer"
                  data-coffre-reset-type
                />
              </label>
              <div className="coffre-treedialog__buttons">
                <Button
                  variant="danger"
                  disabled={busy || typed.trim().toLowerCase() !== 'vider'}
                  onClick={() => void empty()}
                  data-coffre-reset-go
                >
                  Vider le Coffre
                </Button>
                <Button variant="secondary" disabled={busy} onClick={props.onClose}>
                  Annuler
                </Button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
