// v0.47.0 (Expérimental): « Maintenant » on the Coffre's home — a course of
// the Agenda in progress or starting within 15 minutes: its name, when it
// ends, and its folder's elements, the most recent first. No Agenda, or no
// course now: nothing.
import { useEffect } from 'react';
import { Link } from 'react-router';
import { useApi, useModule } from '@hub/sdk/frontend';
import type { NowDto } from '../shared/types';
import { useCoffre } from './frame';
import { Items } from './Items';

const hm = (local: string) => local.slice(11, 16).replace(':', ' h ');

export function NowPanel() {
  const module = useModule();
  const coffre = useCoffre();
  const now = useApi<NowDto | null>(module.url('/now'));
  const { reload } = now;
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);
  const n = now.data;
  if (!n) return null;
  const c = n.course;
  return (
    <section className="coffre-section coffre-now" aria-label="Maintenant" data-coffre-now>
      <h2 className="coffre-h2">
        Maintenant <span className="badge badge--warning">Expérimental</span>
      </h2>
      <p className="coffre-now__course">
        <strong>{c.name}</strong>
        {c.code && <span className="muted"> · {c.code}</span>}
        <span>
          {' '}
          ·{' '}
          {c.inProgress
            ? `jusqu’à ${hm(c.end)}`
            : `commence à ${hm(c.start)}, jusqu’à ${hm(c.end)}`}
        </span>
        {c.location && <span className="muted"> · {c.location}</span>}
        {n.folder && (
          <>
            {' '}
            · <Link to={coffre.path(`c/${n.folder.id}`)}>{n.folder.path.join(' › ')}</Link>
          </>
        )}
      </p>
      {n.folder ? (
        <Items items={n.items} empty="Rien encore dans ce dossier." />
      ) : (
        <p className="muted small">
          Aucun dossier pour ce cours : nomme un dossier comme le cours (ou son code), ou choisis «
          Lié au cours » sur la page d’un dossier.
        </p>
      )}
    </section>
  );
}
