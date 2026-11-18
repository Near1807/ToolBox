// v0.41.0: Synchro › « Réseaux et adresses » (phone): the PC's addresses this
// phone knows (where it reached the PC: home, kot, school…), with the name
// Thomas gives them, the first and last synchronisation that worked there,
// the last failure and why; « Oublier » (the address only, never the pairing
// nor the data) with a confirmation and « Annuler »; the last 50 attempts.
// The Wi-Fi's name is NOT read (Android asks the location permission for
// it): the address and the name Thomas gives say where it is.
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, errorMessage, UndoToast } from '@hub/sdk/frontend';
import type { AddressInfo, PhoneDiagnostics } from '../../../packages/phone/sync-client';
import type { WorkerClient } from '../../../packages/phone/transport';
import { AttemptList, shortDate } from '../../../frontend/src/shell/sync-history';

const SOURCES: Record<string, string> = {
  appairage: 'à l’appairage',
  pc: 'donnée par le PC',
  reseau: 'trouvée sur le réseau',
  qr: 'QR de l’adresse',
};

function AddressRow(props: {
  address: AddressInfo;
  current: boolean;
  onLabel: (label: string | null) => Promise<void>;
  onForget: () => void;
}) {
  const a = props.address;
  const [label, setLabel] = useState(a.label ?? '');
  const changed = (label.trim() || null) !== a.label;
  return (
    <li className="sync-network">
      <div className="sync-network__head">
        <input
          className="input"
          value={label}
          maxLength={40}
          placeholder="Nom (ex. Kot, Maison)"
          aria-label={`Nom de l’adresse ${a.url.replace('https://', '')}`}
          onChange={(e) => setLabel(e.target.value)}
        />
        {changed && (
          <Button small onClick={() => void props.onLabel(label.trim() || null)}>
            Enregistrer
          </Button>
        )}
      </div>
      <p className="small">
        {a.url.replace('https://', '')}
        {props.current && <strong> · adresse actuelle</strong>}
        <span className="muted"> · {SOURCES[a.source] ?? a.source}</span>
      </p>
      <p className="small muted">
        {a.last_ok_at
          ? `${a.firstOk ? `Première synchro réussie : ${shortDate(a.firstOk)} · ` : ''}PC joint pour la dernière fois : ${shortDate(a.last_ok_at)}`
          : 'Le PC n’a encore jamais répondu ici.'}
      </p>
      {a.lastFail && (
        <p className="small sync-network__fail">
          Dernier échec ({shortDate(a.lastFail.at)}) : {a.lastFail.reason}
        </p>
      )}
      <Button small variant="secondary" onClick={props.onForget}>
        Oublier
      </Button>
    </li>
  );
}

export function NetworksPage(props: { client: WorkerClient; currentUrl: string | null }) {
  const { client } = props;
  const [data, setData] = useState<PhoneDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgotten, setForgotten] = useState<AddressInfo | null>(null);
  const call = useCallback(
    <T,>(c: object) => client.call<T>({ kind: 'sync', call: c as never }),
    [client],
  );
  const load = useCallback(
    () =>
      call<PhoneDiagnostics>({ op: 'diagnostics' }).then(setData, (e: unknown) =>
        setError(errorMessage(e)),
      ),
    [call],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return <Card title="Réseaux et adresses">{error ?? 'Chargement…'}</Card>;
  return (
    <>
      <Card
        title={
          <>
            Où le téléphone trouve le PC{' '}
            <span className="badge badge--warning" title="Pas encore validé à l’usage">
              Expérimental
            </span>
          </>
        }
      >
        <p className="small muted">
          Les adresses du PC que ce téléphone connaît (maison, kot, école…). Donne-leur un nom pour
          t’y retrouver. « Oublier » retire seulement l’adresse : l’appairage et les données ne
          changent pas.
        </p>
        {error && <p className="error">{error}</p>}
        {data.addresses.length === 0 ? (
          <p className="small">Aucune adresse connue.</p>
        ) : (
          <ul className="sync-networks">
            {data.addresses.map((a) => (
              <AddressRow
                key={`${a.url}:${a.label ?? ''}`}
                address={a}
                current={a.url === props.currentUrl}
                onLabel={(label) =>
                  call({ op: 'labelAddress', url: a.url, label }).then(load, (e: unknown) =>
                    setError(errorMessage(e)),
                  )
                }
                onForget={() => {
                  if (
                    !window.confirm(
                      `Oublier l’adresse ${a.label ?? a.url.replace('https://', '')} ? L’appairage et les données ne changent pas.`,
                    )
                  )
                    return;
                  void call<AddressInfo | null>({ op: 'forgetAddress', url: a.url }).then(
                    (gone) => {
                      setForgotten(gone);
                      void load();
                    },
                    (e: unknown) => setError(errorMessage(e)),
                  );
                }}
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
          message={`Adresse ${forgotten.label ?? forgotten.url.replace('https://', '')} oubliée`}
          onUndo={() => {
            const address = forgotten;
            setForgotten(null);
            void call({ op: 'restoreAddress', address }).then(load, (e: unknown) =>
              setError(errorMessage(e)),
            );
          }}
          onDismiss={() => setForgotten(null)}
        />
      )}
    </>
  );
}
