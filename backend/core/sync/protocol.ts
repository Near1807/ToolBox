// The exchange between the phone and the PC (ADR 0044), in three calls that
// travel over the network (or are called directly in the tests):
//   phone: begin…()  →  PC: serve…()  →  phone: finish…()
// The PC is the master of the versions: if the two bases' versions differ,
// nothing is exchanged; the device that is behind says « Mets à jour ».
// The phone's changes wait, untouched, until the versions match again.
// Portable: no Node import.
import {
  compareVersions,
  SyncError,
  type Batch,
  type ConflictRow,
  type Snapshot,
  type SyncEngine,
} from './engine';

export interface VersionInfo {
  versions: Record<string, number>;
  app: string;
}

export type VersionVerdict = 'same' | 'phone-older' | 'pc-older' | 'mixed';

/** From the PC's side: who has to update. */
export function versionVerdict(
  pc: Record<string, number>,
  phone: Record<string, number>,
): VersionVerdict {
  const v = compareVersions(phone, pc);
  return v === 'same'
    ? 'same'
    : v === 'mine-older'
      ? 'phone-older'
      : v === 'theirs-older'
        ? 'pc-older'
        : 'mixed';
}

/** The sentence each side shows when the versions differ. */
export function versionMessage(verdict: VersionVerdict, side: 'pc' | 'phone'): string {
  if (verdict === 'phone-older')
    return side === 'phone'
      ? 'Mets à jour l’application : le PC a une version plus récente. Tes changements attendent ici, intacts.'
      : 'Le téléphone a une version plus ancienne : mets à jour l’application sur le téléphone.';
  if (verdict === 'pc-older')
    return side === 'pc'
      ? 'Mets à jour ToolBox sur le PC : le téléphone a une version plus récente.'
      : 'Le PC a une version plus ancienne : mets à jour ToolBox sur le PC. Tes changements attendent ici, intacts.';
  return 'Les versions du PC et du téléphone ne correspondent pas : mets à jour les deux.';
}

export class VersionMismatch extends SyncError {
  constructor(
    readonly verdict: VersionVerdict,
    readonly pc: Record<string, number>,
    readonly phone: Record<string, number>,
    side: 'pc' | 'phone',
  ) {
    super(versionMessage(verdict, side));
    this.name = 'VersionMismatch';
  }
}

// --- Synchronisation by hand ------------------------------------------------------

export interface ExchangeRequest {
  versions: Record<string, number>;
  batch: Batch;
  /** How far the phone has received the PC's changes, per scope. */
  received: Record<string, number>;
}

export interface ExchangeResponse {
  batch: Batch;
  /** How far the PC has now received the phone's changes (acknowledgement). */
  received: Record<string, number>;
  /** Conflicts the PC found while applying the phone's changes (listed on the phone too). */
  conflicts: ConflictRow[];
  /** Changes of the phone the PC applied. */
  applied: number;
}

export interface ExchangeResult {
  /** Changes received from the PC and applied here. */
  received: number;
  /** Changes of the phone the PC applied. */
  sent: number;
  conflicts: number;
}

const scopesOf = (engine: SyncEngine, f: (scope: string) => number) =>
  Object.fromEntries(engine.scopes().map((s) => [s, f(s)]));

/** Phone: what it sends (its changes since what the PC acknowledged). */
export function beginExchange(phone: SyncEngine, pc: string): ExchangeRequest {
  const cursors = phone.cursors(pc);
  return {
    versions: phone.versions(),
    batch: phone.prepareBatch(
      pc,
      scopesOf(phone, (s) => cursors[s]!.sent),
    ),
    received: scopesOf(phone, (s) => cursors[s]!.received),
  };
}

/** PC: checks the versions, applies the phone's changes, answers with its own. */
export function serveExchange(
  pc: SyncEngine,
  phone: string,
  request: ExchangeRequest,
): ExchangeResponse {
  const verdict = versionVerdict(pc.versions(), request.versions ?? {});
  if (verdict !== 'same')
    throw new VersionMismatch(verdict, pc.versions(), request.versions ?? {}, 'pc');
  const result = pc.applyBatch(phone, request.batch, request.received ?? {});
  const cursors = pc.cursors(phone);
  return {
    batch: pc.prepareBatch(phone, request.received ?? {}),
    received: scopesOf(pc, (s) => cursors[s]!.received),
    conflicts: result.conflicts,
    applied: result.applied,
  };
}

/** Phone: applies the PC's changes; its own are acknowledged (they will not be sent again). */
export function finishExchange(
  phone: SyncEngine,
  pc: string,
  response: ExchangeResponse,
): ExchangeResult {
  const result = phone.applyBatch(pc, response.batch, response.received);
  phone.importConflicts(response.conflicts ?? []);
  for (const [scope, upTo] of Object.entries(response.received))
    if (phone.scopes().includes(scope)) phone.setCursor(pc, scope, { sent: upTo });
  return {
    received: result.applied,
    sent: response.applied,
    conflicts: result.conflicts.length + (response.conflicts?.length ?? 0),
  };
}

// --- First synchronisation ------------------------------------------------------------

export interface FirstRequest {
  versions: Record<string, number>;
  mode: 'preview' | 'merge' | 'replace';
  snapshot: Snapshot;
}

export interface FirstResponse {
  /** The PC's data after the merge (or as it is, to replace the phone's). */
  snapshot: Snapshot;
  conflicts: ConflictRow[];
}

/** PC: the preview (nothing written), or the merge / the phone's data replaced by the PC's. */
export function serveFirst(pc: SyncEngine, phone: string, request: FirstRequest) {
  const verdict = versionVerdict(pc.versions(), request.versions ?? {});
  if (verdict !== 'same')
    throw new VersionMismatch(verdict, pc.versions(), request.versions ?? {}, 'pc');
  if (request.mode === 'preview') return { preview: pc.preview(request.snapshot) };
  let conflicts: ConflictRow[] = [];
  if (request.mode === 'merge') {
    conflicts = pc.applySnapshot(phone, request.snapshot, 'merge').conflicts;
    for (const [scope, upTo] of Object.entries(request.snapshot.upTo))
      if (pc.scopes().includes(scope)) pc.setCursor(phone, scope, { received: upTo });
  } else {
    // The phone's journals are emptied: its next changes start again at 1.
    for (const scope of pc.scopes()) pc.setCursor(phone, scope, { received: 0 });
  }
  return { snapshot: pc.snapshot(), conflicts } satisfies FirstResponse;
}

/** Phone: applies the PC's data; the cursors start after what each device has now. */
export function finishFirst(
  phone: SyncEngine,
  pc: string,
  mode: 'merge' | 'replace',
  phoneUpTo: Record<string, number>,
  response: FirstResponse,
) {
  const result = phone.applySnapshot(pc, response.snapshot, mode);
  phone.importConflicts(response.conflicts ?? []);
  for (const scope of phone.scopes())
    phone.setCursor(pc, scope, {
      received: response.snapshot.upTo[scope] ?? 0,
      sent: mode === 'replace' ? 0 : (phoneUpTo[scope] ?? 0),
    });
  return result;
}
