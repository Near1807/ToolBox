// « Synchro avec le PC » (ADR 0044): pair with the PC (photo of its QR code,
// or the code typed by hand), the first synchronisation (preview, then
// « Partir des données du PC » or « Fusionner », with confirmations and a
// copy before), then « Synchroniser » by hand. And « Conflits ».
// Nothing is sent or replaced without a tap; when the PC does not answer,
// nothing is lost: the changes wait.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Page, errorMessage, notifyDataChanged } from '@hub/sdk/frontend';
import type { ConflictRow, Preview } from '../../../backend/core/sync/engine';
import type { ExchangeResult } from '../../../backend/core/sync/protocol';
import {
  type FilesResult,
  type KnownAddress,
  type SyncState,
  type SyncWorkerCall,
} from '../../../packages/phone/sync-client';
import type { WorkerClient } from '../../../packages/phone/transport';
import { dateFr, type Shell } from './App';
import { takeCopy } from './backup';
import { autoLabel, autoSync, exclusive, setAutoSync, useAutoStatus } from './auto';
import { phoneSync } from './phone-sync';
import { readQrFromPhoto } from './qr-photo';

export const MODULE_NAMES: Record<string, string> = {
  todo: 'To-do',
  ideas: 'Boîte à idées',
  sport: 'Sport',
  timer: 'Timer',
  courses: 'Courses',
  core: 'Réglages',
};

const plural = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;

/** « 1 photo reçue · 1 en attente (prochaine synchro) », or '' when no picture moved. */
export function filesText(f: FilesResult | undefined): string {
  if (!f) return '';
  const parts = [
    f.received ? plural(f.received, 'photo reçue', 'photos reçues') : '',
    f.sent ? plural(f.sent, 'photo envoyée', 'photos envoyées') : '',
    f.pending
      ? `${plural(f.pending, 'photo en attente', 'photos en attente')} (prochaine synchro)`
      : '',
  ].filter(Boolean);
  return parts.length ? ` · ${parts.join(', ')}` : '';
}

export function resultText(r: ExchangeResult & { files?: FilesResult }): string {
  return `${plural(r.received, 'reçu', 'reçus')}, ${plural(r.sent, 'envoyé', 'envoyés')}, ${plural(r.conflicts, 'conflit', 'conflits')}${filesText(r.files)}`;
}

/** The state of the synchronisation (paired PC, last time, conflicts). */
export function useSyncState(client: WorkerClient) {
  const [state, setState] = useState<SyncState | null>(null);
  const reload = useCallback(
    () =>
      client
        .call<SyncState>({ kind: 'sync', call: { op: 'state' } })
        .then(setState, () => setState(null)),
    [client],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { state, reload };
}

/** « Synchroniser » (Accueil and this page): both ways, a summary after. */
export function SyncNowButton(props: { client: WorkerClient; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="m-sync-now">
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage(null);
          exclusive(() => phoneSync(props.client).now())
            .then(
              (r) => {
                setMessage({ ok: true, text: `Synchronisé : ${resultText(r)}.` });
                // The open screens of what came in are read again.
                if (r.scopes.length) notifyDataChanged(r.scopes);
                autoSync(props.client).resumeAfterManual();
              },
              (e: unknown) => setMessage({ ok: false, text: errorMessage(e) }),
            )
            .finally(() => {
              setBusy(false);
              props.onDone?.();
            });
        }}
      >
        {busy ? 'Synchronisation…' : 'Synchroniser'}
      </Button>
      {message && <p className={message.ok ? 'small' : 'error'}>{message.text}</p>}
    </div>
  );
}

/** A ToolBox code: photo of its QR code (camera or gallery), or typed by hand. */
function CodeEntry(props: {
  busy: boolean;
  photoLabel: string;
  typeLabel: string;
  placeholder: string;
  button: string;
  onCode: (code: string) => void;
  onError: (message: string) => void;
}) {
  const [code, setCode] = useState('');
  const [reading, setReading] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const busy = props.busy || reading;
  return (
    <>
      <div className="m-actions">
        <Button disabled={busy} onClick={() => photo.current?.click()}>
          {props.photoLabel}
        </Button>
      </div>
      <input
        ref={photo}
        type="file"
        accept="image/*"
        capture="environment"
        className="m-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setReading(true);
          readQrFromPhoto(file)
            .then(
              (text) =>
                text
                  ? props.onCode(text)
                  : props.onError(
                      'QR code introuvable sur la photo : rapproche-toi de l’écran, ou tape le code.',
                    ),
              () => props.onError('Photo illisible.'),
            )
            .finally(() => setReading(false));
        }}
      />
      <p className="small muted">{props.typeLabel}</p>
      <textarea
        className="input m-code"
        rows={3}
        value={code}
        placeholder={props.placeholder}
        aria-label={props.typeLabel}
        autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value)}
      />
      <div className="m-actions">
        <Button
          variant="secondary"
          disabled={busy || !code.trim()}
          onClick={() => props.onCode(code)}
        >
          {props.button}
        </Button>
      </div>
    </>
  );
}

/** The small state of the automatic synchronisation (Accueil, Synchro). */
export function AutoIndicator(props: { client: WorkerClient }) {
  const status = useAutoStatus(props.client);
  if (!status.enabled) return null;
  const label = autoLabel(status);
  return (
    <p className={`small m-auto m-auto--${label.tone}`} role="status">
      <span className="m-auto__dot" aria-hidden="true" />
      Synchro automatique : {label.text}
      {status.at
        ? ` (${new Date(status.at).toLocaleTimeString('fr-BE', { timeStyle: 'short' })})`
        : ''}
      {status.live ? ' · connecté au PC' : ''}
    </p>
  );
}

/**
 * « Synchro automatique » (off by default, Thomas turns it on): at opening,
 * back on screen, shortly after each change, and live from the PC while the
 * app is on screen. Never in the background, never the first synchronisation.
 */
function AutoCard(props: { client: WorkerClient }) {
  const status = useAutoStatus(props.client);
  const [busy, setBusy] = useState(false);
  return (
    <Card
      title={
        <>
          Synchro automatique{' '}
          <span className="badge badge--warning" title="Pas encore validé à l’usage">
            Expérimental
          </span>
        </>
      }
    >
      <label className="m-check">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={(e) => {
            setBusy(true);
            void setAutoSync(props.client, e.target.checked).finally(() => setBusy(false));
          }}
        />{' '}
        Synchroniser tout seul quand l’appli est ouverte
      </label>
      <p className="small muted">
        Activée : une synchro à l’ouverture et au retour sur l’appli, une autre quelques secondes
        après tes modifications, et ce que tu changes sur le PC arrive ici en une seconde environ
        tant que l’appli est ouverte. Rien quand l’appli est fermée (elle rattrape à l’ouverture).
        Jamais la première synchro, toujours avec ton choix. Versions différentes : elle s’arrête et
        le dit.
      </p>
      {status.enabled && <AutoIndicator client={props.client} />}
      {status.enabled && status.message && status.state !== 'ok' && (
        <p className="error small">{status.message}</p>
      )}
    </Card>
  );
}

function PairCard(props: { client: WorkerClient; onPaired: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pair = (value: string) => {
    setBusy(true);
    setError(null);
    phoneSync(props.client)
      .pair(value, 'Téléphone')
      .then(props.onPaired, (e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Card title="Appairer avec le PC">
      <p>
        Sur le PC : <strong>Réglages › Synchro avec le téléphone</strong> › active la synchro, puis
        « Appairer un téléphone ». Un QR code s’affiche.
      </p>
      <CodeEntry
        busy={busy}
        photoLabel="Photographier le QR code"
        typeLabel="Ou tape le code affiché sous le QR code (TBX1-…) :"
        placeholder="TBX1-XXXX-XXXX-…"
        button="Appairer avec ce code"
        onCode={pair}
        onError={setError}
      />
      {busy && <p className="small muted">Connexion au PC…</p>}
      {error && <p className="error">{error}</p>}
      <p className="small muted">
        Le téléphone ne parle qu’au PC dont le certificat correspond au code : jamais à un autre
        appareil du réseau. Rien ne passe par Internet.
      </p>
    </Card>
  );
}

/**
 * « Nouvelle adresse du PC » : the PC is on another network and none of the
 * known addresses answers. The code of « QR de l'adresse » (no token) gives
 * its address; its fingerprint must be the one of the paired PC. No new
 * pairing, no new first synchronisation.
 */
function NewAddressCard(props: { client: WorkerClient; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [known, setKnown] = useState<KnownAddress[]>([]);
  useEffect(() => {
    props.client
      .call<KnownAddress[]>({ kind: 'sync', call: { op: 'addresses' } })
      .then(setKnown, () => setKnown([]));
  }, [props.client, done]);
  const use = (value: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    phoneSync(props.client)
      .newAddress(value)
      .then(
        (url) => {
          setDone(`PC retrouvé à ${url.replace(/^https:\/\//, '')}. Tu peux synchroniser.`);
          setOpen(false);
          props.onDone();
        },
        (e: unknown) => setError(errorMessage(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Card title="Le PC sur un autre réseau">
      <p className="small">
        À chaque synchro, le téléphone essaie toutes les adresses où il a déjà trouvé le PC (maison,
        kot…), puis le cherche sur le Wi-Fi{' '}
        <span className="badge badge--warning">Expérimental</span>. Si rien ne répond : sur le PC,{' '}
        <strong>Réglages › Synchro avec le téléphone › QR de l’adresse</strong>, puis ici.
      </p>
      {known.length > 0 && (
        <p className="small muted">
          Adresses connues : {known.map((a) => a.url.replace(/^https:\/\//, '')).join(', ')}
        </p>
      )}
      {!open ? (
        <div className="m-actions">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Nouvelle adresse du PC
          </Button>
        </div>
      ) : (
        <CodeEntry
          busy={busy}
          photoLabel="Photographier le QR de l’adresse"
          typeLabel="Ou tape le code affiché sous ce QR code (TBXA-…) :"
          placeholder="TBXA-XXXX-XXXX-…"
          button="Utiliser cette adresse"
          onCode={use}
          onError={setError}
        />
      )}
      {busy && <p className="small muted">Connexion au PC…</p>}
      {done && <p className="small">{done}</p>}
      {error && <p className="error">{error}</p>}
      <p className="small muted">
        Sans réappairer ni refaire de première synchro : le téléphone vérifie que c’est bien ton PC
        (même certificat).
      </p>
    </Card>
  );
}

function FirstSyncCard(props: { shell: Shell; onDone: () => void }) {
  const { shell } = props;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    task()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  const first = (mode: 'merge' | 'replace') => {
    const question =
      mode === 'replace'
        ? 'Remplacer les données du téléphone (Courses, To-do, Sport, Boîte à idées, Timer) par celles du PC ?\n\nUne copie de sauvegarde du téléphone est faite avant (Réglages › Restaurer une copie), et le PC sauvegarde aussi sa base.'
        : 'Fusionner les deux appareils ? Tout ce qui est sur l’un ou l’autre sera sur les deux ; les noms en double iront dans « Conflits ».\n\nUne copie de sauvegarde du téléphone est faite avant, et le PC sauvegarde aussi sa base.';
    if (!window.confirm(question)) return;
    run(async () => {
      const r = await exclusive(() =>
        phoneSync(shell.client).first(mode, async () => {
          await takeCopy(shell.client, 'avant-synchro');
        }),
      );
      notifyDataChanged();
      autoSync(shell.client).resumeAfterManual();
      await shell.refresh();
      window.alert(
        `Première synchro faite${r.conflicts ? ` (${r.conflicts} élément(s) dans « Conflits »)` : ''}${filesText(r.files)}.`,
      );
      props.onDone();
    });
  };
  return (
    <Card title="Première synchro">
      <p>Avant tout échange, regarde ce qui changerait. Rien n’est écrit pendant l’aperçu.</p>
      <div className="m-actions">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => run(async () => setPreview(await phoneSync(shell.client).preview()))}
        >
          Voir l’aperçu
        </Button>
      </div>
      {preview && (
        <>
          {preview.tables.length === 0 ? (
            <p className="small">Les deux appareils ont déjà les mêmes données.</p>
          ) : (
            <ul className="m-preview">
              {Object.entries(
                preview.tables.reduce<
                  Record<string, { toPhone: number; toPc: number; diff: number }>
                >((acc, t) => {
                  const m = (acc[t.scope] ??= { toPhone: 0, toPc: 0, diff: 0 });
                  // The preview is computed by the PC: « here » is the PC.
                  m.toPhone += t.onlyHere;
                  m.toPc += t.onlyThere;
                  m.diff += t.different;
                  return acc;
                }, {}),
              ).map(([scope, m]) => (
                <li key={scope}>
                  <strong>{MODULE_NAMES[scope] ?? scope}</strong>
                  <span className="small">
                    PC → téléphone : {m.toPhone} · téléphone → PC : {m.toPc}
                    {m.diff ? ` · ${m.diff} différent(s) des deux côtés` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview.names.length > 0 && (
            <p className="small">
              <strong>Noms présents des deux côtés</strong> (ils iront dans « Conflits » si tu
              fusionnes, jamais fusionnés seuls) :{' '}
              {preview.names.map((n) => `${n.label.toLowerCase()} « ${n.name} »`).join(', ')}.
            </p>
          )}
          <div className="m-actions">
            <Button disabled={busy} onClick={() => first('replace')}>
              Partir des données du PC
            </Button>
            <p className="small muted">
              Les données du téléphone (5 modules) sont remplacées par celles du PC. Le bon choix si
              le téléphone n’a que des essais.
            </p>
            <Button variant="secondary" disabled={busy} onClick={() => first('merge')}>
              Fusionner les deux appareils
            </Button>
          </div>
        </>
      )}
      {busy && <p className="small muted">En cours…</p>}
      {error && <p className="error">{error}</p>}
    </Card>
  );
}

export function SyncPage(props: { shell: Shell }) {
  const { shell } = props;
  const { state, reload } = useSyncState(shell.client);
  const [asked, setAsked] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = Boolean(state?.peer?.first_sync_at);
  const paired = Boolean(state?.peer);
  // Not done on this phone: the PC says whether it is still to do (re-paired…).
  useEffect(() => {
    if (!paired || done) return;
    phoneSync(shell.client)
      .needsFirst()
      .then(setAsked, (e: unknown) => setError(errorMessage(e)));
  }, [paired, done, shell.client]);
  const first = done ? false : asked;

  if (!state) return <Page title="Synchro avec le PC">{null}</Page>;
  return (
    <Page title="Synchro avec le PC">
      {!state.peer ? (
        <PairCard client={shell.client} onPaired={() => void reload()} />
      ) : (
        <>
          <Card title="PC appairé">
            <p>
              Dernière synchro :{' '}
              <strong>
                {state.peer.last_sync_at ? dateFr(state.peer.last_sync_at) : 'pas encore'}
              </strong>
            </p>
            {first === false && (
              <SyncNowButton client={shell.client} onDone={() => void reload()} />
            )}
            <p className="small muted">
              À la main, quand tu veux : sur le même Wi-Fi que le PC, ToolBox ouvert sur le PC. Hors
              réseau, rien n’est perdu : tes changements attendent ici.
            </p>
            {error && <p className="error">{error}</p>}
          </Card>
          {first === true && <FirstSyncCard shell={shell} onDone={() => void reload()} />}
          {done && <AutoCard client={shell.client} />}
          <NewAddressCard client={shell.client} onDone={() => void reload()} />
          <Card title="Conflits">
            <p>
              {state.conflicts === 0
                ? 'Aucun conflit.'
                : `${state.conflicts} à regarder (valeur gardée, valeur écartée).`}
            </p>
            <Link to="/sync/conflicts" className="button button--secondary">
              Voir les conflits
            </Link>
          </Card>
          <Card title="Oublier ce PC">
            <p className="small">
              Le téléphone ne se synchronise plus avec ce PC (ses données restent ici). Pour
              révoquer aussi l’accès côté PC : Réglages du PC › Synchro › « Oublier cet appareil ».
            </p>
            <Button
              variant="danger"
              onClick={() => {
                if (
                  !window.confirm(
                    'Oublier ce PC ? Il faudra l’appairer de nouveau pour synchroniser.',
                  )
                )
                  return;
                void shell.client
                  .call({ kind: 'sync', call: { op: 'forget' } })
                  .then(() => reload());
              }}
            >
              Oublier ce PC
            </Button>
          </Card>
        </>
      )}
    </Page>
  );
}

type ConflictView = ConflictRow & { canMerge: boolean };

const shown = (json: string | null) => {
  if (json === null) return '—';
  try {
    const v = JSON.parse(json) as unknown;
    if (v === null) return '(vide)';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  } catch {
    return json;
  }
};

/** « Conflits »: what was kept, what was set aside, from which device, when. */
export function ConflictList(props: {
  load: () => Promise<ConflictView[]>;
  dismiss: (id: string) => Promise<unknown>;
  merge: (id: string) => Promise<unknown>;
  deviceName: (id: string | null) => string;
}) {
  const [list, setList] = useState<ConflictView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    () => props.load().then(setList, (e: unknown) => setError(errorMessage(e))),
    [props],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!list) return <p className="muted">Chargement…</p>;
  const open = list.filter((c) => !c.resolved_at);
  const done = list.filter((c) => c.resolved_at);
  const act = (task: Promise<unknown>) =>
    task.then(reload, (e: unknown) => setError(errorMessage(e)));
  return (
    <>
      {error && <p className="error">{error}</p>}
      {open.length === 0 && <p>Aucun conflit à regarder.</p>}
      <ul className="m-conflicts">
        {[...open, ...done].map((c) => (
          <li key={c.id} className={c.resolved_at ? 'm-conflict m-conflict--done' : 'm-conflict'}>
            <strong>{c.label}</strong>
            <span className="small muted">
              {MODULE_NAMES[c.scope] ?? c.scope}
              {c.field ? ` · champ ${c.field}` : ''} · {dateFr(c.created_at)}
              {c.resolved_at ? ` · ${c.resolution ?? 'traité'}` : ''}
            </span>
            {c.kind !== 'name' && (c.kept !== null || c.discarded !== null) && (
              <dl className="m-conflict__values small">
                <dt>Gardée ({props.deviceName(c.kept_device)})</dt>
                <dd>{shown(c.kept)}</dd>
                <dt>Écartée ({props.deviceName(c.discarded_device)})</dt>
                <dd>{shown(c.discarded)}</dd>
              </dl>
            )}
            {!c.resolved_at && (
              <span className="m-conflict__actions">
                {c.canMerge && (
                  <Button
                    small
                    onClick={() =>
                      window.confirm(`Fusionner les deux ?\n\n${c.label}`) &&
                      void act(props.merge(c.id))
                    }
                  >
                    Fusionner
                  </Button>
                )}
                <Button small variant="secondary" onClick={() => void act(props.dismiss(c.id))}>
                  Vu
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function ConflictsPage(props: { shell: Shell }) {
  const { shell } = props;
  const { state } = useSyncState(shell.client);
  const call = <T,>(c: SyncWorkerCall) => shell.client.call<T>({ kind: 'sync', call: c });
  return (
    <Page title="Conflits">
      <p className="small muted">
        Quand un même élément a changé des deux côtés entre deux synchros, la valeur la plus récente
        est gardée ; l’autre est ici, rien n’est perdu. Les noms en double ne sont jamais fusionnés
        seuls.
      </p>
      <ConflictList
        load={() => call<ConflictView[]>({ op: 'conflicts' })}
        dismiss={(id) => call({ op: 'dismiss', id })}
        merge={(id) => call({ op: 'merge', id })}
        deviceName={(id) =>
          id === null
            ? '?'
            : id === state?.device
              ? 'ce téléphone'
              : id === state?.peer?.device_id
                ? 'PC'
                : 'autre appareil'
        }
      />
    </Page>
  );
}
