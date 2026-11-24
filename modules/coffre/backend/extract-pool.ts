// v0.47.1: the worker thread that reads the texts (extract.worker.ts) — one
// job at a time, a maximum time per file (then « illisible : trop long »,
// read again at the next start), a new worker when it crashed or was
// stopped. The server's thread only waits for answers: it stays free.
import { existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { pdfjsFile, type Extracted } from './extract';
import type { ExtractAnswer, ExtractJob } from './extract.worker';

/** Longer than this, a file is « illisible : trop long » (read again at the next start). */
export const MAX_EXTRACT_MS = 60_000;
/** The maximum time (the tests shorten it with TOOLBOX_COFFRE_EXTRACT_MAX_MS). */
const defaultMaxMs = () => Number(process.env.TOOLBOX_COFFRE_EXTRACT_MAX_MS ?? MAX_EXTRACT_MS);

let built: string | null = null;
/**
 * The worker's file: built with the app (build/main/workers/coffre/extract.worker.cjs,
 * see scripts/esbuild-config.mjs); in development and tests, bundled once here
 * (esbuild, a development dependency, never loaded by the installed app).
 */
export function workerFile(): string {
  const shipped = path
    .join(__dirname, 'workers', 'coffre', 'extract.worker.cjs')
    .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (existsSync(shipped)) return shipped;
  if (built && existsSync(built)) return built;
  const source = path.join(__dirname, 'extract.worker.ts');
  if (!existsSync(source)) throw new Error('Lecteur de texte introuvable');
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'toolbox-extract-')), 'extract.worker.cjs');
  const esbuild = createRequire(__filename)('esbuild') as {
    buildSync(o: Record<string, unknown>): unknown;
  };
  esbuild.buildSync({
    entryPoints: [source],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
    alias: { '@hub/sdk': path.resolve(__dirname, '..', '..', '..', 'packages', 'sdk') },
  });
  built = out;
  return out;
}

export class ExtractPool {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: {
    id: number;
    resolve: (r: Extracted) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /** Workers started (the first, then one after each crash or time-out): the tests read it. */
  started = 0;

  constructor(private readonly maxMs = defaultMaxMs()) {}

  private spawn(): Worker {
    const w = new Worker(workerFile());
    this.started++;
    w.unref();
    w.on('message', (answer: ExtractAnswer) => {
      const p = this.pending;
      if (!p || p.id !== answer.id) return;
      this.settle(
        answer.result ?? { status: 'error', parts: [], error: answer.error ?? 'erreur inconnue' },
      );
    });
    const gone = (why: string) => {
      if (this.worker !== w) return;
      this.worker = null;
      this.settle({
        status: 'error',
        parts: [],
        error: `illisible : le lecteur s’est arrêté (${why})`,
      });
    };
    w.on('error', (e) => gone(String(e)));
    w.on('exit', (code) => gone(`code ${code}`));
    return w;
  }

  private settle(r: Extracted) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.resolve(r);
  }

  /** Reads one file (or project) in the worker; never throws. */
  run(kind: 'file' | 'project', file: string, ext: string): Promise<Extracted> {
    if (this.pending) throw new Error('Une lecture à la fois');
    this.worker ??= this.spawn();
    const id = this.nextId++;
    return new Promise<Extracted>((resolve) => {
      const timer = setTimeout(() => {
        // Too long: this worker is stopped (a new one for the next file).
        const w = this.worker;
        this.worker = null;
        this.settle({
          status: 'toolong',
          parts: [],
          error: `illisible : trop long (plus de ${Math.round(this.maxMs / 1000)} s)`,
        });
        void w?.terminate();
      }, this.maxMs);
      this.pending = { id, resolve, timer };
      this.worker!.postMessage({ id, kind, file, ext, pdfjs: pdfjsFile() } satisfies ExtractJob);
    });
  }

  /** Stops the worker (ToolBox closes): the file in progress is read again at the next start. */
  async stop(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this.settle({ status: 'error', parts: [], error: 'interrompu' });
    await w?.terminate();
  }
}
