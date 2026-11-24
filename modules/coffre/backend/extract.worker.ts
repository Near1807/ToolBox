// v0.47.1: the reading of the texts OUT of the server's thread (a worker
// thread, ADR 0056 note v0.47.1): a 300-page PDF never slows the API. One
// file at a time; the main thread stops it after a maximum time, and starts
// a new one when it crashed. Read only: it opens the file, never writes.
import { parentPort } from 'node:worker_threads';
import { extractFile, extractProject, setPdfjsFile, type Extracted } from './extract';

export interface ExtractJob {
  id: number;
  kind: 'file' | 'project';
  file: string;
  ext: string;
  /** pdf.js for Node, found by the main thread (next to the bundle, or node_modules). */
  pdfjs: string;
}
export interface ExtractAnswer {
  id: number;
  result?: Extracted;
  error?: string;
}

parentPort?.on('message', (job: ExtractJob) => {
  setPdfjsFile(job.pdfjs);
  const run = job.kind === 'project' ? extractProject(job.file) : extractFile(job.file, job.ext);
  run
    .then((result) => parentPort!.postMessage({ id: job.id, result } satisfies ExtractAnswer))
    .catch((error: unknown) =>
      parentPort!.postMessage({ id: job.id, error: String(error) } satisfies ExtractAnswer),
    );
});
