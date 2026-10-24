// The two speech engines, each kept running between requests so their model
// stays loaded (the slowest part):
// - whisper.cpp `whisper-server` (HTTP on 127.0.0.1, POST /inference);
// - Piper (one process reading one sentence per line on stdin and writing one
//   WAV per sentence in a folder, its path printed on stdout).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

export interface TranscribeOptions {
  /**
   * Expected words (names of the tracks, of the tools, English words) given to
   * whisper.cpp as its « initial prompt »: they are then written as expected.
   */
  prompt?: string;
  signal?: AbortSignal;
}

export interface Transcriber {
  transcribe(wav: Buffer, options?: TranscribeOptions): Promise<string>;
}

export interface Synthesizer {
  /** Synthesises one sentence; resolves with the WAV file. */
  speak(text: string): Promise<string>;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** Last lines of a process' output, for error messages. */
class Tail {
  private lines: string[] = [];
  push(chunk: Buffer | string): void {
    this.lines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    if (this.lines.length > 20) this.lines = this.lines.slice(-20);
  }
  text(): string {
    return this.lines.slice(-4).join(' · ');
  }
}

/** Transcription artefacts of Whisper on silence or music. */
const NOISE =
  /\[(?:blank_audio|musique|music|silence|rires?|applaudissements)\]|\((?:musique|music|silence|rires?)\)|♪+/gi;

export function cleanTranscript(text: string): string {
  return text.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
}

export class WhisperServer implements Transcriber {
  private process: ChildProcess | null = null;
  private url: string | null = null;
  private starting: Promise<void> | null = null;
  private readonly tail = new Tail();

  constructor(
    private readonly options: {
      executable: string;
      model: string;
      threads: number;
      language?: string;
      /** Arguments placed before the others (tests: a script run by Node). */
      prefixArgs?: string[];
    },
  ) {}

  get running(): boolean {
    return this.process !== null && this.url !== null;
  }

  /** Starts the server and waits until it answers (the model is loaded). */
  start(): Promise<void> {
    this.starting ??= this.launch().catch((error: unknown) => {
      this.starting = null;
      this.stop();
      throw error;
    });
    return this.starting;
  }

  private async launch(): Promise<void> {
    const port = await freePort();
    const args = [
      '-m',
      this.options.model,
      '-l',
      this.options.language ?? 'fr',
      '-t',
      String(this.options.threads),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ];
    const child = spawn(this.options.executable, [...(this.options.prefixArgs ?? []), ...args], {
      cwd: path.dirname(this.options.executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process = child;
    child.stdout?.on('data', (chunk: Buffer) => this.tail.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.tail.push(chunk));
    const exited = new Promise<never>((_resolve, reject) => {
      child.once('error', (error) =>
        reject(new Error(`whisper-server ne démarre pas : ${error.message}`)),
      );
      child.once('exit', (code) => {
        this.process = null;
        this.url = null;
        this.starting = null;
        reject(new Error(`whisper-server s’est arrêté (code ${code}) : ${this.tail.text()}`));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const ready = (async () => {
      for (let i = 0; i < 240; i++) {
        try {
          const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(1000) });
          if (response.status < 500) return;
        } catch {
          // Not listening yet: the model is loading.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('whisper-server ne répond pas après 60 s');
    })();
    await Promise.race([ready, exited]);
    exited.catch(() => {});
    this.url = base;
  }

  async transcribe(wav: Buffer, options: TranscribeOptions = {}): Promise<string> {
    const { signal, prompt } = options;
    await this.start();
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.set('response_format', 'json');
    form.set('language', this.options.language ?? 'fr');
    form.set('temperature', '0.0');
    form.set('no_timestamps', 'true');
    // whisper-server reads it per request (field « prompt », whisper.cpp v1.9 server).
    if (prompt) form.set('prompt', prompt);
    const response = await fetch(`${this.url}/inference`, { method: 'POST', body: form, signal });
    if (!response.ok)
      throw new Error(`Transcription en échec (${response.status}) : ${await response.text()}`);
    const body = (await response.json()) as { text?: string; error?: string };
    if (body.error) throw new Error(`Transcription en échec : ${body.error}`);
    return cleanTranscript(body.text ?? '');
  }

  stop(): void {
    this.process?.kill();
    this.process = null;
    this.url = null;
    this.starting = null;
  }
}

export class PiperVoice implements Synthesizer {
  private process: ChildProcess | null = null;
  private queue: {
    text: string;
    resolve: (file: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  private current: (typeof this.queue)[number] | null = null;
  private buffer = '';
  private readonly tail = new Tail();

  constructor(
    private readonly options: {
      executable: string;
      model: string;
      outputDir: string;
      /** 1 = normal; 1.2 = 20 % faster. */
      speed: number;
      speaker?: number;
      /** Arguments placed before the others (tests: a script run by Node). */
      prefixArgs?: string[];
    },
  ) {}

  private ensure(): ChildProcess {
    if (this.process) return this.process;
    mkdirSync(this.options.outputDir, { recursive: true });
    const args = [
      '--model',
      this.options.model,
      '--config',
      `${this.options.model}.json`,
      '--output_dir',
      this.options.outputDir,
      '--length_scale',
      (1 / Math.min(2, Math.max(0.5, this.options.speed))).toFixed(3),
      '--sentence_silence',
      '0.15',
    ];
    if (this.options.speaker !== undefined) args.push('--speaker', String(this.options.speaker));
    const child = spawn(this.options.executable, [...(this.options.prefixArgs ?? []), ...args], {
      cwd: path.dirname(this.options.executable),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line && this.current) {
          this.current.resolve(line);
          this.current = null;
          this.next();
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => this.tail.push(chunk));
    const fail = (message: string) => {
      this.process = null;
      const error = new Error(message);
      this.current?.reject(error);
      this.current = null;
      for (const item of this.queue.splice(0)) item.reject(error);
    };
    child.once('error', (error) => fail(`Piper ne démarre pas : ${error.message}`));
    child.once('exit', (code) => fail(`Piper s’est arrêté (code ${code}) : ${this.tail.text()}`));
    this.process = child;
    return child;
  }

  private next(): void {
    if (this.current || this.queue.length === 0) return;
    this.current = this.queue.shift()!;
    const child = this.ensure();
    child.stdin?.write(`${this.current.text.replace(/\s+/g, ' ').trim()}\n`);
  }

  speak(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, resolve, reject });
      try {
        this.ensure();
        this.next();
      } catch (error) {
        reject(error as Error);
      }
    });
  }

  stop(): void {
    this.process?.stdin?.end();
    this.process?.kill();
    this.process = null;
  }

  /** Deletes the sentences already played (older than `maxAgeMs`). */
  static cleanup(dir: string, maxAgeMs = 10 * 60_000): void {
    if (!existsSync(dir)) return;
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      try {
        if (name.endsWith('.wav') && now - statSync(file).mtimeMs > maxAgeMs)
          rmSync(file, { force: true });
      } catch {
        // Being played, or already gone.
      }
    }
  }
}
