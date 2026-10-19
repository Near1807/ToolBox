import { spawn } from 'node:child_process';
import { parseProgressLine } from './commands';

export class RenderCancelled extends Error {
  constructor() {
    super('Annulée');
    this.name = 'RenderCancelled';
  }
}

/**
 * Runs FFmpeg, reports the encoded position (seconds) from `-progress pipe:1`,
 * and kills it when `signal` aborts. Rejects with the end of FFmpeg's error output.
 */
export function runFfmpeg(options: {
  ffmpeg: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onTime?: (seconds: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new RenderCancelled());

    const child = spawn(options.ffmpeg, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });
    let stderr = '';
    let buffer = '';

    const onAbort = () => child.kill();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const seconds = parseProgressLine(line);
        if (seconds !== null) options.onTime?.(seconds);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Impossible de lancer FFmpeg : ${error.message}`));
    });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) return reject(new RenderCancelled());
      if (code === 0) return resolve();
      const detail = stderr.trim().split('\n').slice(-3).join(' | ');
      reject(new Error(`FFmpeg a échoué (code ${code})${detail ? ` : ${detail}` : ''}`));
    });
  });
}
