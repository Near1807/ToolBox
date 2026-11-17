// v0.41.0: Réglages › Synchro › « Réseaux et adresses » (PC). To see alone
// where the synchronisation passes and where it does not: the PC's addresses
// now, the network's name and its Windows profile (Privé / Public / Domaine),
// the listener and the announcement; the networks where an exchange was
// tried (named by Thomas, « Oublier » with « Annuler »); the last 50 attempts.
// READ and display only: opening this page connects nothing, listens to
// nothing, changes no setting (the Windows profile is read, never changed).
import { useCallback, useEffect, useState } from 'react';
import { api, Button, Card, errorMessage, openEventStream, UndoToast } from '@hub/sdk/frontend';
import { PUBLIC_NETWORK, type KnownNetwork } from '../../../../backend/core/sync/diagnostics';
import type { SyncNetworks } from '../../../../backend/core/sync/server';
import { AttemptList, shortDate } from '../sync-history';

const CATEGORY: Record<string, string> = {
  private: 'Privé',
  public: 'Public',
  domain: 'Domaine',
};

function KnownRow(props: {
  network: KnownNetwork;
  onSaved: (n: SyncNetworks) => void;
  onForgot: (gone: KnownNetwork) => void;
  onError: (e: string) => void;
}) {
  const n = props.network;
  const [label, setLabel] = useState(n.label ?? '');
  const changed = (label.trim() || null) !== n.label;
  const save = () =>
    api
      .put<SyncNetworks>(`/api/core/sync/networks/${encodeURIComponent(n.key)}`, {
        label: label.trim() || null,
      })
      .then(props.onSaved, (e: unknown) => props.onError(errorMessage(e)));
  return (
    <li className="sync-network">
      <div className="sync-network__head">
        <input
          className="input input--short"
          value={label}
          maxLength={40}
          placeholder={n.network ?? 'Nom (ex. Kot)'}
          aria-label={`Nom de ce réseau (${n.network ?? n.addresses.join(', ')})`}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && changed) void save();
          }}
        />
        {changed && (
          <Button small onClick={() => void save()}>
            Enregistrer
          </Button>
        )}
        <Button
          small
          variant="secondary"
          onClick={() => {
            if (
              !window.confirm(
                `Oublier « ${n.label ?? n.network ?? n.addresses.join(', ')} » ?\n\nSeule cette ligne est oubliée : l’appairage et les données ne changent pas. « Annuler » juste après.`,
              )
            )
              return;
            void api
              .delete<{ forgotten: KnownNetwork; networks: SyncNetworks }>(
                `/api/core/sync/networks/${encodeURIComponent(n.key)}`,
              )
              .then(
                (r) => {
                  props.onSaved(r.networks);
                  props.onForgot(r.forgotten);
                },
                (e: unknown) => props.onError(errorMessage(e)),
              );
          }}
        >
          Oublier
        </Button>
      </div>
      <p className="small">
        {n.network ? <>Réseau Windows « {n.network} » · </> : null}
        Adresse du PC : {n.addresses.join(', ')}
      </p>
      <p className="small muted">
        {n.firstOk
          ? `Première synchro réussie : ${shortDate(n.firstOk)} · dernière : ${shortDate(n.lastOk!)}`
          : 'Aucune synchro réussie ici.'}
      </p>
      {n.lastFail && (
        <p className="small sync-network__fail">
          Dernier échec ({shortDate(n.lastFail.at)}) : {n.lastFail.reason}
        </p>
      )}
    </li>
  );
}

export function NetworksCard() {
  const [data, setData] = useState<SyncNetworks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgotten, setForgotten] = useState<KnownNetwork | null>(null);
  const load = useCallback(
    (refresh: boolean) =>
      api
        .get<SyncNetworks>(`/api/core/sync/networks${refresh ? '' : '?refresh=0'}`)
        .then(setData, (e: unknown) => setError(errorMessage(e))),
    [],
  );
  // At the opening: the Windows profiles read again (read only); then on each change.
  useEffect(() => {
    void load(true);
    return openEventStream('/api/core/sync/stream', { witness: () => void load(false) });
  }, [load]);
  if (!data) return <Card title="Réseaux et adresses">{error ?? 'Chargement…'}</Card>;
  return (
    <>
      <Card
        title={
          <>
            Ce PC maintenant{' '}
            <span className="badge badge--warning" title="Pas encore validé à l’usage">
              Expérimental
            </span>
          </>
        }
      >
        {data.publicNetwork && <p className="error">{PUBLIC_NETWORK}</p>}
        {error && <p className="error">{error}</p>}
        {data.current.length === 0 ? (
          <p>Aucun réseau local : le PC n’est relié à aucun Wi-Fi ni câble.</p>
        ) : (
          <ul className="sync-networks">
            {data.current.map((n) => (
              <li key={`${n.alias}:${n.address}`}>
                <strong>{n.name ?? n.alias}</strong> · {n.address} ·{' '}
                {n.category ? (
                  <span
                    className={
                      n.category === 'public' ? 'badge badge--warning' : 'badge badge--success'
                    }
                  >
                    {CATEGORY[n.category]}
                  </span>
                ) : (
                  <span className="muted">type de réseau inconnu</span>
                )}
                {n.category === 'public' && !data.publicNetwork && (
                  <span className="small muted"> (Windows bloque la synchro sur ce réseau-ci)</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          Écoute : {data.listening ? `active (port ${data.port})` : 'arrêtée'} · Annonce sur le
          réseau (mDNS) : {data.announced ? 'active' : 'arrêtée'}. Cette page ne fait que lire :
          elle ne change ni l’écoute, ni le profil du réseau, ni le pare-feu.
        </p>
      </Card>
      <Card title="Réseaux connus">
        <p className="small muted">
          Les réseaux où le téléphone a essayé de se synchroniser avec ce PC. Donne-leur un nom
          (Kot, Maison…) pour t’y retrouver.
        </p>
        {data.known.length === 0 ? (
          <p className="small">Aucun pour l’instant.</p>
        ) : (
          <ul className="sync-networks">
            {data.known.map((n) => (
              <KnownRow
                key={`${n.key}:${n.label ?? ''}`}
                network={n}
                onSaved={setData}
                onForgot={setForgotten}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Derniers essais (${data.attempts.length} sur 50 au plus)`}>
        <AttemptList attempts={data.attempts} />
      </Card>
      {forgotten && (
        <UndoToast
          message={`« ${forgotten.label ?? forgotten.network ?? forgotten.addresses.join(', ')} » oublié`}
          onUndo={() => {
            const entry = forgotten;
            setForgotten(null);
            void api
              .post<SyncNetworks>('/api/core/sync/networks/restore', { entry })
              .then(setData, (e: unknown) => setError(errorMessage(e)));
          }}
          onDismiss={() => setForgotten(null)}
        />
      )}
    </>
  );
}
