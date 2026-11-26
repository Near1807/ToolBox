// v0.50.0 (bug G): following a task started from a page — the task lists are
// told at once (announceJobs), a task that is not seen YET is waited for
// (never read as ended), a task never found is « introuvable » (a rejection,
// never « terminée »), and the end comes from the stream.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  httpTransport,
  JOBS_CHANGED_EVENT,
  runJob,
  setApiTransport,
  subscribeJobs,
  waitForJob,
  type JobInfo,
} from '@hub/sdk/frontend';

const job = (status: JobInfo['status'], over: Partial<JobInfo> = {}): JobInfo =>
  ({
    id: 'j1',
    moduleId: 'coffre',
    type: 'disk-update',
    title: 'Mise à jour du disque',
    status,
    progress: null,
    message: null,
    result: null,
    error: null,
    details: null,
    createdAt: '2026-11-26T10:00:00.000Z',
    startedAt: null,
    finishedAt: status === 'running' || status === 'queued' ? null : '2026-11-26T10:01:00.000Z',
    ...over,
  }) as JobInfo;

/** A fake hub: the list answered by `list()`, the stream's handler kept to push events. */
function fakeHub(list: () => JobInfo[]) {
  let push: ((data: unknown) => void) | null = null;
  let reads = 0;
  let opened = 0;
  setApiTransport({
    request: (path) => {
      if (path.startsWith('/api/core/jobs')) reads++;
      return Promise.resolve(new Response(JSON.stringify(list()), { status: 200 }));
    },
    openEventStream: (_path, handlers) => {
      opened++;
      push = handlers.job ?? null;
      return () => {
        push = null;
      };
    },
  });
  return {
    push: (j: JobInfo) => push?.(j),
    reads: () => reads,
    open: () => push !== null,
    opened: () => opened,
  };
}

afterEach(() => {
  setApiTransport(httpTransport);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('suivre une tâche lancée depuis une fenêtre', () => {
  it('pas encore dans la liste : attendue (jamais « terminée »), puis suivie jusqu’à la fin', async () => {
    let known: JobInfo[] = [];
    const hub = fakeHub(() => known);
    const seen: string[] = [];
    const done = waitForJob('j1', (j) => seen.push(j.status));
    let ended = false;
    void done.then(() => (ended = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(ended).toBe(false); // not found yet ≠ ended
    known = [job('queued')];
    hub.push(job('running', { progress: 0.4 }));
    hub.push(job('succeeded', { result: { copied: 3 } }));
    const last = await done;
    expect(last.status).toBe('succeeded');
    expect(seen).toEqual(['running', 'succeeded']);
    expect(hub.open()).toBe(false); // the stream closed
  });

  it('introuvable : refus « Tâche introuvable » après quelques secondes, jamais « terminée »', async () => {
    vi.useFakeTimers();
    const hub = fakeHub(() => []);
    const done = waitForJob('j1');
    const outcome = done.then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(7000);
    expect(await outcome).toMatch(/^Tâche introuvable/);
    expect(hub.reads()).toBeGreaterThan(1); // read again, not given up at once
    expect(hub.open()).toBe(false);
  });

  it('runJob : les listes de tâches sont prévenues tout de suite ; échec → son message', async () => {
    const events: string[] = [];
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => events.push(e.type) });
    const hub = fakeHub(() => [job('running')]);
    const result = runJob(Promise.resolve({ jobId: 'j1' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual([JOBS_CHANGED_EVENT]);
    hub.push(job('failed', { error: 'Disque débranché' }));
    await expect(result).rejects.toThrow('Disque débranché');
  });

  it('un seul flux des tâches pour toute la page (6 connexions au plus vers le serveur)', async () => {
    const hub = fakeHub(() => [job('running')]);
    const seenA: string[] = [];
    const seenB: string[] = [];
    const offA = subscribeJobs((j) => seenA.push(j.status));
    const offB = subscribeJobs((j) => seenB.push(j.status));
    const waiting = waitForJob('j1');
    await new Promise((r) => setTimeout(r, 10));
    expect(hub.opened()).toBe(1);
    hub.push(job('succeeded'));
    await waiting;
    expect(seenA).toEqual(['succeeded']);
    expect(seenB).toEqual(['succeeded']);
    expect(hub.open()).toBe(true); // still listened to
    offA();
    offB();
    expect(hub.open()).toBe(false); // closed with the last listener
  });
});
