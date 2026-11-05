// The link between the app's page and its Worker (ADR 0044). The page sends
// messages, the Worker answers them; the SDK's API client goes through
// `workerTransport` (setApiTransport): same paths, same contract as HTTP on
// the PC, the screens do not change. Portable: no Node import.
import type { ApiTransport } from '../sdk/frontend';
import type { PhoneRequest, PhoneResponse } from './router';

/** A message from the page to the Worker. */
export type WorkerCall =
  | { kind: 'request'; request: PhoneRequest }
  | { kind: 'status' }
  | { kind: 'snapshot' }
  | { kind: 'migrate' }
  | { kind: 'restore'; bytes: Uint8Array };

export interface WorkerEnvelope {
  id: number;
  call: WorkerCall;
}
export type WorkerReply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Something that carries messages both ways (a Worker, or a test double). */
export interface MessagePort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** The page's side: calls answered by the Worker, in order. */
export class WorkerClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', (event) => {
      const reply = event.data as WorkerReply;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      if (reply.ok) waiting.resolve(reply.result);
      else waiting.reject(new Error(reply.error));
    });
  }

  call<T>(call: WorkerCall): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.port.postMessage({ id, call } satisfies WorkerEnvelope);
    });
  }
}

/** The SDK's API client over the Worker (given to setApiTransport at start-up). */
export function workerTransport(client: WorkerClient): ApiTransport {
  return {
    device: 'phone',
    request: async (path, init) => {
      const headers = new Headers(init.headers);
      const body = typeof init.body === 'string' ? init.body : null;
      const answer = await client.call<PhoneResponse>({
        kind: 'request',
        request: {
          method: init.method ?? 'GET',
          url: path,
          body,
          contentType: headers.get('content-type'),
        },
      });
      return new Response(answer.text === '' ? null : answer.text, {
        status: answer.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    },
    openEventStream: () => {
      // Not on the phone yet: said clearly, never a stream that stays silent.
      throw new Error('Les flux d’événements ne sont pas disponibles sur le téléphone.');
    },
  };
}
