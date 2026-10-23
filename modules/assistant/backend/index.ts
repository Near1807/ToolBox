// Assistant vocal (V1): push-to-talk → whisper.cpp → local model (Ollama,
// tools = the actions of every module) → Piper. Everything runs on this PC;
// only the first downloads use the Internet. ADR 0029.
import { spawn } from 'node:child_process';
import { existsSync, statfsSync } from 'node:fs';
import { delimiter } from 'node:path';
import path from 'node:path';
import os from 'node:os';
import {
  defineBackendModule,
  HttpError,
  idParam,
  openEventStream,
  requestBody,
  type EventStream,
  type HotkeySpec,
  type ModuleContext,
  type SettingValue,
} from '@hub/sdk/backend';
import type { AssistantState, StatusDto, TurnDto } from '../shared';
import { Brain, type BrainResult } from './brain';
import { ENGINES, MODEL_CHOICES, VOICES, WHISPER_MODELS, DEFAULT_VOICE } from './catalog';
import { download, extract, findExecutable } from './download';
import { PiperVoice, WhisperServer, type Synthesizer, type Transcriber } from './engines';
import { detectHardware, recommend, type Hardware, type Recommendation } from './hardware';
import { OllamaClient, type ChatModel } from './ollama';

/** Overrides for tests (fake model, fake engines). */
export interface AssistantTestHooks {
  chatModel?: ChatModel;
  transcriber?: Transcriber;
  synthesizer?: Synthesizer;
  hardware?: Hardware;
}
let testHooks: AssistantTestHooks = {};
export function setAssistantTestHooks(hooks: AssistantTestHooks): void {
  testHooks = hooks;
}

const MAX_RECORDING_MS = 30_000;
const HOLD_MS = 350;
const MAX_TURNS = 50;

type InstallTarget = 'whisper-engine' | 'whisper-model' | 'piper-engine' | 'voice' | 'llm';

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const file of [name, `${name}.exe`]) {
      const full = path.join(dir, file);
      if (dir && existsSync(full)) return full;
    }
  }
  return null;
}

function parseKey(value: string | null): HotkeySpec | null {
  const match = /^(\d+)\|(.*)$/.exec(value ?? '');
  return match ? { code: Number(match[1]), label: match[2]! } : null;
}

export default defineBackendModule({
  register(ctx: ModuleContext) {
    const setting = <T extends SettingValue>(key: string) => ctx.settings.get<T>(key);
    const ollama = new OllamaClient(() => setting<string>('ollamaUrl') || 'http://127.0.0.1:11434');
    let hardware: Hardware | null = testHooks.hardware ?? null;
    let recommendation: Recommendation | null = hardware ? recommend(hardware) : null;
    const hardwareReady = (async () => {
      if (hardware) return;
      try {
        hardware = await detectHardware();
        recommendation = recommend(hardware);
      } catch (error) {
        ctx.logger.warn('Détection du matériel impossible', error);
      }
    })();

    // --- Choices and files -------------------------------------------------------

    const modelName = () => setting<string>('model') || recommendation?.model || 'ministral-3:3b';
    const whisperId = () => {
      const id = setting<string>('whisperModel') || recommendation?.whisper || 'base';
      return WHISPER_MODELS.some((m) => m.id === id) ? id : 'base';
    };
    const voiceInfo = () =>
      VOICES.find((v) => v.id === setting<string>('voice')) ??
      VOICES.find((v) => v.id === DEFAULT_VOICE)!;
    const whisperModelPath = (id = whisperId()) => ctx.files.dataPath('models', `ggml-${id}.bin`);
    const voicePath = (voice = voiceInfo()) =>
      ctx.files.dataPath('voices', path.basename(voice.model.url));
    const speechDir = ctx.files.dataPath('speech');
    const engineDir = (name: 'whisper' | 'piper') => ctx.files.dataPath('engines', name);
    const whisperExe = () =>
      process.env.TOOLBOX_WHISPER_SERVER ||
      findExecutable(engineDir('whisper'), ENGINES.whisper.executable) ||
      onPath('whisper-server');
    const piperExe = () =>
      process.env.TOOLBOX_PIPER || findExecutable(engineDir('piper'), ENGINES.piper.executable);

    // --- Engines (started on first use, kept running) -----------------------------

    let whisper: WhisperServer | null = null;
    let whisperKey = '';
    const transcriber = (): Transcriber => {
      if (testHooks.transcriber) return testHooks.transcriber;
      const exe = whisperExe();
      if (!exe)
        throw new HttpError(
          409,
          'La reconnaissance vocale n’est pas installée : page de l’assistant, « Installer ».',
        );
      const model = whisperModelPath();
      if (!existsSync(model))
        throw new HttpError(
          409,
          `Le modèle de reconnaissance « ${whisperId()} » n’est pas téléchargé.`,
        );
      const key = `${exe}|${model}`;
      if (!whisper || whisperKey !== key) {
        whisper?.stop();
        whisper = new WhisperServer({
          executable: exe,
          model,
          threads: Math.max(1, Math.min(8, (hardware?.threads ?? os.cpus().length) - 1)),
        });
        whisperKey = key;
      }
      return whisper;
    };

    let piper: PiperVoice | null = null;
    let piperKey = '';
    const synthesizer = (): Synthesizer | null => {
      if (testHooks.synthesizer) return testHooks.synthesizer;
      const exe = piperExe();
      const voice = voiceInfo();
      const model = voicePath(voice);
      if (!exe || !existsSync(model)) return null;
      const speed = setting<number>('speed') ?? 1;
      const key = `${exe}|${model}|${speed}|${voice.speaker ?? ''}`;
      if (!piper || piperKey !== key) {
        piper?.stop();
        piper = new PiperVoice({
          executable: exe,
          model,
          outputDir: speechDir,
          speed,
          speaker: voice.speaker,
        });
        piperKey = key;
      }
      return piper;
    };

    // Capabilities of the chosen model (tools, thinking), cached.
    const capabilities = new Map<string, string[]>();
    const capabilitiesOf = async (model: string) => {
      if (!capabilities.has(model)) {
        try {
          capabilities.set(model, await ollama.capabilities(model));
        } catch {
          return null;
        }
      }
      return capabilities.get(model)!;
    };

    const brain = new Brain({
      model: () => testHooks.chatModel ?? ollama,
      modelName,
      think: () => (capabilities.get(modelName())?.includes('thinking') ? false : undefined),
      actions: () => ctx.assistant.actions(),
      run: (id, params, options) => ctx.assistant.run(id, params, options),
      open: (route) => ctx.ui.open(route),
      directReads: () => setting<boolean>('directReads') === true,
    });

    // --- Live state (SSE) and history (memory only: gone when the app closes) -----

    const streams = new Set<EventStream>();
    const broadcast = (event: string, data: unknown) => {
      for (const stream of streams) stream.send(event, data);
    };
    let state: AssistantState = 'idle';
    let stateText: string | null = null;
    let toggleMode = false;
    let overlayTimer: ReturnType<typeof setTimeout> | null = null;
    const setState = (next: AssistantState, text: string | null = stateText) => {
      state = next;
      stateText = text;
      broadcast('state', { state, text, toggle: toggleMode });
      if (overlayTimer) clearTimeout(overlayTimer);
      if (next === 'idle') overlayTimer = setTimeout(() => ctx.ui.setOverlay(false), 2500);
      else ctx.ui.setOverlay(true);
    };

    const turns: TurnDto[] = [];
    let nextTurn = 1;
    const publish = (turn: TurnDto) => broadcast('turn', turn);

    // --- Listening ---------------------------------------------------------------

    let listenTimer: ReturnType<typeof setTimeout> | null = null;
    let releasedAt = 0;
    let pressedAt = 0;
    let speaking: { turnId: number; pending: number; ended: boolean } | null = null;

    const startListening = () => {
      if (state === 'transcribing' || state === 'thinking') return false;
      if (state === 'speaking') broadcast('speech-stop', {});
      speaking = null;
      setState('listening', null);
      broadcast('record', { action: 'start' });
      if (listenTimer) clearTimeout(listenTimer);
      listenTimer = setTimeout(() => stopListening(), MAX_RECORDING_MS);
      return true;
    };
    const stopListening = () => {
      if (state !== 'listening') return false;
      if (listenTimer) clearTimeout(listenTimer);
      toggleMode = false;
      releasedAt = Date.now();
      setState('transcribing', null);
      broadcast('record', { action: 'stop' });
      return true;
    };

    // Push-to-talk: held = talk while held; a quick tap = tap again to finish (keys
    // such as the Copilot key on some PCs send their release right away).
    const bindKey = () => {
      if (!ctx.hotkeys.status().available) return;
      ctx.hotkeys.hold(parseKey(setting<string>('pushToTalkKey')), {
        onPress: () => {
          pressedAt = Date.now();
          if (state === 'listening' && toggleMode) stopListening();
          else startListening();
        },
        onRelease: () => {
          if (state !== 'listening') return;
          if (Date.now() - pressedAt >= HOLD_MS) stopListening();
          else {
            toggleMode = true;
            setState('listening', null);
          }
        },
      });
    };
    bindKey();
    ctx.settings.onChange((key) => {
      if (key === 'pushToTalkKey') bindKey();
      if (key === 'model') capabilities.clear();
    });

    // --- A turn: text → brain → voice ------------------------------------------------

    const speakSentence = (
      turn: TurnDto,
      index: number,
      sentence: string,
      firstAt: { t: number | null },
    ) => {
      const voice = setting<boolean>('speakReplies') !== false ? synthesizer() : null;
      if (!voice) return null;
      speaking ??= { turnId: turn.id, pending: 0, ended: false };
      speaking.pending++;
      const started = Date.now();
      return voice
        .speak(sentence)
        .then((file) => {
          if (index === 0) turn.latency.voiceMs = Date.now() - started;
          if (firstAt.t === null) {
            firstAt.t = Date.now();
            if (turn.source === 'voice' && releasedAt)
              turn.latency.firstAudioMs = firstAt.t - releasedAt;
          }
          if (speaking?.turnId !== turn.id) return; // interrupted
          setState('speaking', turn.reply || sentence);
          broadcast('speech', { turnId: turn.id, index, url: ctx.files.mediaUrl(file) });
        })
        .catch((error: unknown) => ctx.logger.warn('Voix indisponible', error))
        .finally(() => {
          if (speaking?.turnId === turn.id) speaking.pending--;
        });
    };

    let busy: Promise<unknown> = Promise.resolve();
    const handleText = (
      text: string,
      source: 'voice' | 'text',
      transcribeMs: number | null,
    ): Promise<TurnDto> => {
      const run = async () => {
        PiperVoice.cleanup(speechDir);
        const turn: TurnDto = {
          id: nextTurn++,
          at: new Date().toISOString(),
          source,
          heard: text,
          reply: '',
          actions: [],
          pending: null,
          error: null,
          latency: {
            transcribeMs,
            thinkMs: null,
            firstSentenceMs: null,
            voiceMs: null,
            firstAudioMs: null,
            rounds: 0,
          },
        };
        turns.unshift(turn);
        turns.length = Math.min(turns.length, MAX_TURNS);
        setState('thinking', text);
        publish(turn);
        if (!capabilities.has(modelName()) && !testHooks.chatModel)
          await capabilitiesOf(modelName());
        const speeches: Promise<unknown>[] = [];
        let index = 0;
        const firstAt = { t: null as number | null };
        const result: BrainResult = await brain.handle(text, (sentence) => {
          const p = speakSentence(turn, index++, sentence, firstAt);
          if (p) speeches.push(p);
        });
        turn.reply = result.reply;
        turn.error = result.error;
        turn.actions = result.actions.map((a) => ({ ...a, undone: false }));
        turn.pending = result.pending
          ? { kind: result.pending.kind, question: result.reply }
          : null;
        turn.latency = {
          ...turn.latency,
          thinkMs: result.timings.thinkMs,
          firstSentenceMs: result.timings.firstSentenceMs,
          rounds: result.timings.rounds,
        };
        publish(turn);
        await Promise.all(speeches);
        publish(turn);
        if (speaking?.turnId === turn.id && index > 0) {
          speaking.ended = true;
          broadcast('speech-end', { turnId: turn.id, count: index });
          if (state !== 'speaking') setState('idle', turn.reply);
        } else {
          setState('idle', turn.reply);
        }
        return turn;
      };
      const next = busy.then(run, run);
      busy = next.catch(() => {});
      return next;
    };

    // --- Installs (job « install », progress in Tâches) ------------------------------

    const checkDisk = (bytes: number) => {
      try {
        const stats = statfsSync(ctx.files.dataPath());
        const free = stats.bavail * stats.bsize;
        if (free < bytes * 1.2)
          throw new HttpError(
            507,
            `Pas assez de place sur le disque (${Math.round(free / 1e6)} Mo libres).`,
          );
      } catch (error) {
        if (error instanceof HttpError) throw error;
      }
    };

    ctx.jobs.define<{ target: InstallTarget; id?: string }, { ok: true }>(
      'install',
      async (job) => {
        const { target } = job.input;
        const progress = (fraction: number | null, received?: number) =>
          job.progress(fraction, received ? `${Math.round(received / 1e6)} Mo` : undefined);
        if (target === 'llm') {
          const model = job.input.id || modelName();
          await ollama.pull(
            model,
            (fraction, status) => job.progress(fraction, status),
            job.signal,
          );
          capabilities.delete(model);
          const caps = await capabilitiesOf(model);
          if (caps && !caps.includes('tools')) {
            job.logger.warn(
              `Le modèle ${model} ne déclare pas l’appel d’outils : il ne pourra pas agir sur ToolBox.`,
            );
          }
          void ollama.preload(model).catch(() => {});
          return { ok: true };
        }
        if (target === 'whisper-engine' || target === 'piper-engine') {
          const name = target === 'whisper-engine' ? 'whisper' : 'piper';
          const engine = ENGINES[name];
          const source = process.platform === 'win32' ? engine.win32 : engine.linux;
          const archive = ctx.files.dataPath('downloads', path.basename(source.url));
          checkDisk(source.size * 3);
          await download({
            url: source.url,
            target: archive,
            expectedSize: source.size,
            signal: job.signal,
            onProgress: progress,
          });
          job.progress(null, 'Extraction…');
          await extract(archive, engineDir(name));
          if (!findExecutable(engineDir(name), engine.executable))
            throw new Error(`${engine.executable} introuvable dans l’archive`);
          return { ok: true };
        }
        if (target === 'whisper-model') {
          const model = WHISPER_MODELS.find((m) => m.id === (job.input.id ?? whisperId()));
          if (!model) throw new Error('Modèle inconnu');
          checkDisk(model.size);
          await download({
            url: model.url,
            target: whisperModelPath(model.id),
            expectedSize: model.size,
            sha1: model.sha1,
            signal: job.signal,
            onProgress: progress,
          });
          whisper?.stop();
          whisper = null;
          return { ok: true };
        }
        const voice = VOICES.find((v) => v.id === (job.input.id ?? voiceInfo().id));
        if (!voice) throw new Error('Voix inconnue');
        checkDisk(voice.model.size);
        const file = voicePath(voice);
        await download({ url: voice.config.url, target: `${file}.json`, signal: job.signal });
        await download({
          url: voice.model.url,
          target: file,
          expectedSize: voice.model.size,
          signal: job.signal,
          onProgress: progress,
        });
        piper?.stop();
        piper = null;
        return { ok: true };
      },
    );

    const install = (target: InstallTarget, id?: string) => {
      const titles: Record<InstallTarget, string> = {
        'whisper-engine': 'Assistant : moteur de reconnaissance vocale',
        'whisper-model': `Assistant : modèle de reconnaissance « ${id ?? whisperId()} »`,
        'piper-engine': 'Assistant : moteur de voix',
        voice: `Assistant : voix « ${VOICES.find((v) => v.id === (id ?? voiceInfo().id))?.label ?? id} »`,
        llm: `Assistant : modèle « ${id ?? modelName()} » (Ollama)`,
      };
      return ctx.jobs.enqueue('install', { target, id }, { title: titles[target] });
    };

    // --- Routes --------------------------------------------------------------------

    const status = async (): Promise<StatusDto> => {
      await hardwareReady;
      const version = await ollama.version();
      const installed = version ? await ollama.models().catch(() => []) : [];
      const model = modelName();
      const modelInstalled = installed.some(
        (m) => m.name === model || m.name === `${model}:latest`,
      );
      const caps = version && modelInstalled ? await capabilitiesOf(model) : null;
      const hotkey = ctx.hotkeys.status();
      const voice = voiceInfo();
      const voiceInstalled = existsSync(voicePath(voice));
      const whisperInstalled = existsSync(whisperModelPath());
      return {
        hardware,
        recommendation,
        ollama: {
          url: setting<string>('ollamaUrl') ?? '',
          version,
          installed,
          model,
          modelInstalled,
          capabilities: caps,
          canStart: Boolean(ollamaApp()),
        },
        whisper: {
          engine: whisperExe(),
          model: whisperId(),
          modelInstalled: whisperInstalled,
          running: Boolean(whisper?.running),
        },
        piper: { engine: piperExe(), voice: voice.id, voiceInstalled },
        hotkey: { ...hotkey, key: parseKey(setting<string>('pushToTalkKey')) },
        settings: {
          speakReplies: setting<boolean>('speakReplies') !== false,
          speed: setting<number>('speed') ?? 1,
          directReads: setting<boolean>('directReads') === true,
        },
        choices: {
          models: MODEL_CHOICES,
          whisper: WHISPER_MODELS.map(({ id, label, note, size }) => ({ id, label, note, size })),
          voices: VOICES.map(({ id, label }) => ({ id, label })),
        },
        installing: ctx.jobs
          .list()
          .filter((j) => j.type === 'install' && (j.status === 'queued' || j.status === 'running'))
          .map((j) => ({ id: j.id, title: j.title, progress: j.progress, message: j.message })),
        ready: Boolean(version && modelInstalled && whisperExe() && whisperInstalled),
      };
    };

    /** Ollama's own launcher on Windows (installed for the user). */
    const ollamaApp = () => {
      if (process.platform !== 'win32') return onPath('ollama');
      const base = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama');
      return (
        [path.join(base, 'ollama app.exe'), path.join(base, 'ollama.exe')].find((f) =>
          existsSync(f),
        ) ?? onPath('ollama')
      );
    };

    ctx.routes.get('/status', () => status());

    ctx.routes.get(
      '/events',
      (request, reply) => {
        const stream = openEventStream(request, reply);
        streams.add(stream);
        stream.onClose(() => streams.delete(stream));
        stream.send('state', { state, text: stateText, toggle: toggleMode });
      },
      { streamTicket: true },
    );

    ctx.routes.get('/turns', () => ({ turns, state }));

    ctx.routes.post('/listen/start', () => ({ ok: startListening() }));
    ctx.routes.post('/listen/stop', () => ({ ok: stopListening() }));
    ctx.routes.post('/listen/cancel', () => {
      if (state === 'listening' || state === 'transcribing') {
        broadcast('record', { action: 'cancel' });
        setState('idle', null);
      }
      return { ok: true };
    });

    ctx.routes.post(
      '/turn/audio',
      async (request) => {
        const body = requestBody(request);
        const wav = typeof body.audio === 'string' ? Buffer.from(body.audio, 'base64') : null;
        // 16 kHz mono 16-bit: 32 000 bytes per second.
        if (!wav || wav.length < 44 + 32_000 * 0.3) {
          setState('idle', null);
          return { turn: null, message: 'Trop court : maintiens la touche pendant que tu parles.' };
        }
        const started = Date.now();
        let text: string;
        try {
          text = await transcriber().transcribe(wav);
        } catch (error) {
          setState('idle', null);
          throw error instanceof HttpError ? error : new HttpError(500, (error as Error).message);
        }
        const transcribeMs = Date.now() - started;
        if (!text) {
          setState('idle', null);
          return { turn: null, message: 'Je n’ai rien entendu.' };
        }
        return { turn: await handleText(text, 'voice', transcribeMs) };
      },
      { bodyLimit: 8 * 1024 * 1024 },
    );

    ctx.routes.post('/turn/text', async (request) => {
      const text = String(requestBody(request).text ?? '').trim();
      if (!text) throw new HttpError(400, 'Écris une demande');
      if (text.length > 1000) throw new HttpError(400, 'Demande trop longue');
      releasedAt = 0;
      return { turn: await handleText(text, 'text', null) };
    });

    ctx.routes.post('/turns/:id/answer', async (request) => {
      const turn = turns.find((t) => t.id === idParam(request.params));
      if (!turn?.pending || turn !== turns[0])
        throw new HttpError(409, 'Plus de question en attente');
      return { turn: await handleText(requestBody(request).yes ? 'oui' : 'non', 'text', null) };
    });

    ctx.routes.post('/turns/:id/actions/:index/undo', async (request) => {
      const { index } = request.params as { index: string };
      const turn = turns.find((t) => t.id === idParam(request.params));
      const action = turn?.actions[Number(index)];
      if (!turn || !action?.undoId || action.undone) throw new HttpError(404, 'Rien à annuler');
      const result = await ctx.assistant.undo(action.undoId);
      if (!result.ok) throw new HttpError(409, result.message);
      action.undone = true;
      publish(turn);
      return result;
    });

    ctx.routes.post('/speech/done', (request) => {
      const turnId = Number(requestBody(request).turnId);
      if (speaking?.turnId === turnId && speaking.ended) {
        speaking = null;
        if (state === 'speaking') setState('idle', stateText);
      }
      return { ok: true };
    });

    ctx.routes.post('/reset', () => {
      brain.reset();
      turns.length = 0;
      setState('idle', null);
      return { ok: true };
    });

    ctx.routes.post('/install', (request) => {
      const body = requestBody(request);
      const target = String(body.target) as InstallTarget;
      if (!['whisper-engine', 'whisper-model', 'piper-engine', 'voice', 'llm'].includes(target)) {
        throw new HttpError(400, 'Installation inconnue');
      }
      return install(target, typeof body.id === 'string' ? body.id : undefined);
    });

    /** Everything missing, in one click. */
    ctx.routes.post('/install-all', async () => {
      const s = await status();
      const jobs = [];
      if (!s.whisper.engine) jobs.push(install('whisper-engine'));
      if (!s.whisper.modelInstalled) jobs.push(install('whisper-model'));
      if (!s.piper.engine) jobs.push(install('piper-engine'));
      if (!s.piper.voiceInstalled) jobs.push(install('voice'));
      if (s.ollama.version && !s.ollama.modelInstalled) jobs.push(install('llm'));
      return { jobs: jobs.length };
    });

    ctx.routes.put('/choices', (request) => {
      const body = requestBody(request);
      if (typeof body.model === 'string') ctx.settings.set('model', body.model.trim());
      if (typeof body.whisperModel === 'string') {
        if (!WHISPER_MODELS.some((m) => m.id === body.whisperModel))
          throw new HttpError(400, 'Modèle inconnu');
        ctx.settings.set('whisperModel', body.whisperModel);
      }
      if (typeof body.voice === 'string') {
        if (!VOICES.some((v) => v.id === body.voice)) throw new HttpError(400, 'Voix inconnue');
        ctx.settings.set('voice', body.voice);
      }
      if (typeof body.speed === 'number')
        ctx.settings.set('speed', Math.min(1.5, Math.max(0.7, body.speed)));
      if (typeof body.speakReplies === 'boolean')
        ctx.settings.set('speakReplies', body.speakReplies);
      if (typeof body.directReads === 'boolean') ctx.settings.set('directReads', body.directReads);
      return status();
    });

    ctx.routes.post('/hotkey/capture', async () => {
      const key = await ctx.hotkeys.capture(10_000);
      if (!key) throw new HttpError(408, 'Aucune touche pressée en 10 secondes');
      ctx.settings.set('pushToTalkKey', `${key.code}|${key.label}`);
      return { key };
    });

    ctx.routes.post('/voice/test', async () => {
      const voice = synthesizer();
      if (!voice) throw new HttpError(409, 'La voix n’est pas installée');
      const file = await voice.speak(
        'Bonjour Thomas, je suis prêt. Maintiens la touche pour me parler.',
      );
      broadcast('speech', { turnId: 0, index: 0, url: ctx.files.mediaUrl(file) });
      return { ok: true };
    });

    ctx.routes.post('/ollama/start', () => {
      const app = ollamaApp();
      if (!app) throw new HttpError(404, 'Ollama n’est pas installé');
      const child = spawn(app, path.basename(app).startsWith('ollama app') ? [] : ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return { ok: true };
    });

    ctx.routes.post('/ollama/open-download', () => {
      ctx.ui.open(`/m/${ctx.id}`);
      return { url: 'https://ollama.com/download' };
    });

    // Loads the model in memory at start, so the first answer is not the slowest.
    void (async () => {
      await hardwareReady;
      if (testHooks.chatModel) return;
      const version = await ollama.version();
      if (!version) return;
      const installed = await ollama.models().catch(() => []);
      if (installed.some((m) => m.name === modelName() || m.name === `${modelName()}:latest`)) {
        await capabilitiesOf(modelName());
        await ollama.preload(modelName()).catch(() => {});
      }
    })();

    ctx.onShutdown(() => {
      whisper?.stop();
      piper?.stop();
      for (const stream of streams) stream.close();
    });
  },
});
