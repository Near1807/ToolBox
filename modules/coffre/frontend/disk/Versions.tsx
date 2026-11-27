// v0.46.0: « Versions sur le disque » in the preview — the old versions kept
// in the disk's history (date, size) and « Restaurer cette version »
// (confirmed; « Annuler » in the message).
import { useState } from 'react';
import { Button, formatBytes, useApi, useModule } from '@hub/sdk/frontend';
import type { ItemDto } from '../../shared/types';
import { useCoffre } from '../frame';

interface VersionsDto {
  versions: { id: string; name: string; size: number; savedAt: string }[];
  connected: boolean;
  diskName: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function Versions(props: {
  item: ItemDto;
  onRestored: () => void;
  /** v0.51.0 C: one file inside the project `item` (its own versions). */
  rel?: string;
}) {
  const module = useModule();
  const coffre = useCoffre();
  const { item, rel } = props;
  const data = useApi<VersionsDto>(
    module.url(`/files/${item.id}/versions${rel ? `?rel=${encodeURIComponent(rel)}` : ''}`),
  );
  const label = rel ?? item.name;
  const [busy, setBusy] = useState<string | null>(null);
  if (!data.data?.diskName) return null;
  const v = data.data;
  const restore = async (id: string, savedAt: string) => {
    if (
      !window.confirm(
        `Restaurer la version du ${when(savedAt)} de « ${label} » ?\n\nElle redevient la version actuelle sur ce PC ; l'actuelle est gardée dans l'historique du disque. Tu pourras « Annuler » juste après.`,
      )
    )
      return;
    setBusy(id);
    try {
      const r = await module.api.post<{ undoId: string }>(
        `/files/${item.id}/versions/${id}/restore`,
        {
          confirm: true,
        },
      );
      coffre.notify(`Version du ${when(savedAt)} restaurée.`, r.undoId);
      coffre.refresh();
      data.reload();
      props.onRestored();
    } catch (e) {
      coffre.fail(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="coffre-versions" data-coffre-versions={rel ?? ''}>
      <h3>Versions sur le disque</h3>
      {!v.versions.length && <p className="muted small">Aucune ancienne version pour l'instant.</p>}
      {v.versions.length > 0 && !v.connected && (
        <p className="muted small">
          Branche le disque « {v.diskName} » pour restaurer une version.
        </p>
      )}
      <ul>
        {v.versions.map((x) => (
          <li key={x.id}>
            <span>
              {when(x.savedAt)} <span className="muted">· {formatBytes(x.size)}</span>
            </span>
            <Button
              variant="secondary"
              small
              disabled={!v.connected || item.diskState === 'archived' || busy !== null}
              title={item.diskState === 'archived' ? 'Archivé : le réactiver d’abord' : undefined}
              onClick={() => void restore(x.id, x.savedAt)}
            >
              {busy === x.id ? 'Restauration…' : 'Restaurer cette version'}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
