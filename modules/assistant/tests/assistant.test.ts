// The assistant end to end with a fake model (keyword routing to the tools),
// fake speech engines and the real To-do module: actions, confirmation, undo,
// sensitive refusal, honesty guard, push-to-talk, Ollama absent.
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleContext } from '@hub/sdk/backend';
import {
  createTestHost,
  createTestHub,
  loadModuleFolder,
  type DiscoveredModule,
  type HostKeyEvent,
  type TestHub,
} from '@hub/sdk/testing';
import { setAssistantTestHooks } from '../backend';
import type { ChatModel, ChatRequest, ChatResult, ToolCall } from '../backend/ollama';
import type { StatusDto, TurnDto } from '../shared';

const API = '/api/modules/assistant';
const ROOT = path.resolve(__dirname, '../..');

/** Routes the last user message to a tool, then answers from the tool result. */
class FakeModel implements ChatModel {
  requests: ChatRequest[] = [];
  /** Text answered instead of a tool call (to test the honesty guard). */
  lie: string | null = null;

  async chat(request: ChatRequest, onToken: (text: string) => void): Promise<ChatResult> {
    this.requests.push(request);
    const last = request.messages.at(-1)!;
    const reply = (content: string, toolCalls: ToolCall[] = []): ChatResult => {
      for (const word of content.split(/(?<= )/)) onToken(word);
      return { content, toolCalls, promptEvalCount: 100, evalCount: 10, totalDurationMs: 5 };
    };
    if (last.role === 'tool') {
      const result = JSON.parse(last.content) as { message: string; data?: { count?: number } };
      return reply(`D’après la To-do : ${result.message}`);
    }
    const said = (last as { content: string }).content.toLowerCase();
    if (this.lie) return reply(this.lie);
    const call = (name: string, args: Record<string, unknown>) =>
      reply('', [{ function: { name, arguments: args } }]);
    if (said.includes('ajoute'))
      return call('todo__add_task', { title: 'finir le mix', tags: ['mix'], due: 'demain' });
    if (said.includes('qu’est-ce que j’ai') || said.includes("qu'est-ce que j'ai"))
      return call('todo__list_tasks', { filter: 'open' });
    if (said.includes('supprime')) return call('todo__delete_task', { task: 'mix' });
    if (said.includes('publie')) return call('fake_planner__upload', {});
    if (said.includes('ouvre')) return call('core__open', { target: 'To-do' });
    return reply('Paris est la capitale de la France. Je suis sûr de celle-là.');
  }
}

function sensitiveModule(): DiscoveredModule {
  return {
    folder: 'fake-planner',
    manifest: {
      id: 'fake-planner',
      name: 'Planning',
      description: 'fake',
      version: '1.0.0',
      section: 'Tests',
      icon: '🧪',
    },
    backend: {
      register: (ctx: ModuleContext) =>
        ctx.assistant.define({
          name: 'upload',
          description: 'Envoyer une vidéo sur YouTube',
          risk: 'sensitive',
          page: '',
        }),
    },
  } as DiscoveredModule;
}

describe('assistant', () => {
  let hub: TestHub;
  const model = new FakeModel();
  const spoken: string[] = [];
  const opened: string[] = [];
  const overlay: boolean[] = [];
  let listener: ((event: HostKeyEvent) => void) | null = null;
  let heard = 'ajoute finir le mix pour demain';

  beforeAll(async () => {
    setAssistantTestHooks({
      chatModel: model,
      transcriber: { transcribe: async () => heard },
      synthesizer: {
        speak: async (text) => {
          spoken.push(text);
          return path.join(ROOT, 'assistant', 'module.json');
        },
      },
      hardware: { ramGb: 16, threads: 8, cpu: 'test', gpus: [] },
    });
    hub = await createTestHub({
      host: createTestHost({
        showWindow: (target) => opened.push(target ?? ''),
        setOverlayVisible: (visible) => overlay.push(visible),
        globalKeys: {
          start: (next) => (listener = next),
          stop: () => (listener = null),
          label: () => 'Touche Copilot',
        },
      }),
      modules: [
        await loadModuleFolder(path.join(ROOT, 'todo')),
        await loadModuleFolder(path.join(ROOT, 'assistant')),
        sensitiveModule(),
      ],
    });
    hub.hub.assistant.setRight('todo.edit-tasks', true);
    hub.hub.assistant.setRight('todo.delete-tasks', true);
  });
  afterAll(async () => {
    setAssistantTestHooks({});
    await hub.close();
  });
  beforeEach(() => {
    spoken.length = 0;
    opened.length = 0;
    model.lie = null;
  });

  const say = async (text: string) =>
    (await hub.request<{ turn: TurnDto }>('POST', `${API}/turn/text`, { text })).body.turn;
  const tasks = async () =>
    (await hub.request<{ tasks: { title: string }[] }>('GET', '/api/modules/todo/tasks')).body
      .tasks;

  it('adds a task and confirms aloud exactly what was done, with « Annuler »', async () => {
    const turn = await say('ajoute finir le mix pour demain avec le tag mix');
    expect(turn.reply).toBe('J’ai ajouté « finir le mix » avec le tag mix pour demain.');
    expect(spoken).toEqual(['J’ai ajouté « finir le mix » avec le tag mix pour demain.']);
    expect(turn.actions).toMatchObject([
      { actionId: 'todo.add-task', status: 'done', risk: 'change', undone: false },
    ]);
    expect(turn.latency.rounds).toBe(1);
    expect(await tasks()).toHaveLength(1);
    // The tools sent to the model: every module's actions, with a valid name.
    const toolNames = model.requests.at(-1)!.tools.map((t) => t.function.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'todo__add_task',
        'todo__delete_task',
        'core__open',
        'fake_planner__upload',
      ]),
    );
    expect(toolNames.every((n) => /^[a-zA-Z0-9_]+$/.test(n))).toBe(true);

    const undo = await hub.request('POST', `${API}/turns/${turn.id}/actions/0/undo`);
    expect(undo.status).toBe(200);
    expect(await tasks()).toHaveLength(0);
    expect((await hub.request('POST', `${API}/turns/${turn.id}/actions/0/undo`)).status).toBe(404);
  });

  it('answers questions from the tool result (second pass), or directly when asked', async () => {
    await say('ajoute finir le mix');
    let turn = await say('qu’est-ce que j’ai à faire ?');
    expect(turn.reply).toBe('D’après la To-do : 1 tâche à faire : finir le mix.');
    expect(turn.latency.rounds).toBe(2);
    await hub.request('PUT', '/api/core/settings/assistant', { directReads: true });
    turn = await say('qu’est-ce que j’ai à faire ?');
    expect(turn).toMatchObject({
      reply: '1 tâche à faire : finir le mix.',
      latency: { rounds: 1 },
    });
    await hub.request('PUT', '/api/core/settings/assistant', { directReads: false });
    // Follow-up questions keep the context of the session.
    const lastRequest = model.requests.at(-1)!;
    expect(lastRequest.messages.filter((m) => m.role === 'user').length).toBeGreaterThan(2);
  });

  it('says in one sentence when a right is off, and offers to open the rights', async () => {
    hub.hub.assistant.setRight('todo.edit-tasks', false);
    const before = (await tasks()).length;
    try {
      const turn = await say('ajoute finir le mix');
      expect(turn.reply).toBe(
        'Je n’ai pas ce droit : « L’assistant peut ajouter et cocher des tâches » est désactivé. J’ouvre les droits de l’assistant ?',
      );
      expect(turn.actions).toMatchObject([{ status: 'forbidden' }]);
      expect(await tasks()).toHaveLength(before);
      await say('oui');
      expect(opened.at(-1)).toBe('/settings');
    } finally {
      hub.hub.assistant.setRight('todo.edit-tasks', true);
    }
  });

  it('asks before deleting, and only a clear « oui » deletes', async () => {
    let turn = await say('supprime la tâche du mix');
    expect(turn.reply).toBe('Je supprime la tâche « finir le mix » ?');
    expect(turn.pending).toEqual({
      kind: 'confirm',
      question: 'Je supprime la tâche « finir le mix » ?',
    });
    expect(await tasks()).toHaveLength(1);
    turn = await say('non');
    expect(turn.reply).toBe('D’accord, je ne fais rien.');
    expect(await tasks()).toHaveLength(1);

    turn = await say('supprime la tâche du mix');
    const answered = await hub.request<{ turn: TurnDto }>(
      'POST',
      `${API}/turns/${turn.id}/answer`,
      { yes: true },
    );
    expect(answered.body.turn.reply).toBe('J’ai supprimé la tâche « finir le mix ».');
    expect(await tasks()).toHaveLength(0);
    expect(answered.body.turn.actions[0]).toMatchObject({
      actionId: 'todo.delete-task',
      status: 'done',
    });
  });

  it('refuses sensitive actions and opens the page only if asked', async () => {
    let turn = await say('publie la vidéo sur YouTube');
    expect(turn.reply).toBe(
      'Envoyer une vidéo sur YouTube : je ne le fais pas moi-même, c’est une action sensible. Je peux ouvrir Planning pour que tu le fasses. Je l’ouvre ?',
    );
    expect(turn.actions[0]).toMatchObject({ status: 'refused' });
    expect(opened).toEqual([]);
    turn = await say('oui');
    expect(turn.reply).toBe('J’ouvre Planning.');
    expect(opened).toEqual(['/m/fake-planner']);
  });

  it('opens a tool on request', async () => {
    const turn = await say('ouvre la to-do');
    expect(turn.reply).toBe('J’ouvre To-do.');
    expect(opened).toEqual(['/m/todo']);
  });

  it('never says it did something no tool did', async () => {
    model.lie = 'J’ai ajouté la tâche pour toi. Autre chose ?';
    const turn = await say('note de rappeler Paul');
    expect(turn.reply).toBe('Je n’ai rien fait : je n’ai pas trouvé l’outil pour ça.');
    expect(spoken).toEqual(['Je n’ai rien fait : je n’ai pas trouvé l’outil pour ça.']);
  });

  it('answers general knowledge with the model, streamed sentence by sentence', async () => {
    const turn = await say('quelle est la capitale de la France ?');
    expect(turn.reply).toBe('Paris est la capitale de la France. Je suis sûr de celle-là.');
    expect(spoken).toEqual(['Paris est la capitale de la France.', 'Je suis sûr de celle-là.']);
    expect(turn.latency.firstSentenceMs).not.toBeNull();
    expect(turn.latency.voiceMs).not.toBeNull();
  });

  it('push-to-talk: hold to talk, or tap to start and tap again to stop', async () => {
    const state = async () =>
      (await hub.request<{ state: string }>('GET', `${API}/turns`)).body.state;
    expect(listener).not.toBeNull();
    listener!({ type: 'down', code: 106 });
    expect(await state()).toBe('listening');
    expect(overlay.at(-1)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 380));
    listener!({ type: 'up', code: 106 });
    expect(await state()).toBe('transcribing');
    await hub.request('POST', `${API}/listen/cancel`);

    // A key that sends its release at once (Copilot key on some PCs): toggle mode.
    listener!({ type: 'down', code: 106 });
    listener!({ type: 'up', code: 106 });
    expect(await state()).toBe('listening');
    listener!({ type: 'down', code: 106 });
    expect(await state()).toBe('transcribing');
    listener!({ type: 'up', code: 106 });
    await hub.request('POST', `${API}/listen/cancel`);
    expect(await state()).toBe('idle');
  });

  it('transcribes the recorded speech, refuses too short or silent recordings', async () => {
    const wav = Buffer.alloc(44 + 32_000).toString('base64');
    heard = 'ajoute finir le mix pour demain';
    const { body } = await hub.request<{ turn: TurnDto }>('POST', `${API}/turn/audio`, {
      audio: wav,
    });
    expect(body.turn).toMatchObject({ source: 'voice', heard: 'ajoute finir le mix pour demain' });
    expect(body.turn.latency.transcribeMs).not.toBeNull();
    const short = await hub.request<{ message: string }>('POST', `${API}/turn/audio`, {
      audio: Buffer.alloc(100).toString('base64'),
    });
    expect(short.body.message).toMatch(/Trop court/);
    heard = '';
    const silent = await hub.request<{ message: string }>('POST', `${API}/turn/audio`, {
      audio: wav,
    });
    expect(silent.body.message).toBe('Je n’ai rien entendu.');
  });

  it('reports the state of the models and recommends one for the PC', async () => {
    const { body } = await hub.request<StatusDto>('GET', `${API}/status`);
    expect(body.recommendation).toMatchObject({ model: 'ministral-3:3b', whisper: 'small' });
    expect(body.hotkey).toMatchObject({ available: true, key: { code: 106 } });
    expect(body.choices.voices.length).toBeGreaterThan(2);
    expect(body.settings).toEqual({ speakReplies: true, speed: 1, directReads: false });
  });

  it('forgets the conversation on « Nouvelle conversation »', async () => {
    await hub.request('POST', `${API}/reset`);
    expect((await hub.request<{ turns: unknown[] }>('GET', `${API}/turns`)).body.turns).toEqual([]);
  });
});

describe('assistant without Ollama', () => {
  it('says clearly that Ollama does not answer', async () => {
    setAssistantTestHooks({ hardware: { ramGb: 8, threads: 4, cpu: 'test', gpus: [] } });
    const hub = await createTestHub({
      modules: [await loadModuleFolder(path.join(ROOT, 'assistant'))],
    });
    try {
      await hub.request('PUT', '/api/core/settings/assistant', { ollamaUrl: 'http://127.0.0.1:9' });
      const { body } = await hub.request<{ turn: TurnDto }>('POST', `${API}/turn/text`, {
        text: 'bonjour',
      });
      expect(body.turn.error).toMatch(/Ollama ne répond pas/);
      expect(body.turn.reply).toBe(body.turn.error);
      const status = (await hub.request<StatusDto>('GET', `${API}/status`)).body;
      expect(status.ollama.version).toBeNull();
      expect(status.ready).toBe(false);
      expect(status.recommendation?.whisper).toBe('base');
      // No engine installed: the voice turn explains what to install.
      const audio = await hub.request<{ error: string }>('POST', `${API}/turn/audio`, {
        audio: Buffer.alloc(44 + 32_000).toString('base64'),
      });
      expect(audio.status).toBe(409);
      expect(audio.body.error).toMatch(/pas installée/);
    } finally {
      setAssistantTestHooks({});
      await hub.close();
    }
  });
});
