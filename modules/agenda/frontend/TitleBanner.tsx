// v0.41.0: « De meilleurs titres sont disponibles » (PC): a source whose
// events would get better titles from their original text (« Recalculer les
// titres »). Only offered, never applied; closed, it does not come back for
// the same source until the number of titles to change changes (a choice of
// this device, kept locally).
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon, useModule } from '@hub/sdk/frontend';

interface TitleUpdate {
  id: string;
  name: string;
  count: number;
}

const KEY = 'toolbox.agenda.titleBannerClosed';

function readClosed(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function TitleBanner() {
  const module = useModule();
  const [updates, setUpdates] = useState<TitleUpdate[]>([]);
  const [closed, setClosed] = useState<Record<string, number>>(readClosed);
  useEffect(() => {
    let live = true;
    module.api.get<TitleUpdate[]>('/title-updates').then(
      (u) => live && setUpdates(u),
      () => live && setUpdates([]),
    );
    return () => {
      live = false;
    };
  }, [module.api]);
  const shown = updates.filter((u) => closed[u.id] !== u.count);
  if (!shown.length) return null;
  const close = (u: TitleUpdate) => {
    const next = { ...closed, [u.id]: u.count };
    setClosed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not kept: it comes back next time.
    }
  };
  return (
    <>
      {shown.map((u) => (
        <p key={u.id} className="ag-banner" role="status">
          <span>
            De meilleurs titres sont disponibles pour « {u.name} » ({u.count}{' '}
            {u.count > 1 ? 'événements' : 'événement'}) —{' '}
            <Link to={`/m/agenda/import?recompute=${u.id}`}>Voir</Link>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Fermer (ne revient pas pour « ${u.name} » tant que rien ne change)`}
            title="Fermer"
            onClick={() => close(u)}
          >
            <Icon name="close" />
          </button>
        </p>
      ))}
    </>
  );
}
