// Card of the home page: what to publish today (and what is late).
import { useApi, useModule } from '@hub/sdk/frontend';
import { CopyCaption, DragPreview, PlatformIcon } from './ItemParts';
import type { PlannerItem, Summary } from './types';

export function HomeWidget() {
  const module = useModule();
  const { data } = useApi<{
    today: PlannerItem[];
    late: PlannerItem[];
    account: { connected: boolean; needsReconnect: boolean };
  }>(module.url('/today'));
  const { data: summary } = useApi<Summary>(module.url('/summary'));
  if (!data) return null;
  const reconnect = (
    <>
      {data.account.connected && data.account.needsReconnect && (
        <p className="small rp-text-danger">
          ⚠ Compte Google à reconnecter : envois YouTube en attente.
        </p>
      )}
      {summary?.alerts.map((alert) => (
        <p key={alert.releaseId} className="small rp-text-danger">
          ⚠ {alert.level} : {alert.count} vidéo(s) YouTube de « {alert.trackTitle} » pas encore
          envoyée(s).
        </p>
      ))}
    </>
  );
  const todo = [...data.late, ...data.today].filter(
    (item) => item.status !== 'published' && item.status !== 'scheduled',
  );
  const scheduled = data.today.filter((item) => item.status === 'scheduled').length;
  if (todo.length === 0) {
    return (
      <>
        {reconnect}
        <p className="small rp-widget__empty">
          Rien à publier à la main aujourd’hui
          {scheduled > 0 ? ` · ${scheduled} sortie(s) YouTube programmée(s)` : ''}.
        </p>
      </>
    );
  }
  return (
    <div className="rp-widget">
      {reconnect}
      <p className="small">
        <strong>Aujourd’hui : {todo.length} à publier</strong>
        {data.late.length > 0 && (
          <span className="rp-text-danger"> · {data.late.length} en retard</span>
        )}
      </p>
      <ul>
        {todo.slice(0, 3).map((item) => (
          <li key={item.id}>
            <DragPreview item={item} />
            <span className="rp-widget__text">
              <PlatformIcon kind={item.kind} size={13} /> {item.label}
              <span className="muted"> · {item.trackTitle}</span>
            </span>
            {item.platform === 'instagram' && item.caption && (
              <CopyCaption text={item.caption} label="Légende" />
            )}
          </li>
        ))}
      </ul>
      {todo.length > 3 && <p className="muted small">… et {todo.length - 3} autre(s)</p>}
    </div>
  );
}
