// The phone's side of the synchronisation (ADR 0044).
// - `syncWorkerCall` runs in the Worker (the base): the engine's steps.
// - `PhoneSync` runs in the page: it talks to the PC (HTTPS, through a
//   native call that accepts ONLY the PC's certificate, pinned by the
//   fingerprint read in the QR code) and hands each answer to the Worker.
// The PC is the master of the versions: if they differ, the phone sends
// nothing and its changes wait, untouched.
// Portable: no Node import, no Capacitor import (the network call is given).
import { compareVersions, type ConflictRow, type Preview } from '../../backend/core/sync/engine';
import { decodePairing } from '../../backend/core/sync/pairing-code';
import {
  beginExchange,
  finishExchange,
  finishFirst,
  versionMessage,
  type ExchangeResponse,
  type ExchangeResult,
  type FirstResponse,
} from '../../backend/core/sync/protocol';
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

export type SyncWorkerCall =
  | { op: 'state' }
  | {
      op: 'savePeer';
      peer: { device_id: string; name: string; url: string; pin: string; token: string };
    }
  | { op: 'token' }
  | { op: 'forget' }
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
  | { op: 'conflicts' }
  | { op: 'dismiss'; id: string }
  | { op: 'merge'; id: string };

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
      return null;
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
}) => Promise<{ status: number; body: string }>;

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

const OFFLINE =
  'Le PC ne répond pas. Vérifie qu’il est allumé, ToolBox ouvert, la synchro activée, et que vous êtes sur le même Wi-Fi. Rien n’est perdu : tes changements attendent ici.';

export class PhoneSync {
  constructor(
    private readonly worker: <T>(call: SyncWorkerCall) => Promise<T>,
    private readonly http: PinnedHttp,
  ) {}

  private async post<T>(
    path: string,
    body: unknown,
    peer?: { url: string; pin: string },
    token?: string,
  ): Promise<T> {
    const target = peer ?? (await this.worker<SyncState>({ op: 'state' })).peer;
    if (!target) throw new SyncFailure('Ce téléphone n’est appairé à aucun PC.', 'auth');
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
      if (/certificat|pin|empreinte/i.test(message))
        throw new SyncFailure(
          'Le PC ne présente pas le certificat attendu : rien n’a été envoyé. Si tu as réinstallé ToolBox sur le PC, appaire de nouveau.',
          'pin',
        );
      throw new SyncFailure(OFFLINE, 'offline');
    }
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

  /** Reads the code (QR or typed), exchanges the single-use token for this phone's own. */
  async pair(code: string, name: string): Promise<PcPeer> {
    const info = decodePairing(code);
    const url = `https://${info.host}:${info.port}`;
    const state = await this.worker<SyncState>({ op: 'state' });
    const answer = await this.post<{ token: string; pc: string; name: string }>(
      '/sync/pair',
      { code: info.token, device: state.device, name },
      { url, pin: info.pin },
      '',
    );
    return this.worker<PcPeer>({
      op: 'savePeer',
      peer: { device_id: answer.pc, name: answer.name, url, pin: info.pin, token: answer.token },
    });
  }

  /** The versions first: different, nothing is sent (the PC is the master). */
  private async hello(): Promise<{ firstDone: boolean }> {
    const answer = await this.post<{ versions: Record<string, number>; firstDone: boolean }>(
      '/sync/hello',
      {},
    );
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
  ): Promise<{ conflicts: number }> {
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
    return { conflicts: result.conflicts.length + response.conflicts.length };
  }

  /** « Synchroniser » : both ways. */
  async now(): Promise<ExchangeResult> {
    const { firstDone } = await this.hello();
    if (!firstDone)
      throw new SyncFailure('Fais d’abord la première synchro (avec son aperçu).', 'other');
    const request = await this.worker({ op: 'begin' });
    const response = await this.post<ExchangeResponse>('/sync/exchange', request);
    return this.worker<ExchangeResult>({ op: 'finish', response });
  }
}
