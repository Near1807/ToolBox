import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobInfo, ModuleJobs } from '@hub/sdk/backend';
import { createTestHub, type TestHub } from '@hub/sdk/testing';
import { fakeModule } from '../helpers/fake-modules';

const hubs: TestHub[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close().catch(() => {});
});

async function waitFor(
  jobs: ModuleJobs,
  id: string,
  statuses: JobInfo['status'][],
): Promise<JobInfo> {
  for (let i = 0; i < 200; i++) {
    const job = jobs.get(id);
    if (job && statuses.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${id} never reached ${statuses.join('/')}`);
}

async function hubWithJobs(define: (jobs: ModuleJobs) => void, dataDir?: string) {
  let jobs!: ModuleJobs;
  const hub = await createTestHub({
    dataDir,
    modules: [
      fakeModule('worker', {
        backend: {
          register: (ctx) => {
            jobs = ctx.jobs;
            define(ctx.jobs);
          },
        },
      }),
    ],
  });
  hubs.push(hub);
  return { hub, jobs };
}

describe('jobs', () => {
  it('runs a job and stores its result', async () => {
    const { jobs } = await hubWithJobs((j) =>
      j.define<{ a: number }, number>('double', async (job) => {
        job.progress(0.5, 'moitié');
        return job.input.a * 2;
      }),
    );
    const queued = jobs.enqueue('double', { a: 21 }, { title: 'Double' });
    const done = await waitFor(jobs, queued.id, ['succeeded']);
    expect(done).toMatchObject({ result: 42, progress: 1, title: 'Double' });
  });

  it('records failures with their message', async () => {
    const { jobs } = await hubWithJobs((j) =>
      j.define('fail', async () => {
        throw new Error('FFmpeg a planté');
      }),
    );
    const job = jobs.enqueue('fail', null, { title: 'Échec' });
    expect((await waitFor(jobs, job.id, ['failed'])).error).toBe('FFmpeg a planté');
  });

  it('cancels running and queued jobs', async () => {
    const { jobs } = await hubWithJobs((j) =>
      j.define(
        'wait',
        (job) =>
          new Promise((_, reject) =>
            job.signal.addEventListener('abort', () => reject(new Error('stop'))),
          ),
      ),
    );
    const first = jobs.enqueue('wait', null, { title: '1' });
    const second = jobs.enqueue('wait', null, { title: '2' });
    await waitFor(jobs, first.id, ['running']);
    expect(jobs.get(second.id)?.status).toBe('queued'); // concurrency 1 by default
    expect(jobs.cancel(second.id)).toBe(true);
    expect(jobs.cancel(first.id)).toBe(true);
    expect((await waitFor(jobs, first.id, ['cancelled'])).message).toBe('Annulée');
    expect(jobs.get(second.id)?.status).toBe('cancelled');
  });

  it('respects the concurrency limit', async () => {
    let running = 0;
    let peak = 0;
    const { jobs } = await hubWithJobs((j) =>
      j.define(
        'slow',
        async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 20));
          running--;
        },
        { concurrency: 2 },
      ),
    );
    const ids = [1, 2, 3, 4, 5].map((n) => jobs.enqueue('slow', null, { title: String(n) }).id);
    for (const id of ids) await waitFor(jobs, id, ['succeeded']);
    expect(peak).toBe(2);
  });

  it('marks jobs left running by a previous session as interrupted', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'toolbox-jobs-'));
    const first = await hubWithJobs(
      (j) => j.define('forever', () => new Promise(() => {})),
      dataDir,
    );
    const job = first.jobs.enqueue('forever', null, { title: 'Rendu' });
    await waitFor(first.jobs, job.id, ['running']);
    // Simulate a crash: the row stays "running" in the database.
    first.hub.hub.handle.db
      .prepare("UPDATE core__jobs SET status = 'running' WHERE id = ?")
      .run(job.id);
    hubs.splice(hubs.indexOf(first.hub), 1);
    first.hub.hub.handle.close();

    const second = await hubWithJobs(
      (j) => j.define('forever', () => new Promise(() => {})),
      dataDir,
    );
    expect(second.jobs.get(job.id)?.status).toBe('interrupted');
  });

  it('exposes jobs through the API', async () => {
    const { hub, jobs } = await hubWithJobs((j) => j.define('noop', async () => 'ok'));
    const job = jobs.enqueue('noop', null, { title: 'Rien' });
    await waitFor(jobs, job.id, ['succeeded']);
    const { body } = await hub.request<JobInfo[]>('GET', '/api/core/jobs?module=worker');
    expect(body.map((j) => j.id)).toEqual([job.id]);
  });
});
