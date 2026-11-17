// v0.41.0: what each device shows about its synchronisation, to diagnose it
// alone: the state of the witness (« Synchro arrêtée », « En attente du
// téléphone », « Synchronisé · il y a 5 min », « Synchro bloquée » and why),
// the last 50 attempts (date, network or address, done or why not), and the
// networks / addresses where an exchange already worked, with the names
// Thomas gives them. READ and display only: nothing here connects, listens,
// or changes a setting. Local to each device (never synchronised).
// Portable: no Node import (the phone's Worker uses it too).

/** One attempt of synchronisation, as this device saw it. */
export interface SyncAttempt {
  /** ISO date. */
  at: string;
  ok: boolean;
  /** Where: the network's name, else the address. */
  where: string;
  /** Why it did not work (a sentence), null when done. */
  reason: string | null;
  /** The other device's name, when known (« Téléphone de Thomas »). */
  peer?: string | null;
}

/** The attempts kept on each device; the oldest beyond are dropped. */
export const MAX_ATTEMPTS = 50;

/** The list with this attempt first, at most MAX_ATTEMPTS (the oldest beyond are dropped). */
export function withAttempt(list: readonly SyncAttempt[], attempt: SyncAttempt): SyncAttempt[] {
  return [attempt, ...list].slice(0, MAX_ATTEMPTS);
}

/** A network (PC) where an exchange already worked, or was tried. */
export interface KnownNetwork {
  /** « net:<name> » (the network's name, from Windows) or « ip:<the PC's address> ». */
  key: string;
  /** The name Thomas gave it (« Kot », « Maison »), or null. */
  label: string | null;
  /** The network's name as Windows gives it, or null. */
  network: string | null;
  /** The PC's addresses there. */
  addresses: string[];
  firstOk: string | null;
  lastOk: string | null;
  lastFail: { at: string; reason: string } | null;
}

/** The key of a network: its name when Windows gives one, else the PC's address there. */
export const networkKey = (network: string | null, address: string) =>
  network ? `net:${network}` : `ip:${address}`;

/** The list with this attempt counted in its network (added when new; the names kept). */
export function withNetworkAttempt(
  list: readonly KnownNetwork[],
  where: { network: string | null; address: string },
  attempt: Pick<SyncAttempt, 'at' | 'ok' | 'reason'>,
): KnownNetwork[] {
  const key = networkKey(where.network, where.address);
  const before = list.find((n) => n.key === key);
  const base: KnownNetwork = before ?? {
    key,
    label: null,
    network: where.network,
    addresses: [],
    firstOk: null,
    lastOk: null,
    lastFail: null,
  };
  const next: KnownNetwork = {
    ...base,
    addresses: base.addresses.includes(where.address)
      ? base.addresses
      : [...base.addresses, where.address].slice(-5),
    ...(attempt.ok
      ? { firstOk: base.firstOk ?? attempt.at, lastOk: attempt.at }
      : { lastFail: { at: attempt.at, reason: attempt.reason ?? 'Erreur inconnue' } }),
  };
  return before ? list.map((n) => (n.key === key ? next : n)) : [...list, next];
}

/** A name given by Thomas: trimmed, at most 40 characters, null when empty. */
export function cleanLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  const t = label.replace(/\s+/g, ' ').trim().slice(0, 40);
  return t || null;
}

// --- The witness ----------------------------------------------------------------

/** The states of the witness, the same words on the PC and on the phone. */
export type WitnessState = 'off' | 'waiting' | 'synced' | 'blocked';

export interface Witness {
  state: WitnessState;
  /** « Synchro arrêtée », « Synchronisé · il y a 5 min »… */
  text: string;
  /** Why it is blocked, in plain words (blocked only), or a detail (the phone's name…). */
  detail: string | null;
  /** The last exchange that worked (ISO), or null. */
  lastOk: string | null;
}

/** An exchange within this time is recent: « Synchronisé · … »; older: « En attente du téléphone ». */
export const RECENT_MS = 12 * 3_600_000;

/** « à l'instant », « il y a 5 min », « il y a 2 h », « il y a 3 j ». */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'à l’instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/** The sentence for a Windows network on the « Public » profile. */
export const PUBLIC_NETWORK =
  'Réseau Public : Windows bloque la synchro ici. Passe ce réseau en Privé (Paramètres Windows › Réseau) ou utilise le partage de connexion du téléphone.';

/** What the PC knows of its synchronisation right now. */
export interface PcSyncFacts {
  /** The listener is turned on (Réglages). */
  enabled: boolean;
  /** Why the listener could not start (port taken…), or null. */
  error: string | null;
  /** Every local network of the PC is on the « Public » profile (Windows). */
  publicNetwork: boolean;
  /** The last exchange refused for the versions (who has to update), or null. */
  refusal: string | null;
  /** The last attempt that did not work and came after the last success, or null. */
  failure: { at: string; reason: string } | null;
  /** The last exchange that worked, and with which phone. */
  lastOk: { at: string; peer: string | null } | null;
}

/** The PC's witness (the same states as the phone's indicator). */
export function pcWitness(f: PcSyncFacts, now: number): Witness {
  const lastOk = f.lastOk?.at ?? null;
  if (!f.enabled) return { state: 'off', text: 'Synchro arrêtée', detail: null, lastOk };
  const blocked = (detail: string): Witness => ({
    state: 'blocked',
    text: 'Synchro bloquée',
    detail,
    lastOk,
  });
  if (f.error) return blocked(f.error);
  if (f.publicNetwork) return blocked(PUBLIC_NETWORK);
  if (f.refusal) return blocked(f.refusal);
  if (f.failure) return blocked(f.failure.reason);
  if (f.lastOk && now - Date.parse(f.lastOk.at) < RECENT_MS)
    return {
      state: 'synced',
      text: `Synchronisé · ${ago(f.lastOk.at, now)}`,
      detail: f.lastOk.peer ? `avec ${f.lastOk.peer}` : null,
      lastOk,
    };
  return {
    state: 'waiting',
    text: 'En attente du téléphone',
    detail: f.lastOk ? `Dernière synchro ${ago(f.lastOk.at, now)}` : null,
    lastOk,
  };
}

/** The last failure that came after the last success (what still blocks), or null. */
export function pendingFailure(
  list: readonly SyncAttempt[],
): { at: string; reason: string } | null {
  const first = list[0];
  return first && !first.ok ? { at: first.at, reason: first.reason ?? 'Erreur inconnue' } : null;
}
