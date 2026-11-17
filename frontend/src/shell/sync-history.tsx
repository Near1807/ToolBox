// v0.41.0: what the PC and the phone show of their synchronisation's
// attempts (« Réseaux et adresses »): the last 50, newest first, done or why
// not. Shared by the PC's Réglages and the phone's Synchro page (read only).
import type { SyncAttempt } from '../../../backend/core/sync/diagnostics';

/** « 17/11 14:05 ». */
export const shortDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function AttemptList(props: { attempts: SyncAttempt[] }) {
  if (!props.attempts.length)
    return <p className="small muted">Aucun essai de synchro enregistré sur cet appareil.</p>;
  return (
    <ul className="sync-attempts">
      {props.attempts.map((a, i) => (
        <li
          key={`${a.at}:${i}`}
          className={a.ok ? 'sync-attempt' : 'sync-attempt sync-attempt--fail'}
        >
          <span className="sync-attempt__when">{shortDate(a.at)}</span>
          <span className="sync-attempt__where">{a.where}</span>
          <span className="sync-attempt__what">
            {a.ok ? `Réussi${a.peer ? ` (${a.peer})` : ''}` : (a.reason ?? 'Échec')}
          </span>
        </li>
      ))}
    </ul>
  );
}
