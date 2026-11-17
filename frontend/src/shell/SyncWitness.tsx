// v0.41.0: the PC's synchronisation witness, always in view (side bar, near
// Réglages): « Synchro arrêtée », « En attente du téléphone », « Synchronisé
// · il y a 5 min », « Synchro bloquée » and why. The same states as the
// phone's indicator. Updated on an event (an exchange, the listener turned on
// or off, a change of network), never by a tight polling. READ ONLY: it
// connects nothing, listens to nothing, changes no setting. A click opens
// Réglages › Synchro (« Réseaux et adresses » when it is blocked).
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { openEventStream } from '@hub/sdk/frontend';
import type { Witness } from '../../../backend/core/sync/diagnostics';

export function SyncWitness() {
  const [w, setW] = useState<Witness | null>(null);
  useEffect(
    () => openEventStream('/api/core/sync/stream', { witness: (data) => setW(data as Witness) }),
    [],
  );
  if (!w) return null;
  return (
    <Link
      to={w.state === 'blocked' ? '/settings?s=sync&tab=networks' : '/settings?s=sync'}
      className={`nav-link sync-witness sync-witness--${w.state}`}
      title={[w.text, w.detail].filter(Boolean).join('\n')}
      aria-label={`Synchro avec le téléphone : ${[w.text, w.detail].filter(Boolean).join('. ')}`}
    >
      <RefreshCw size={16} />
      <span className="nav-link__label">{w.text}</span>
      <span className="sync-witness__dot" aria-hidden="true" />
    </Link>
  );
}
