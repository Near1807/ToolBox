import { createHash } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { Brain, toolName, toolSchemas, yesNo } from '../backend/brain';
import { download, extract, findExecutable } from '../backend/download';
import { cleanTranscript, PiperVoice, WhisperServer } from '../backend/engines';
import { recommend } from '../backend/hardware';
import { OllamaClient } from '../backend/ollama';
import { SentenceSplitter, speakable } from '../backend/sentences';

const FIXTURES = path.join(__dirname, 'fixtures');
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'assistant-engines-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('speech engines (fake processes, same protocol)', () => {
  it('starts whisper-server once, sends the WAV, cleans the transcript', async () => {
    const server = new WhisperServer({
      executable: process.execPath,
      prefixArgs: [path.join(FIXTURES, 'fake-whisper-server.mjs')],
      model: 'ggml-base.bin',
      threads: 2,
    });
    try {
      expect(await server.transcribe(Buffer.alloc(4000))).toBe('bonjour (fr, audio reçu)');
      expect(server.running).toBe(true);
      expect(await server.transcribe(Buffer.alloc(10))).toBe('bonjour (fr, vide)');
    } finally {
      server.stop();
    }
  });

  it('keeps Piper running: one sentence per line, one WAV each, in order', async () => {
    const voice = new PiperVoice({
      executable: process.execPath,
      prefixArgs: [path.join(FIXTURES, 'fake-piper.mjs')],
      model: 'voice.onnx',
      outputDir: path.join(dir, 'speech'),
      speed: 1.25,
    });
    try {
      const files = await Promise.all([
        voice.speak('Première phrase.'),
        voice.speak('Deuxième\nphrase.'),
      ]);
      expect(readFileSync(files[0]!, 'utf8')).toBe('RIFF 0.800 Première phrase.');
      expect(readFileSync(files[1]!, 'utf8')).toBe('RIFF 0.800 Deuxième phrase.');
    } finally {
      voice.stop();
    }
  });

  it('removes Whisper artefacts', () => {
    expect(cleanTranscript(' [Musique] (musique) ♪♪ ')).toBe('');
    expect(cleanTranscript(' Ajoute une tâche. [BLANK_AUDIO]')).toBe('Ajoute une tâche.');
  });
});

describe('Ollama client (fake server, NDJSON streaming)', () => {
  let server: Server;
  let base: string;
  let lastBody: Record<string, unknown> = {};
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastBody = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.12.3' }));
        if (req.url === '/api/tags')
          return res.end(
            JSON.stringify({
              models: [{ name: 'ministral-3:3b', size: 3e9, details: { parameter_size: '3B' } }],
            }),
          );
        if (req.url === '/api/show') {
          if (lastBody.model === 'nope') {
            res.statusCode = 404;
            return res.end(JSON.stringify({ error: "model 'nope' not found" }));
          }
          return res.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
        }
        if (req.url === '/api/pull') {
          res.write(`${JSON.stringify({ status: 'pulling manifest' })}\n`);
          res.write(`${JSON.stringify({ status: 'pulling abc', total: 100, completed: 50 })}\n`);
          return res.end(`${JSON.stringify({ status: 'success' })}\n`);
        }
        if (req.url === '/api/chat') {
          res.write(
            `${JSON.stringify({ message: { role: 'assistant', content: 'Bon' }, done: false })}\n`,
          );
          res.write(
            `${JSON.stringify({ message: { role: 'assistant', content: 'jour.' }, done: false })}\n`,
          );
          res.write(
            `${JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'todo__list_tasks', arguments: { filter: 'today' } } }] }, done: false })}\n`,
          );
          return res.end(
            `${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 812, eval_count: 9, total_duration: 2_500_000_000 })}\n`,
          );
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reads version, models, capabilities, pull progress and a streamed chat with tools', async () => {
    const client = new OllamaClient(() => base);
    expect(await client.version()).toBe('0.12.3');
    expect(await client.models()).toEqual([
      { name: 'ministral-3:3b', size: 3e9, parameterSize: '3B' },
    ]);
    expect(await client.capabilities('ministral-3:3b')).toEqual(['completion', 'tools']);
    await expect(client.capabilities('nope')).rejects.toMatchObject({ kind: 'missing-model' });
    const progress: (number | null)[] = [];
    await client.pull('ministral-3:3b', (f) => progress.push(f));
    expect(progress).toEqual([null, 0.5, null]);
    const tokens: string[] = [];
    const result = await client.chat({ model: 'm', messages: [], tools: [], think: false }, (t) =>
      tokens.push(t),
    );
    expect(lastBody).toMatchObject({ model: 'm', stream: true, think: false, keep_alive: '30m' });
    expect(tokens).toEqual(['Bon', 'jour.']);
    expect(result).toMatchObject({
      content: 'Bonjour.',
      promptEvalCount: 812,
      evalCount: 9,
      totalDurationMs: 2500,
    });
    expect(result.toolCalls).toEqual([
      { function: { name: 'todo__list_tasks', arguments: { filter: 'today' } } },
    ]);
  });

  it('reports Ollama off', async () => {
    const client = new OllamaClient(() => 'http://127.0.0.1:9');
    expect(await client.version()).toBeNull();
    await expect(client.models()).rejects.toMatchObject({ kind: 'offline' });
  });
});

describe('downloads', () => {
  it('downloads with progress and a checked SHA-1, resumes, extracts a zip safely', async () => {
    const zipFile = path.join(dir, 'engine.zip');
    await new Promise<void>((resolve) => {
      const zip = new yazl.ZipFile();
      zip.addBuffer(Buffer.from('#!/bin/sh'), 'Release/whisper-server.exe');
      zip.addBuffer(Buffer.from('dll'), 'Release/ggml.dll');
      zip.end();
      zip.outputStream.pipe(createWriteStream(zipFile)).on('close', () => resolve());
    });
    const content = readFileSync(zipFile);
    const fetchFn = async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
      return new Response(content.subarray(from), {
        status: range ? 206 : 200,
        headers: { 'content-length': String(content.length - from) },
      });
    };
    const target = path.join(dir, 'dl', 'engine.zip');
    // A previous attempt stopped half way: it resumes.
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(`${target}.part`, content.subarray(0, 50));
    const seen: (number | null)[] = [];
    const sha1 = createHash('sha1').update(content).digest('hex');
    await download({
      url: 'https://example.test/engine.zip',
      target,
      sha1,
      fetchFn,
      onProgress: (f) => seen.push(f),
    });
    expect(readFileSync(target).equals(content)).toBe(true);
    expect(seen.at(-1)).toBe(1);
    await expect(
      download({
        url: 'x',
        target: path.join(dir, 'dl', 'bad.zip'),
        sha1: '0'.repeat(40),
        fetchFn,
      }),
    ).rejects.toThrow(/abîmé/);

    await extract(target, path.join(dir, 'engine'));
    expect(findExecutable(path.join(dir, 'engine'), 'whisper-server')).toBe(
      path.join(dir, 'engine', 'Release', 'whisper-server.exe'),
    );
  });
});

describe('brain helpers', () => {
  it('understands short yes / no answers only', () => {
    expect(yesNo('Oui')).toBe('yes');
    expect(yesNo('oui vas-y')).toBe('yes');
    expect(yesNo('d’accord')).toBe('yes');
    expect(yesNo('Non, laisse tomber.')).toBe('no');
    expect(yesNo('annule')).toBe('no');
    expect(yesNo('ajoute une tâche pour demain')).toBeNull();
    expect(yesNo('oui mais en fait ajoute plutôt une autre tâche pour demain matin')).toBeNull();
  });

  it('describes the actions as tools', () => {
    const [tool] = toolSchemas([
      {
        id: 'todo.add-task',
        moduleId: 'todo',
        moduleName: 'To-do',
        name: 'add-task',
        description: 'Ajoute une tâche.',
        parameters: {
          tags: { type: 'string[]', description: 'Tags' },
          filter: { type: 'string', description: 'f', enum: ['a'] },
        },
        required: [],
        risk: 'destructive',
        page: null,
        examples: [],
        extracts: false,
        right: null,
      },
    ]);
    expect(toolName('release-planner.agenda')).toBe('release_planner__agenda');
    expect(tool!.function.name).toBe('todo__add_task');
    expect(tool!.function.description).toMatch(
      /^\[To-do\] Ajoute une tâche\. La confirmation est demandée/,
    );
    expect(tool!.function.parameters.properties).toEqual({
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
      filter: { type: 'string', description: 'f', enum: ['a'] },
    });
  });

  it('cuts streamed text into speakable sentences', () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push('Bonjour **Thomas** ! Il est ')).toEqual(['Bonjour Thomas !']);
    expect(splitter.push('3.5 fois mieux, cf. le Labo. Et ')).toEqual([
      'Il est 3.5 fois mieux, cf. le Labo.',
    ]);
    expect(splitter.push('voilà 🎉')).toEqual([]);
    expect(splitter.flush()).toEqual(['Et voilà']);
    expect(speakable('- **gras** et `code`')).toBe('gras et code');
  });

  it('keeps the context between turns but forgets it on reset', async () => {
    const seen: number[] = [];
    const brain = new Brain({
      model: () => ({
        chat: async (request, onToken) => {
          seen.push(request.messages.length);
          onToken('Oui.');
          return {
            content: 'Oui.',
            toolCalls: [],
            promptEvalCount: 0,
            evalCount: 0,
            totalDurationMs: 0,
          };
        },
      }),
      modelName: () => 'm',
      think: () => undefined,
      actions: () => [],
      run: async () => ({ status: 'invalid', id: 'x', message: 'x' }),
      open: () => {},
    });
    await brain.handle('un', () => {});
    await brain.handle('deux', () => {});
    brain.reset();
    await brain.handle('trois', () => {});
    expect(seen).toEqual([2, 4, 2]);
  });
});

describe('recommendation', () => {
  it('fits the model to the graphics card, Whisper to the processor', () => {
    expect(
      recommend({
        ramGb: 32,
        threads: 16,
        cpu: '',
        gpus: [{ name: 'RTX 4070', vramGb: 12, nvidia: true }],
      }),
    ).toMatchObject({ model: 'ministral-3:14b', whisper: 'small' });
    expect(
      recommend({
        ramGb: 16,
        threads: 8,
        cpu: '',
        gpus: [{ name: 'RTX 3060 Ti', vramGb: 8, nvidia: true }],
      }).model,
    ).toBe('ministral-3:8b');
    const cpuOnly = recommend({
      ramGb: 8,
      threads: 4,
      cpu: '',
      gpus: [{ name: 'Intel Iris', vramGb: null, nvidia: false }],
    });
    expect(cpuOnly).toMatchObject({ model: 'ministral-3:3b', whisper: 'base' });
    expect(cpuOnly.reason).toMatch(/Pas de carte graphique NVIDIA/);
  });
});
