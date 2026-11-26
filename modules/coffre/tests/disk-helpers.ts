// v0.46.0: what the disk's tests share — a hub with the Coffre, simulated
// volumes (folders standing for E:, F:…), files to deposit, a snapshot of a
// folder (to prove nothing was written), waiting for a job.
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { DiskStatusDto, ItemDto, ProposalDto } from '../shared/types';

export const API = '/api/modules/coffre';
/** sha256 of a file, read in pieces (any size: the 2 Go test). */
export function sha(file: string): string {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (let n = readSync(fd, buf); n > 0; n = readSync(fd, buf)) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

export interface DiskWorld {
  hub: TestHub;
  /** The simulated volumes (« E: », « F: »). */
  E: string;
  F: string;
  /** Where the test's original files are (the « Téléchargements »). */
  dl: string;
  close(): Promise<void>;
}

/** A hub with the Coffre and two simulated volumes (TOOLBOX_COFFRE_VOLUMES). */
export async function diskWorld(
  options: {
    dataDir?: string;
    host?: Parameters<typeof createTestHub>[0]['host'];
    /** Another world's volumes (a second PC seeing the same disk). */
    volumes?: { E: string; F: string };
    /** The machine's real volumes (C: to Z:), no simulated ones (the Windows CI's virtual disk). */
    realVolumes?: boolean;
  } = {},
): Promise<DiskWorld> {
  const base = mkdtempSync(path.join(tmpdir(), 'coffre-disk-'));
  const E = options.volumes?.E ?? path.join(base, 'E');
  const F = options.volumes?.F ?? path.join(base, 'F');
  const dl = path.join(base, 'dl');
  for (const d of [E, F, dl]) mkdirSync(d, { recursive: true });
  const before = process.env.TOOLBOX_COFFRE_VOLUMES;
  if (options.realVolumes) delete process.env.TOOLBOX_COFFRE_VOLUMES;
  else process.env.TOOLBOX_COFFRE_VOLUMES = [E, F].join(path.delimiter);
  const hub = await createTestHub({
    loadExamples: false,
    dataDir: options.dataDir,
    host: options.host,
    modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
  });
  return {
    hub,
    E,
    F,
    dl,
    close: async () => {
      await hub.close();
      if (before === undefined) delete process.env.TOOLBOX_COFFRE_VOLUMES;
      else process.env.TOOLBOX_COFFRE_VOLUMES = before;
    },
  };
}

export async function ok<T>(w: DiskWorld, method: string, url: string, body?: unknown): Promise<T> {
  const r = await w.hub.request<T>(method, url, body);
  if (r.status >= 400) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Deposits files (written in the « Téléchargements ») into a context; their sheets. */
export async function deposit(
  w: DiskWorld,
  files: Record<string, string | Buffer>,
  context = ['Cours', 'Thermo'],
): Promise<ItemDto[]> {
  const entries = Object.entries(files).map(([name, content]) => {
    const p = path.join(w.dl, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
    return { path: p, newContext: context, attributes: [] };
  });
  const r = await job<{ created: ItemDto[] }>(w, 'POST', `${API}/deposit/apply`, { entries });
  return r.created;
}

export async function registerDisk(w: DiskWorld, chosen: string, name = 'Disque 1 To') {
  mkdirSync(chosen, { recursive: true });
  return ok<DiskStatusDto>(w, 'POST', `${API}/disk/register`, { path: chosen, name });
}

export const status = (w: DiskWorld) => ok<DiskStatusDto>(w, 'GET', `${API}/disk?look=1`);

/** Every file and folder under `dir` with its size and date: equal snapshots = nothing written. */
export function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const s = statSync(full);
      out.push(`${path.relative(dir, full)}|${e.isDirectory() ? 'd' : s.size}|${s.mtimeMs}`);
      if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

interface Job {
  id: string;
  status: string;
  error: string | null;
  result: unknown;
  progress: number | null;
  details?: {
    done: number | null;
    total: number | null;
    errorCount: number;
    errors: { item: string; reason: string }[];
  } | null;
}

/**
 * v0.49.0: a route that starts a background task ({ jobId }): waits for it
 * and gives its result; a task that did not succeed throws its error.
 */
export async function job<T>(
  w: DiskWorld,
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const { jobId } = await ok<{ jobId: string }>(w, method, url, body);
  const done = await waitJob(w, jobId);
  if (done.status !== 'succeeded') throw new Error(`${url} → ${done.status} ${done.error ?? ''}`);
  return done.result as T;
}

/** The analysis' proposals (POST /deposit/analyze, a task since v0.49.0). */
export async function analyze(w: DiskWorld, body: unknown): Promise<ProposalDto[]> {
  return (await job<{ proposals: ProposalDto[] }>(w, 'POST', `${API}/deposit/analyze`, body))
    .proposals;
}

/** Waits for a job of the Coffre to end; its info. */
export async function waitJob(w: DiskWorld, id: string, timeoutMs = 60_000): Promise<Job> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const jobs = await ok<Job[]>(w, 'GET', '/api/core/jobs?module=coffre');
    const job = jobs.find((j) => j.id === id);
    if (job && !['queued', 'running'].includes(job.status)) return job;
    if (Date.now() > end) throw new Error(`Tâche ${id} pas finie`);
    await new Promise((r) => setTimeout(r, 40));
  }
}
