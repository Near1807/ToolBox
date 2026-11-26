// v0.46.0: Réglages › Coffre › « Disque du coffre » — choose a folder on the
// external disk (ToolBox creates « ToolBox-Coffre » there, with its identity),
// rename it, forget it (nothing is touched on the disk).
import { useState } from 'react';
import { Button, ErrorMessage, errorMessage, pickFolder, useModule } from '@hub/sdk/frontend';
import type { DiskStatusDto } from '../../shared/types';
import { witnessText } from './DiskWitness';
import { RestoreDialog } from './RestoreDialog';
import { useDisk } from './useDisk';

export function DiskSettings() {
  const module = useModule();
  const { data: s, reload } = useDisk();
  const [name, setName] = useState('Disque 1 To');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const choose = () =>
    run(async () => {
      const folder = await pickFolder({
        title: 'Disque du coffre : choisir un dossier sur le disque externe',
      });
      if (folder) await module.api.post<DiskStatusDto>('/disk/register', { path: folder, name });
    });

  return (
    <div className="coffre-settings">
      <h3>Disque du coffre</h3>
      {s && (
        <p className={`coffre-settings__state coffre-settings__state--${witnessText(s).tone}`}>
          {witnessText(s).text}
          {s.disk?.lastRoot && (
            <span className="muted"> · vu en dernier dans {s.disk.lastRoot}</span>
          )}
        </p>
      )}
      {s?.disk ? (
        <>
          <label className="coffre-settings__row">
            <span>Nom du disque</span>
            <input
              className="input"
              defaultValue={s.disk.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== s.disk?.name) void run(() => module.api.patch('/disk', { name: v }));
              }}
            />
          </label>
          <p className="muted small">
            Le disque est reconnu par son fichier d'identité (dans « ToolBox-Coffre »), jamais par
            sa lettre : il peut revenir en E: ou en F:.
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Oublier le disque « ${s.disk?.name} » sur ce PC ?\n\nRien n'est effacé ni modifié sur le disque ; tu pourras le choisir à nouveau.`,
                )
              )
                void run(() => module.api.post('/disk/forget'));
            }}
          >
            Oublier ce disque
          </Button>
        </>
      ) : (
        <>
          <p className="muted small">
            Choisis un dossier sur ton disque externe : ToolBox y crée « ToolBox-Coffre » (tes
            dossiers en dossiers, lisibles sans ToolBox) et un fichier d'identité. Rien n'est copié
            avant ton clic sur « Mettre à jour ».
          </p>
          <label className="coffre-settings__row">
            <span>Nom du disque</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button disabled={busy} onClick={() => void choose()}>
            Choisir un dossier…
          </Button>
        </>
      )}
      <h3>Restaurer</h3>
      <p className="muted small">
        Sur un PC neuf ou après une perte : reprendre les fiches et les fichiers depuis le dossier «
        ToolBox-Coffre » d'un disque. Un aperçu d'abord ; rien n'est écrit sans ta confirmation.
      </p>
      <Button variant="secondary" onClick={() => setRestoring(true)}>
        Restaurer depuis un disque…
      </Button>
      {restoring && <RestoreDialog onClose={() => setRestoring(false)} onDone={reload} />}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}
