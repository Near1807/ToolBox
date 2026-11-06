// « Synchro avec le PC » (ADR 0044): pair with the PC (photo of its QR code,
// or the code typed by hand), the first synchronisation (preview, then
// « Partir des données du PC » or « Fusionner », with confirmations and a
// copy before), then « Synchroniser » by hand. And « Conflits ».
// Nothing is sent or replaced without a tap; when the PC does not answer,
// nothing is lost: the changes wait.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Page, errorMessage } from '@hub/sdk/frontend';
import type { ConflictRow, Preview } from '../../../backend/core/sync/engine';
import type { ExchangeResult } from '../../../backend/core/sync/protocol';
import {
  PhoneSync,
  type SyncState,
  type SyncWorkerCall,
} from '../../../packages/phone/sync-client';
import type { WorkerClient } from '../../../packages/phone/transport';
import { dateFr, type Shell } from './App';
import { takeCopy } from './backup';
import { pinnedHttp } from './pinned-http';
import { readQrFromPhoto } from './qr-photo';

/** The phone's synchronisation, for the page (worker steps + the native HTTPS call). */
export function phoneSync(client: WorkerClient): PhoneSync {
  return new PhoneSync(
    <T,>(call: SyncWorkerCall) => client.call<T>({ kind: 'sync', call }),
    pinnedHttp,
  );
}

export const MODULE_NAMES: Record<string, string> = {
  todo: 'To-do',
  ideas: 'Boîte à idées',
  sport: 'Sport',
  timer: 'Timer',
  courses: 'Courses',
  core: 'Réglages',
};

export function resultText(r: ExchangeResult): string {
  const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
  return `${n(r.received, 'reçu', 'reçus')}, ${n(r.sent, 'envoyé', 'envoyés')}, ${n(r.conflicts, 'conflit', 'conflits')}`;
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
          phoneSync(props.client)
            .now()
            .then(
              (r) => setMessage({ ok: true, text: `Synchronisé : ${resultText(r)}.` }),
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

function PairCard(props: { client: WorkerClient; onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photo = useRef<HTMLInputElement>(null);
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
      <div className="m-actions">
        <Button disabled={busy} onClick={() => photo.current?.click()}>
          Photographier le QR code
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
          setBusy(true);
          readQrFromPhoto(file).then(
            (text) => {
              if (text) pair(text);
              else {
                setBusy(false);
                setError(
                  'QR code introuvable sur la photo : rapproche-toi de l’écran, ou tape le code.',
                );
              }
            },
            () => {
              setBusy(false);
              setError('Photo illisible.');
            },
          );
        }}
      />
      <p className="small muted">Ou tape le code affiché sous le QR code (TBX1-…) :</p>
      <textarea
        className="input m-code"
        rows={3}
        value={code}
        placeholder="TBX1-XXXX-XXXX-…"
        aria-label="Code d’appairage"
        autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value)}
      />
      <div className="m-actions">
        <Button variant="secondary" disabled={busy || !code.trim()} onClick={() => pair(code)}>
          Appairer avec ce code
        </Button>
      </div>
      {busy && <p className="small muted">Connexion au PC…</p>}
      {error && <p className="error">{error}</p>}
      <p className="small muted">
        Le téléphone ne parle qu’au PC dont le certificat correspond au code : jamais à un autre
        appareil du réseau. Rien ne passe par Internet.
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
      const r = await phoneSync(shell.client).first(mode, async () => {
        await takeCopy(shell.client, 'avant-synchro');
      });
      await shell.refresh();
      window.alert(
        `Première synchro faite${r.conflicts ? ` (${r.conflicts} élément(s) dans « Conflits »)` : ''}.`,
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
