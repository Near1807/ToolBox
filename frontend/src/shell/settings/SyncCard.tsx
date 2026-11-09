// Réglages › « Synchro avec le téléphone » (ADR 0044). The listener on the
// local network is OFF until Thomas turns it on here (with a confirmation
// that explains the Windows firewall); then « Appairer un téléphone » shows a
// QR code (address, single-use token, certificate's fingerprint) and the
// same code as text. The paired phones, « Oublier cet appareil », and the
// conflicts (value kept, value set aside), with « Fusionner » for two names.
import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api, Button, Card, errorMessage, useApi } from '@hub/sdk/frontend';

interface Status {
  enabled: boolean;
  listening: boolean;
  port: number;
  addresses: string[];
  fingerprint: string | null;
  device: string;
  peers: {
    device_id: string;
    name: string;
    created_at: string;
    first_sync_at: string | null;
    last_sync_at: string | null;
  }[];
  refusal: string | null;
  conflicts: number;
  error: string | null;
  announced: boolean;
  announceError: string | null;
}

interface Conflict {
  id: string;
  created_at: string;
  kind: string;
  scope: string;
  field: string | null;
  label: string;
  kept: string | null;
  discarded: string | null;
  kept_device: string | null;
  discarded_device: string | null;
  resolved_at: string | null;
  resolution: string | null;
  other_id: string | null;
}

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-BE', { dateStyle: 'medium', timeStyle: 'short' })
    : 'jamais';

/** The QR code, drawn in the theme's colours (the decoder reads both ways). */
function Qr(props: { text: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(props.text);
  qr.make();
  const n = qr.getModuleCount();
  const cells: string[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c + 4} ${r + 4}h1v1h-1z`);
  return (
    <svg
      className="sync-qr"
      viewBox={`0 0 ${n + 8} ${n + 8}`}
      role="img"
      aria-label="QR code d’appairage"
    >
      <path d={cells.join('')} fill="currentColor" />
    </svg>
  );
}

const shown = (json: string | null) => {
  if (json === null) return '—';
  try {
    const v = JSON.parse(json) as unknown;
    return v === null ? '(vide)' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  } catch {
    return json;
  }
};

function Conflicts(props: { status: Status; onChange: () => void }) {
  const list = useApi<{ conflicts: Conflict[] }>('/api/core/sync/conflicts');
  const [error, setError] = useState<string | null>(null);
  const device = (id: string | null) =>
    id === props.status.device
      ? 'ce PC'
      : (props.status.peers.find((p) => p.device_id === id)?.name ?? 'téléphone');
  const act = (path: string) =>
    api.post(path).then(
      () => {
        list.reload();
        props.onChange();
      },
      (e: unknown) => setError(errorMessage(e)),
    );
  const open = (list.data?.conflicts ?? []).filter((c) => !c.resolved_at);
  return (
    <>
      <p className="small muted">
        Un même élément changé des deux côtés entre deux synchros : la valeur la plus récente est
        gardée, l’autre est ici. Les noms en double ne sont jamais fusionnés seuls.
      </p>
      {error && <p className="error">{error}</p>}
      {open.length === 0 ? (
        <p className="muted">Aucun conflit à regarder.</p>
      ) : (
        <ul className="list">
          {open.map((c) => (
            <li key={c.id} className="list__item sync-conflict">
              <div>
                <strong>{c.label}</strong>
                <div className="small muted">
                  {c.field ? `champ ${c.field} · ` : ''}
                  {when(c.created_at)}
                </div>
                {c.kind !== 'name' && (c.kept !== null || c.discarded !== null) && (
                  <div className="small">
                    Gardée ({device(c.kept_device)}) : {shown(c.kept)} · écartée (
                    {device(c.discarded_device)}) : {shown(c.discarded)}
                  </div>
                )}
              </div>
              <span className="ui-actions">
                {c.kind === 'name' && c.other_id && (
                  <Button
                    small
                    onClick={() =>
                      window.confirm(`Fusionner les deux ?\n\n${c.label}`) &&
                      void act(`/api/core/sync/conflicts/${c.id}/merge`)
                    }
                  >
                    Fusionner
                  </Button>
                )}
                <Button
                  small
                  variant="secondary"
                  onClick={() => void act(`/api/core/sync/conflicts/${c.id}/dismiss`)}
                >
                  Vu
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SyncCard() {
  const status = useApi<Status>('/api/core/sync');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
    address: string;
  } | null>(null);
  const [address, setAddress] = useState('');
  const [addressCode, setAddressCode] = useState<{ code: string; address: string } | null>(null);
  const s = status.data;
  // The code expires (10 minutes): hidden then.
  useEffect(() => {
    if (!pairing) return;
    const t = setTimeout(() => setPairing(null), Date.parse(pairing.expiresAt) - Date.now());
    return () => clearTimeout(t);
  }, [pairing]);
  const run = (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    task()
      .then(() => status.reload())
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  if (!s) return <Card title="Synchro avec le téléphone">{status.error ?? 'Chargement…'}</Card>;
  return (
    <>
      <Card
        title={
          <>
            Synchro avec le téléphone{' '}
            <span className="badge badge--warning" title="Pas encore validé à l’usage">
              Expérimental
            </span>
          </>
        }
      >
        <p>
          Échange les données de Courses, To-do, Sport, Boîte à idées et Timer avec l’appli ToolBox
          du téléphone, sur ton Wi-Fi, sans Internet ni cloud. La musique ne quitte jamais le PC.
        </p>
        {s.refusal && <p className="error">{s.refusal}</p>}
        {s.error && <p className="error">{s.error}</p>}
        {error && <p className="error">{error}</p>}
        {!s.enabled ? (
          <>
            <p className="small muted">
              Désactivée : le PC n’écoute pas le réseau local (aucun port ouvert).
            </p>
            <Button
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `Activer la synchro avec le téléphone ?\n\nLe PC écoutera sur ton réseau local (port ${s.port}), en HTTPS, uniquement pour les téléphones que tu appaires.\n\nWindows va sans doute afficher « Pare-feu Windows : autoriser l’accès » pour ToolBox : coche « Réseaux privés » (ton Wi-Fi de la maison) et pas « Réseaux publics », puis Autoriser.`,
                  )
                )
                  return;
                run(() => api.put('/api/core/sync', { enabled: true }));
              }}
            >
              Activer la synchro
            </Button>
          </>
        ) : (
          <>
            <p className="small">
              Activée : écoute sur le réseau local, port <strong>{s.port}</strong>
              {s.listening ? '' : ' (pas encore à l’écoute)'}.
              {s.addresses.length > 0 && <> Adresse du PC : {s.addresses.join(', ')}.</>}
            </p>
            <div className="ui-actions">
              {s.addresses.length > 1 && (
                <select
                  className="input input--short"
                  value={address}
                  aria-label="Réseau à utiliser"
                  onChange={(e) => setAddress(e.target.value)}
                >
                  <option value="">{s.addresses[0]}</option>
                  {s.addresses.slice(1).map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              )}
              <Button
                disabled={busy || !s.listening}
                onClick={() =>
                  run(async () => {
                    setAddressCode(null);
                    setPairing(
                      await api.post<{ code: string; expiresAt: string; address: string }>(
                        '/api/core/sync/pairing',
                        { address: address || undefined },
                      ),
                    );
                  })
                }
              >
                Appairer un téléphone
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !s.listening}
                onClick={() =>
                  run(async () => {
                    setPairing(null);
                    setAddressCode(
                      await api.post<{ code: string; address: string }>(
                        '/api/core/sync/address-code',
                        { address: address || undefined },
                      ),
                    );
                  })
                }
              >
                QR de l’adresse
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  window.confirm(
                    'Désactiver la synchro ? Le PC n’écoutera plus le réseau local.',
                  ) && run(() => api.put('/api/core/sync', { enabled: false }))
                }
              >
                Désactiver
              </Button>
            </div>
            {pairing && (
              <div className="sync-pairing">
                <Qr text={pairing.code} />
                <div>
                  <p>
                    Sur le téléphone : <strong>Plus › Réglages › Synchro avec le PC</strong> › «
                    Photographier le QR code ». Ou tape ce code :
                  </p>
                  <p className="sync-code">{pairing.code}</p>
                  <p className="small muted">
                    Valable une seule fois, jusqu’à {when(pairing.expiresAt)}. Il contient l’adresse
                    du PC ({pairing.address}), un jeton secret et l’empreinte du certificat du PC.
                  </p>
                </div>
              </div>
            )}
            {addressCode && (
              <div className="sync-pairing">
                <Qr text={addressCode.code} />
                <div>
                  <p>
                    Pour un téléphone <strong>déjà appairé</strong>, quand le PC a changé de réseau
                    : sur le téléphone, <strong>Synchro avec le PC › Nouvelle adresse du PC</strong>
                    . Ou tape ce code :
                  </p>
                  <p className="sync-code">{addressCode.code}</p>
                  <p className="small muted">
                    Il contient seulement l’adresse du PC ({addressCode.address}), son port et
                    l’empreinte de son certificat : aucun jeton. Il ne permet pas d’appairer un
                    autre téléphone.
                  </p>
                </div>
              </div>
            )}
            <p className="small muted">
              Repérage sur le réseau{' '}
              <span className="badge badge--warning" title="Pas encore validé à l’usage">
                Expérimental
              </span>{' '}
              :{' '}
              {s.announced
                ? 'le PC s’annonce sur le réseau local (mDNS) pour que le téléphone le retrouve sur n’importe quel Wi-Fi.'
                : 'le PC ne s’annonce pas.'}
              {s.announceError ? ` ${s.announceError}` : ''} Le téléphone garde aussi toutes les
              adresses où il a trouvé le PC.
            </p>
            {s.fingerprint && (
              <p className="small muted">
                Empreinte du certificat du PC :{' '}
                <span className="sync-code">{s.fingerprint.slice(0, 47)}…</span>
              </p>
            )}
          </>
        )}
      </Card>
      <Card title="Appareils appairés">
        {s.peers.length === 0 ? (
          <p className="muted">Aucun téléphone appairé.</p>
        ) : (
          <ul className="list">
            {s.peers.map((p) => (
              <li key={p.device_id} className="list__item">
                <div>
                  <strong>{p.name}</strong>
                  <div className="small muted">
                    appairé le {when(p.created_at)} · dernière synchro : {when(p.last_sync_at)}
                  </div>
                </div>
                <Button
                  small
                  variant="danger"
                  onClick={() =>
                    window.confirm(
                      `Oublier « ${p.name} » ?\n\nSon accès est révoqué tout de suite : il devra être appairé de nouveau pour synchroniser. Ses données restent sur lui.`,
                    ) && run(() => api.delete(`/api/core/sync/peers/${p.device_id}`))
                  }
                >
                  Oublier cet appareil
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Conflits${s.conflicts ? ` (${s.conflicts})` : ''}`}>
        <Conflicts status={s} onChange={() => status.reload()} />
      </Card>
    </>
  );
}
