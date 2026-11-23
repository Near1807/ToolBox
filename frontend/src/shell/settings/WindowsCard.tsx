// v0.47.0 (Expérimental): « Ranger dans ToolBox » in Windows' right click and
// in « Envoyer vers » (ADR 0059). Added by the installer, removed by the
// uninstaller; here, Thomas removes them or puts them back. Shown only in the
// desktop app under Windows.
import { useState } from 'react';
import { api, Button, Card, errorMessage, useApi } from '@hub/sdk/frontend';

interface Integration {
  available: boolean;
  menu: boolean;
  sendTo: boolean;
}

export function WindowsCard() {
  const state = useApi<Integration>('/api/core/shell-integration');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = state.data;
  if (!s?.available) return null;
  const on = s.menu || s.sendTo;
  const set = (enabled: boolean) => {
    setBusy(true);
    setError(null);
    api
      .put('/api/core/shell-integration', { enabled })
      .then(() => state.reload())
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div id="windows-menu">
      <Card
        title="Clic droit de Windows"
        actions={<span className="badge badge--warning">Expérimental</span>}
      >
        <p className="muted">
          « Ranger dans ToolBox » dans le clic droit de l’explorateur (fichiers et dossiers) et dans
          « Envoyer vers » : la fenêtre de rangement du Coffre s’ouvre avec ces fichiers (plusieurs
          fichiers : une seule fenêtre). Rien n’est rangé sans ton clic. Ajouté à l’installation,
          retiré à la désinstallation.
        </p>
        <p>
          Clic droit : <strong>{s.menu ? 'présent' : 'absent'}</strong> · Envoyer vers :{' '}
          <strong>{s.sendTo ? 'présent' : 'absent'}</strong>
        </p>
        {error && <p className="error">{error}</p>}
        {on ? (
          <Button variant="secondary" disabled={busy} onClick={() => set(false)}>
            Retirer du clic droit et d’« Envoyer vers »
          </Button>
        ) : null}
        {!(s.menu && s.sendTo) ? (
          <Button disabled={busy} onClick={() => set(true)}>
            {on ? 'Remettre ce qui manque' : 'Remettre dans le clic droit et « Envoyer vers »'}
          </Button>
        ) : null}
      </Card>
    </div>
  );
}
