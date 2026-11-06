// The link between the app's page and its Worker (ADR 0044). The page sends
// messages, the Worker answers them; the SDK's API client goes through
// `workerTransport` (setApiTransport): same paths, same contract as HTTP on
// the PC, the screens do not change. Portable: no Node import.
import type { ApiTransport } from '../sdk/frontend';
import type { PhoneRequest, PhoneResponse } from './router';
import type { SyncWorkerCall } from './sync-client';

/** A message from the page to the Worker. */
export type WorkerCall =
  | { kind: 'request'; request: PhoneRequest }
  | { kind: 'status' }
  | { kind: 'snapshot' }
  | { kind: 'migrate' }
  | { kind: 'stream-open'; stream: number; url: string }
  | { kind: 'stream-close'; stream: number }
  | { kind: 'restore'; bytes: Uint8Array }
  | { kind: 'sync'; call: SyncWorkerCall };

/** Worker → page: an event of an open stream (the Timer's phases…). */
export interface StreamEnvelope {
  stream: { id: number; event: string; data: unknown };
}

export interface WorkerEnvelope {
  id: number;
  call: WorkerCall;
}
export type WorkerReply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/**
 * What the Worker asks of the PAGE (the reverse way): what only the page can
 * do, through Android (the Capacitor plugins live in the page). Answered by
 * the page's `PageHost` (mobile/app/src/page-host.ts).
 */
export type HostCall = {
  kind: 'saveAs';
  title: string;
  defaultName: string;
  data: string | Uint8Array;
};

/** Worker → page: a host call. */
export interface HostEnvelope {
  host: { id: number; call: HostCall };
}
/** Page → Worker: its answer. */
export interface HostReply {
  hostReply: { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
}

/** The Worker's side of the reverse way: calls answered by the page. */
export class PageLink {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', (event) => {
      const data = event.data as Partial<HostReply>;
      if (!data.hostReply) return;
      const reply = data.hostReply;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      if (reply.ok) waiting.resolve(reply.result);
      else waiting.reject(new Error(reply.error));
    });
  }

  call<T>(call: HostCall): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.port.postMessage({ host: { id, call } } satisfies HostEnvelope);
    });
  }
}

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
      const data = event.data as WorkerReply | HostEnvelope | StreamEnvelope;
      if ('host' in data) {
        void this.serve(data.host.id, data.host.call);
        return;
      }
      if ('stream' in data) {
        this.streams.get(data.stream.id)?.[data.stream.event]?.(data.stream.data);
        return;
      }
      const reply = data;
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

  private host: ((call: HostCall) => Promise<unknown>) | null = null;
  private nextStream = 1;
  private readonly streams = new Map<number, Record<string, (data: unknown) => void>>();

  /** Opens a module's event stream in the Worker; returns the function that closes it. */
  openStream(url: string, handlers: Record<string, (data: unknown) => void>): () => void {
    const stream = this.nextStream++;
    this.streams.set(stream, handlers);
    this.call({ kind: 'stream-open', stream, url }).catch(() => this.streams.delete(stream));
    return () => {
      if (!this.streams.delete(stream)) return;
      void this.call({ kind: 'stream-close', stream }).catch(() => undefined);
    };
  }

  /** The page answers the Worker's host calls with this (once, at start-up). */
  serveHost(handler: (call: HostCall) => Promise<unknown>): void {
    this.host = handler;
  }

  private async serve(id: number, call: HostCall) {
    let reply: HostReply['hostReply'];
    try {
      if (!this.host) throw new Error('La page ne répond pas aux demandes du Worker.');
      reply = { id, ok: true, result: await this.host(call) };
    } catch (error) {
      reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.port.postMessage({ hostReply: reply } satisfies HostReply);
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
    // The module's stream runs in the Worker; its events come back as messages.
    openEventStream: (path, handlers) => client.openStream(path, handlers),
  };
}
