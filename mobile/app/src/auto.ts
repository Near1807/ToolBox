// The phone's automatic synchronisation in the app (packages/phone/auto-sync.ts
// is the logic): one controller for the whole app, its state for the screens
// (Accueil, Synchro), and ONE synchronisation at a time, manual or automatic.
import { useEffect, useState } from 'react';
import { notifyDataChanged } from '@hub/sdk/frontend';
import { AutoSync, type AutoStatus } from '../../../packages/phone/auto-sync';
import type { SyncState } from '../../../packages/phone/sync-client';
import type { WorkerClient } from '../../../packages/phone/transport';
import { liveConnect } from './live-channel';
import { phoneSync } from './phone-sync';

let queue: Promise<unknown> = Promise.resolve();

/** One synchronisation at a time (manual, automatic, first): the next waits. */
export function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

let controller: AutoSync | null = null;
const listeners = new Set<(s: AutoStatus) => void>();

/** The controller (made once, at the opening of the app). */
export function autoSync(client: WorkerClient): AutoSync {
  if (controller) return controller;
  const auto = new AutoSync({
    run: () =>
      exclusive(async () => {
        const r = await phoneSync(client).now();
        return { received: r.received, sent: r.sent, conflicts: r.conflicts, scopes: r.scopes };
      }),
    target: async () => {
      const state = await client.call<SyncState>({ kind: 'sync', call: { op: 'state' } });
      const token = await client.call<string | null>({ kind: 'sync', call: { op: 'token' } });
      if (!state.peer?.first_sync_at || !token) return null;
      return { url: state.peer.url, pin: state.peer.pin, token };
    },
    connect: liveConnect,
    // The open screens of the modules that received something are read again.
    onSynced: (r) => {
      if (r.scopes.length) notifyDataChanged(r.scopes);
    },
    onStatus: (s) => {
      for (const l of listeners) l(s);
    },
  });
  controller = auto;
  // On screen or not: nothing runs in the background.
  document.addEventListener('visibilitychange', () =>
    auto.setVisible(document.visibilityState === 'visible'),
  );
  return auto;
}

/** At the opening: the setting (off by default) is read, and applied. */
export async function startAutoSync(client: WorkerClient): Promise<void> {
  const on = await client.call<boolean>({ kind: 'sync', call: { op: 'auto' } });
  const auto = autoSync(client);
  auto.setVisible(document.visibilityState === 'visible');
  auto.setEnabled(on);
}

/** The setting changed on the Synchro page. */
export async function setAutoSync(client: WorkerClient, on: boolean): Promise<void> {
  await client.call({ kind: 'sync', call: { op: 'auto', on } });
  autoSync(client).setEnabled(on);
}

/** The state of the automatic synchronisation, live. */
export function useAutoStatus(client: WorkerClient): AutoStatus {
  const [status, setStatus] = useState<AutoStatus>(() => autoSync(client).current);
  useEffect(() => {
    listeners.add(setStatus);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}

/** « à jour », « en cours »… for the small indicator. */
export function autoLabel(s: AutoStatus): { text: string; tone: 'ok' | 'busy' | 'warn' } {
  switch (s.state) {
    case 'ok':
      return {
        text: s.conflicts ? `À jour · ${s.conflicts} conflit(s) à voir` : 'À jour',
        tone: s.conflicts ? 'warn' : 'ok',
      };
    case 'syncing':
      return { text: 'Synchronisation en cours…', tone: 'busy' };
    case 'idle':
      return { text: 'En attente', tone: 'busy' };
    case 'offline':
      return { text: 'PC introuvable', tone: 'warn' };
    case 'version':
      return { text: 'Arrêtée : versions différentes', tone: 'warn' };
    case 'first':
      return { text: 'Arrêtée : première synchro à faire', tone: 'warn' };
    case 'auth':
      return { text: 'Arrêtée : téléphone plus reconnu par le PC', tone: 'warn' };
    case 'error':
      return { text: 'Erreur à la dernière synchro', tone: 'warn' };
    case 'off':
      return { text: 'Désactivée', tone: 'busy' };
  }
}
