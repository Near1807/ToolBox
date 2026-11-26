// v0.46.0: the disk's Recycle Bin (in the Coffre's Recycle Bin page) — what
// was deleted from the Coffre stays there; « Récupérer » while it is there;
// « Effacer définitivement » only confirmed. After 30 days ToolBox PROPOSES to
// erase (the list, then a confirmation): never on its own.
import { useState } from 'react';
import { Button, formatBytes, useApi, useModule } from '@hub/sdk/frontend';
import type { DiskStatusDto } from '../../shared/types';
import { useCoffre } from '../frame';
import { shortDate } from '../logic';

interface Entry {
  itemId: string;
  name: string;
  size: number;
  trashedAt: string | null;
  old: boolean;
  onPc: boolean;
  folderPath: string[];
}

export function DiskTrash(props: { status: DiskStatusDto | null }) {
  const module = useModule();
  const coffre = useCoffre();
  const list = useApi<Entry[]>(module.url('/disk/trash'));
  const [busy, setBusy] = useState(false);
  const s = props.status;
  if (!s?.disk) return null;
  const entries = list.data ?? [];
  const old = entries.filter((e) => e.old);
  const connected = s.connected;

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
      list.reload();
      coffre.refresh();
    } catch (e) {
      coffre.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const recover = (e: Entry) =>
    run(async () => {
      if (e.onPc) await module.api.post(`/files/${e.itemId}/restore`);
      else await module.api.post('/disk/trash/recover', { itemId: e.itemId });
      coffre.notify(`« ${e.name} » est revenu dans le Coffre.`);
    });
  const erase = (chosen: Entry[]) => {
    const names = chosen
      .slice(0, 12)
      .map((e) => `· ${e.name}`)
      .join('\n');
    const more = chosen.length > 12 ? `\n… et ${chosen.length - 12} autres` : '';
    if (
      !window.confirm(
        `Effacer définitivement du disque ${chosen.length > 1 ? `ces ${chosen.length} éléments` : 'cet élément'} ?\n\n${names}${more}\n\nIls ne pourront plus être récupérés.`,
      )
    )
      return;
    void run(async () => {
      const r = await module.api.post<{ erased: number }>('/disk/trash/erase', {
        itemIds: chosen.map((e) => e.itemId),
        confirm: true,
      });
      coffre.notify(`${r.erased} effacé${r.erased > 1 ? 's' : ''} définitivement du disque.`);
    });
  };

  return (
    <section className="coffre-section coffre-disktrash">
      <h2 className="coffre-h2">Corbeille du disque « {s.disk.name} »</h2>
      <p className="muted small">
        Ce que tu supprimes du Coffre y reste après la mise à jour du disque. Rien n'y est effacé
        sans ta confirmation.
        {!connected && ' Branche le disque pour récupérer ou effacer.'}
      </p>
      {old.length > 0 && (
        <div className="coffre-proposal" role="status">
          <span>
            {old.length} élément{old.length > 1 ? 's' : ''} dans la corbeille du disque depuis plus
            de 30 jours ({formatBytes(old.reduce((t, e) => t + e.size, 0))}). Les effacer pour
            libérer de la place ?
          </span>
          <Button variant="danger" small disabled={!connected || busy} onClick={() => erase(old)}>
            Voir et effacer…
          </Button>
        </div>
      )}
      {list.data && !entries.length && <p className="muted">La corbeille du disque est vide.</p>}
      {entries.length > 0 && (
        <table className="coffre-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Venait de</th>
              <th>Dans la corbeille du disque</th>
              <th>Taille</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.itemId}>
                <td className="coffre-table__name">{e.name}</td>
                <td>{e.folderPath.join(' › ') || 'À ranger'}</td>
                <td>
                  {shortDate(e.trashedAt)}
                  {e.old && <span className="coffre-chip coffre-chip--warn">plus de 30 jours</span>}
                </td>
                <td className="coffre-table__num">{formatBytes(e.size)}</td>
                <td className="coffre-table__actions">
                  <Button
                    variant="secondary"
                    small
                    disabled={busy || (!e.onPc && !connected)}
                    title={
                      e.onPc
                        ? 'Encore dans la corbeille du Coffre sur ce PC'
                        : 'Recopié depuis le disque'
                    }
                    onClick={() => void recover(e)}
                  >
                    Récupérer
                  </Button>
                  <Button
                    variant="danger"
                    small
                    disabled={busy || !connected}
                    onClick={() => erase([e])}
                  >
                    Effacer définitivement
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
