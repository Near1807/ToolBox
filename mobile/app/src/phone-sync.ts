// The phone's synchronisation, for the page: the Worker's steps + the native
// HTTPS call to the PC (pinned certificate) + the search on the network.
import { PhoneSync, type SyncWorkerCall } from '../../../packages/phone/sync-client';
import type { WorkerClient } from '../../../packages/phone/transport';
import { findPc } from './pc-finder';
import { pinnedHttp } from './pinned-http';

export function phoneSync(client: WorkerClient): PhoneSync {
  return new PhoneSync(
    <T>(call: SyncWorkerCall) => client.call<T>({ kind: 'sync', call }),
    pinnedHttp,
    findPc,
  );
}
