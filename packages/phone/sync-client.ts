// The phone's side of the synchronisation (ADR 0044).
// - `syncWorkerCall` runs in the Worker (the base): the engine's steps.
// - `PhoneSync` runs in the page: it talks to the PC (HTTPS, through a
//   native call that accepts ONLY the PC's certificate, pinned by the
//   fingerprint read in the QR code) and hands each answer to the Worker.
// The PC is the master of the versions: if they differ, the phone sends
// nothing and its changes wait, untouched.
// Portable: no Node import, no Capacitor import (the network call is given).
import { compareVersions, type ConflictRow, type Preview } from '../../backend/core/sync/engine';
import { codeKind, decodeAddress, decodePairing } from '../../backend/core/sync/pairing-code';
import {
  beginExchange,
  finishExchange,
  finishFirst,
  versionMessage,
  type ExchangeResponse,
  type ExchangeResult,
  type FirstResponse,
} from '../../backend/core/sync/protocol';
import { FILE_CHUNK, SyncFiles, type FileChunk, type FileRef } from '../../backend/core/sync/files';
import type { PhoneHub } from './host';

export interface PcPeer {
  device_id: string;
  name: string;
  url: string;
  pin: string;
  first_sync_at: string | null;
  last_sync_at: string | null;
}

export interface SyncState {
  device: string;
  peer: PcPeer | null;
  conflicts: number;
}

/** An address where this phone can reach its PC (home, other Wi-Fi…). */
export interface KnownAddress {
  url: string;
  /** Where it came from: 'appairage', 'pc' (the PC sent it), 'reseau' (mDNS), 'qr'. */
  source: string;
  added_at: string;
  last_ok_at: string | null;
}

export type SyncWorkerCall =
  | { op: 'state' }
  | {
      op: 'savePeer';
      peer: { device_id: string; name: string; url: string; pin: string; token: string };
    }
  | { op: 'token' }
  | { op: 'forget' }
  | { op: 'addresses' }
  | { op: 'learn'; urls: string[]; source: string }
  | { op: 'reached'; url: string }
  | { op: 'versions' }
  | { op: 'begin' }
  | { op: 'finish'; response: ExchangeResponse }
  | { op: 'snapshot' }
  | {
      op: 'finishFirst';
      mode: 'merge' | 'replace';
      upTo: Record<string, number>;
      response: FirstResponse;
    }
  | { op: 'filesMissing' }
  | { op: 'fileRead'; ref: FileRef; offset: number }
  | { op: 'fileWrite'; ref: FileRef; chunk: FileChunk }
  | { op: 'conflicts' }
  | { op: 'dismiss'; id: string }
  | { op: 'merge'; id: string };

const phoneFiles = new WeakMap<PhoneHub, SyncFiles>();

/** In the Worker: one step of the synchronisation on the phone's base. */
export async function syncWorkerCall(hub: PhoneHub, call: SyncWorkerCall): Promise<unknown> {
  const engine = hub.sync;
  const db = hub.db;
  const peer = () =>
    (db
      .prepare(
        "SELECT device_id, name, url, pin, first_sync_at, last_sync_at FROM core__sync_peers WHERE role = 'pc' AND revoked_at IS NULL",
      )
      .get() as PcPeer | undefined) ?? null;
  const pc = () => {
    const p = peer();
    if (!p) throw new Error('Ce téléphone n’est appairé à aucun PC.');
    return p;
  };
  const now = () => new Date().toISOString();
  const addresses = (pcId: string) =>
    db
      .prepare(
        'SELECT url, source, added_at, last_ok_at FROM core__sync_addresses WHERE peer = ? ORDER BY last_ok_at IS NULL, last_ok_at DESC, added_at DESC',
      )
      .all(pcId) as KnownAddress[];
  /** Keeps addresses (only https://<IPv4>:<port>; at most 12, the oldest unused go first). */
  const learn = (pcId: string, urls: string[], source: string) => {
    for (const url of urls) {
      if (!/^https:\/\/\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(url)) continue;
      db.prepare(
        'INSERT INTO core__sync_addresses (peer, url, source, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (peer, url) DO NOTHING',
      ).run(pcId, url, source, now());
    }
    const all = addresses(pcId);
    for (const extra of all.slice(12))
      db.prepare('DELETE FROM core__sync_addresses WHERE peer = ? AND url = ?').run(
        pcId,
        extra.url,
      );
  };
  /** The PC answered at this address (pinned certificate): it becomes the current one. */
  const reached = (url: string) => {
    const p = pc();
    learn(p.device_id, [url], 'reseau');
    db.prepare('UPDATE core__sync_addresses SET last_ok_at = ? WHERE peer = ? AND url = ?').run(
      now(),
      p.device_id,
      url,
    );
    db.prepare("UPDATE core__sync_peers SET url = ? WHERE role = 'pc'").run(url);
  };
  switch (call.op) {
    case 'state':
      return {
        device: engine.device,
        peer: peer(),
        conflicts: engine.conflicts().length,
      } satisfies SyncState;
    case 'savePeer':
      db.prepare("DELETE FROM core__sync_peers WHERE role = 'pc'").run();
      db.prepare(
        "INSERT INTO core__sync_peers (device_id, name, role, url, pin, token, created_at) VALUES (?, ?, 'pc', ?, ?, ?, ?)",
      ).run(
        call.peer.device_id,
        call.peer.name,
        call.peer.url,
        call.peer.pin,
        call.peer.token,
        now(),
      );
      db.prepare('DELETE FROM core__sync_addresses').run();
      learn(call.peer.device_id, [call.peer.url], 'appairage');
      reached(call.peer.url);
      return peer();
    case 'token':
      return (
        (
          db
            .prepare("SELECT token FROM core__sync_peers WHERE role = 'pc' AND revoked_at IS NULL")
            .get() as { token: string } | undefined
        )?.token ?? null
      );
    case 'forget':
      db.prepare("DELETE FROM core__sync_peers WHERE role = 'pc'").run();
      db.prepare('DELETE FROM core__sync_addresses').run();
      return null;
    case 'addresses':
      return addresses(pc().device_id);
    case 'learn':
      learn(pc().device_id, call.urls, call.source);
      return addresses(pc().device_id);
    case 'reached':
      reached(call.url);
      return peer();
    case 'versions':
      return engine.versions();
    case 'begin':
      return beginExchange(engine, pc().device_id);
    case 'finish': {
      const result = finishExchange(engine, pc().device_id, call.response);
      db.prepare("UPDATE core__sync_peers SET last_sync_at = ? WHERE role = 'pc'").run(now());
      return result;
    }
    case 'snapshot':
      return engine.snapshot();
    case 'finishFirst': {
      const result = finishFirst(engine, pc().device_id, call.mode, call.upTo, call.response);
      db.prepare(
        "UPDATE core__sync_peers SET first_sync_at = ?, last_sync_at = ? WHERE role = 'pc'",
      ).run(now(), now());
      return result;
    }
    case 'filesMissing': {
      let files = phoneFiles.get(hub);
      if (!files) phoneFiles.set(hub, (files = new SyncFiles(engine)));
      return files.missing();
    }
    case 'fileRead': {
      let files = phoneFiles.get(hub);
      if (!files) phoneFiles.set(hub, (files = new SyncFiles(engine)));
      return files.read(call.ref, call.offset);
    }
    case 'fileWrite': {
      let files = phoneFiles.get(hub);
      if (!files) phoneFiles.set(hub, (files = new SyncFiles(engine)));
      return files.receive(call.ref, call.chunk);
    }
    case 'conflicts':
      return engine
        .conflicts(true)
        .slice(0, 300)
        .map((c) => ({ ...c, canMerge: c.resolved_at === null && engine.mergeFor(c) !== null }));
    case 'dismiss':
      engine.resolveConflict(call.id, 'vu');
      return { ok: true };
    case 'merge': {
      const c = engine.conflict(call.id);
      const merge = c && engine.mergeFor(c);
      if (!c || !merge) throw new Error('Rien à fusionner pour ce conflit');
      const answer = await hub.handle({
        method: 'POST',
        url: `/api/modules/${merge.scope}${merge.route}`,
        body: JSON.stringify(merge.body),
        contentType: 'application/json',
      });
      if (answer.status >= 400)
        throw new Error((JSON.parse(answer.text) as { error?: string }).error ?? 'Fusion refusée');
      engine.resolveConflict(c.id, 'fusionné');
      return { ok: true };
    }
  }
}

/** A request to the PC: HTTPS, accepted only with the pinned certificate. */
export type PinnedHttp = (request: {
  url: string;
  body: string;
  /** The first 16 bytes of the certificate's SHA-256, hex. */
  pin: string;
  token?: string;
  /** Milliseconds to wait for the connection (a short one to try several addresses). */
  connectTimeout?: number;
}) => Promise<{ status: number; body: string }>;

/**
 * Looks for the PC on the local network (mDNS / Android NSD, ADR 0044):
 * the addresses (https://ip:port) announced with this PC's id. Only a hint:
 * an address found is used only if its certificate is the pinned one.
 */
export type Discover = (pcId: string) => Promise<string[]>;

/** Why a synchronisation did not happen, in a sentence for the phone. */
export class SyncFailure extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'version' | 'auth' | 'pin' | 'other',
  ) {
    super(message);
    this.name = 'SyncFailure';
  }
}

/** Short wait per address when looking for the PC (they are tried together). */
const PROBE_TIMEOUT = 2500;

const hostOf = (url: string) => url.replace(/^https:\/\//, '').replace(/:\d+$/, '');

/** Nothing answered: why it may be, and what Thomas can do. */
export function offlineMessage(tried: string[], wrongCertificate: string[]): string {
  const where = tried.length ? ` (essayé : ${tried.map(hostOf).join(', ')})` : '';
  const wrong = wrongCertificate.length
    ? ` À ${wrongCertificate.map(hostOf).join(', ')}, un autre appareil répond, pas ton PC : rien ne lui a été envoyé.`
    : '';
  return (
    `Le PC ne répond pas${where}.${wrong} Causes possibles : le téléphone n’est pas sur le même Wi-Fi que le PC ; ` +
    'le PC est éteint ou ToolBox fermé ; la synchro est désactivée sur le PC. ' +
    'Que faire : ouvre ToolBox sur le PC et vérifie Réglages › Synchro avec le téléphone ; ' +
    'si le PC est sur un autre réseau, affiche sur le PC « QR de l’adresse », puis ici « Nouvelle adresse du PC » (sans réappairer). ' +
    'Rien n’est perdu : tes changements attendent ici.'
  );
}

const isPinError = (message: string) => /certificat|pin|empreinte/i.test(message);

/** The files of a synchronisation: sent to the PC, received, waiting for the next one. */
export interface FilesResult {
  sent: number;
  received: number;
  pending: number;
}

interface HelloAnswer {
  versions: Record<string, number>;
  firstDone: boolean;
  addresses?: string[];
}

export class PhoneSync {
  /** The address found for the operation in progress (null: not looked for yet). */
  private url: string | null = null;

  constructor(
    private readonly worker: <T>(call: SyncWorkerCall) => Promise<T>,
    private readonly http: PinnedHttp,
    private readonly discover: Discover | null = null,
  ) {}

  /** The answer of the PC, read: errors in sentences (401, 409…). */
  private read<T>(answer: { status: number; body: string }): T {
    let data: { error?: string; verdict?: string } & Record<string, unknown> = {};
    try {
      data = JSON.parse(answer.body || '{}');
    } catch {
      // Not JSON: the error below.
    }
    if (answer.status === 401)
      throw new SyncFailure(
        data.error ?? 'Ce téléphone n’est plus reconnu par le PC : appaire-le de nouveau.',
        'auth',
      );
    if (answer.status === 409)
      throw new SyncFailure(data.error ?? 'Versions différentes.', 'version');
    if (answer.status >= 400)
      throw new SyncFailure(data.error ?? `Erreur du PC (${answer.status})`, 'other');
    return data as T;
  }

  private async post<T>(
    path: string,
    body: unknown,
    peer?: { url: string; pin: string },
    token?: string,
  ): Promise<T> {
    let target = peer;
    if (!target) {
      const state = (await this.worker<SyncState>({ op: 'state' })).peer;
      if (!state) throw new SyncFailure('Ce téléphone n’est appairé à aucun PC.', 'auth');
      target = { url: this.url ?? state.url, pin: state.pin };
    }
    let answer: { status: number; body: string };
    try {
      answer = await this.http({
        url: `${target.url}${path}`,
        body: JSON.stringify(body),
        pin: target.pin,
        token: token ?? (await this.worker<string | null>({ op: 'token' })) ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isPinError(message))
        throw new SyncFailure(
          'Le PC ne présente pas le certificat attendu : rien n’a été envoyé. Si tu as réinstallé ToolBox sur le PC, appaire de nouveau.',
          'pin',
        );
      throw new SyncFailure(offlineMessage([target.url], []), 'offline');
    }
    return this.read<T>(answer);
  }

  /**
   * Finds the PC (ADR 0044, v0.33.0): its current address and every address
   * where it was reached before (home, other Wi-Fi…), tried together with a
   * short wait; then, if none answers, the local network (mDNS). The first
   * address whose certificate is the pinned one and that answers wins: it
   * becomes the current one, and the PC's own addresses are kept.
   */
  private async locate(): Promise<HelloAnswer> {
    const state = (await this.worker<SyncState>({ op: 'state' })).peer;
    if (!state) throw new SyncFailure('Ce téléphone n’est appairé à aucun PC.', 'auth');
    const token = (await this.worker<string | null>({ op: 'token' })) ?? undefined;
    const known = await this.worker<KnownAddress[]>({ op: 'addresses' });
    const tried: string[] = [];
    const wrong: string[] = [];
    const attempt = async (
      urls: string[],
    ): Promise<{ url: string; answer: { status: number; body: string } } | null> => {
      const fresh = urls.filter((u) => !tried.includes(u));
      tried.push(...fresh);
      if (!fresh.length) return null;
      return new Promise((resolve) => {
        let left = fresh.length;
        const done = () => --left === 0 && resolve(null);
        for (const url of fresh)
          this.http({
            url: `${url}/sync/hello`,
            body: '{}',
            pin: state.pin,
            token,
            connectTimeout: PROBE_TIMEOUT,
          }).then(
            (answer) => resolve({ url, answer }),
            (error: unknown) => {
              if (isPinError(error instanceof Error ? error.message : String(error)))
                wrong.push(url);
              done();
            },
          );
      });
    };
    let found = await attempt([state.url, ...known.map((a) => a.url)]);
    if (!found && this.discover) {
      const urls = await this.discover(state.device_id).catch(() => [] as string[]);
      if (urls.length) {
        await this.worker({ op: 'learn', urls, source: 'reseau' });
        found = await attempt(urls);
      }
    }
    if (!found) throw new SyncFailure(offlineMessage(tried, wrong), 'offline');
    // The pinned certificate answered: this is the PC (even with an error, read below).
    await this.worker({ op: 'reached', url: found.url });
    this.url = found.url;
    const hello = this.read<HelloAnswer>(found.answer);
    if (hello.addresses?.length)
      await this.worker({ op: 'learn', urls: hello.addresses, source: 'pc' });
    return hello;
  }

  /** Reads the code (QR or typed), exchanges the single-use token for this phone's own. */
  async pair(code: string, name: string): Promise<PcPeer> {
    if (codeKind(code) === 'address')
      throw new SyncFailure(
        'C’est un « QR de l’adresse » : il sert à retrouver un PC déjà appairé (Nouvelle adresse du PC). Pour appairer, affiche sur le PC « Appairer un téléphone ».',
        'other',
      );
    const info = decodePairing(code);
    const url = `https://${info.host}:${info.port}`;
    const state = await this.worker<SyncState>({ op: 'state' });
    const answer = await this.post<{
      token: string;
      pc: string;
      name: string;
      addresses?: string[];
    }>('/sync/pair', { code: info.token, device: state.device, name }, { url, pin: info.pin }, '');
    const saved = await this.worker<PcPeer>({
      op: 'savePeer',
      peer: { device_id: answer.pc, name: answer.name, url, pin: info.pin, token: answer.token },
    });
    if (answer.addresses?.length)
      await this.worker({ op: 'learn', urls: answer.addresses, source: 'pc' });
    return saved;
  }

  /** The versions first: different, nothing is sent (the PC is the master). */
  private async hello(): Promise<{ firstDone: boolean }> {
    this.url = null;
    const answer = await this.locate();
    const mine = await this.worker<Record<string, number>>({ op: 'versions' });
    const v = compareVersions(mine, answer.versions);
    if (v !== 'same')
      throw new SyncFailure(
        versionMessage(
          v === 'mine-older' ? 'phone-older' : v === 'theirs-older' ? 'pc-older' : 'mixed',
          'phone',
        ),
        'version',
      );
    return { firstDone: answer.firstDone };
  }

  /**
   * « Nouvelle adresse du PC » : the code of « QR de l'adresse » (TBXA, no
   * token). Its fingerprint must be the one of THE PC this phone is paired
   * with; then the PC must answer there. No new pairing, no new first sync.
   */
  async newAddress(code: string): Promise<string> {
    const info = decodeAddress(code);
    const state = (await this.worker<SyncState>({ op: 'state' })).peer;
    if (!state) throw new SyncFailure('Ce téléphone n’est appairé à aucun PC.', 'auth');
    if (info.pin !== state.pin)
      throw new SyncFailure(
        'Ce QR code vient d’un autre PC (empreinte différente du PC appairé) : adresse refusée, rien n’a été envoyé.',
        'pin',
      );
    const url = `https://${info.host}:${info.port}`;
    const hello = await this.post<HelloAnswer>('/sync/hello', {}, { url, pin: state.pin });
    await this.worker({ op: 'learn', urls: [url], source: 'qr' });
    await this.worker({ op: 'reached', url });
    if (hello.addresses?.length)
      await this.worker({ op: 'learn', urls: hello.addresses, source: 'pc' });
    return url;
  }

  /** Whether the first synchronisation (with its preview) is still to do. */
  async needsFirst(): Promise<boolean> {
    return !(await this.hello()).firstDone;
  }

  async preview(): Promise<Preview> {
    await this.hello();
    const versions = await this.worker<Record<string, number>>({ op: 'versions' });
    const snapshot = await this.worker({ op: 'snapshot' });
    const answer = await this.post<{ preview: Preview }>('/sync/first', {
      versions,
      mode: 'preview',
      snapshot,
    });
    return answer.preview;
  }

  /**
   * The first synchronisation, after the preview and Thomas's choice. The
   * phone's copy « avant-synchro » is taken first (`copyFirst`); the PC saves
   * its base on its side.
   */
  async first(
    mode: 'merge' | 'replace',
    copyFirst: () => Promise<void>,
  ): Promise<{ conflicts: number; files: FilesResult }> {
    await this.hello();
    await copyFirst();
    const versions = await this.worker<Record<string, number>>({ op: 'versions' });
    const snapshot = await this.worker<{ upTo: Record<string, number> }>({ op: 'snapshot' });
    const response = await this.post<FirstResponse>('/sync/first', { versions, mode, snapshot });
    const result = await this.worker<{ conflicts: ConflictRow[] }>({
      op: 'finishFirst',
      mode,
      upTo: snapshot.upTo,
      response,
    });
    const files = await this.files();
    return { conflicts: result.conflicts.length + response.conflicts.length, files };
  }

  /**
   * The files named by the rows (recipe pictures), after the data: what the
   * PC lacks goes up, what the phone lacks comes down, by pieces, once per
   * fingerprint. Never an error: a file that does not pass waits for the
   * next synchronisation (counted in `pending`).
   */
  async files(): Promise<FilesResult> {
    const result: FilesResult = { sent: 0, received: 0, pending: 0 };
    let theirs: FileRef[];
    let mine: FileRef[] = [];
    try {
      mine = await this.worker<FileRef[]>({ op: 'filesMissing' });
      theirs = (await this.post<{ files: FileRef[] }>('/sync/files/missing', {})).files;
    } catch {
      result.pending = mine.length;
      return result;
    }
    // Missing on both devices: nothing to send either way.
    const lackedHere = new Set(mine.map((r) => r.sha256));
    const lackedThere = new Set(theirs.map((r) => r.sha256));
    theirs = theirs.filter((r) => !lackedHere.has(r.sha256));
    // Not here, not on the PC either (moved, lost): it waits too, it may come back.
    result.pending += mine.filter((r) => lackedThere.has(r.sha256)).length;
    mine = mine.filter((r) => !lackedThere.has(r.sha256));
    let offline = false;
    for (const ref of theirs) {
      if (offline) {
        result.pending++;
        continue;
      }
      try {
        let offset = 0;
        for (;;) {
          const chunk = await this.worker<FileChunk>({ op: 'fileRead', ref, offset });
          const { done } = await this.post<{ done: boolean }>('/sync/files/put', { ref, chunk });
          if (done) break;
          offset += FILE_CHUNK;
          if (offset >= chunk.total) throw new Error('incomplet');
        }
        result.sent++;
      } catch (error) {
        // Not on this phone either, or the network: it waits for next time.
        if (error instanceof SyncFailure && error.kind === 'offline') offline = true;
        result.pending++;
      }
    }
    for (const ref of mine) {
      if (offline) {
        result.pending++;
        continue;
      }
      try {
        let offset = 0;
        for (;;) {
          const chunk = await this.post<FileChunk>('/sync/files/get', { ref, offset });
          if (await this.worker<boolean>({ op: 'fileWrite', ref, chunk })) break;
          offset += FILE_CHUNK;
          if (offset >= chunk.total) throw new Error('incomplet');
        }
        result.received++;
      } catch (error) {
        if (error instanceof SyncFailure && error.kind === 'offline') offline = true;
        result.pending++;
      }
    }
    return result;
  }

  /** « Synchroniser » : both ways, the data then the files. */
  async now(): Promise<ExchangeResult & { files: FilesResult }> {
    const { firstDone } = await this.hello();
    if (!firstDone)
      throw new SyncFailure('Fais d’abord la première synchro (avec son aperçu).', 'other');
    const request = await this.worker({ op: 'begin' });
    const response = await this.post<ExchangeResponse>('/sync/exchange', request);
    const result = await this.worker<ExchangeResult>({ op: 'finish', response });
    return { ...result, files: await this.files() };
  }
}
