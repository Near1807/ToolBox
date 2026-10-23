// The assistant's reasoning loop: the local model chooses tools (the actions
// of the modules, ctx.assistant), the hub runs them under its risk rules, and
// the answer is spoken sentence by sentence. Honesty rules enforced here, not
// left to the model:
// - after a change, what is said is the action's own message (what really
//   happened), never the model's paraphrase;
// - a destructive action waits for a « oui » recognised by this code;
// - a sentence claiming an action before any tool result is held back.
import type { AssistantActionInfo, AssistantOutcome, AssistantRisk } from '@hub/sdk/backend';
import type { MatchResult } from './matcher';
import type { ChatMessage, ChatModel, ToolCall, ToolSchema } from './ollama';
import { OllamaError } from './ollama';
import { SentenceSplitter, splitSentences } from './sentences';

export interface TurnAction {
  actionId: string;
  moduleName: string;
  description: string;
  risk: AssistantRisk;
  status: AssistantOutcome['status'];
  message: string;
  undoId: string | null;
  open: string | null;
}

export type Pending =
  | { kind: 'confirm'; actionId: string; params: unknown; question: string; moduleName: string }
  | { kind: 'open'; route: string; label: string };

/** How a turn was answered. */
export type TurnMode = 'command' | 'ai' | 'not-understood' | 'answer';

export interface CommandSummary {
  verdict: MatchResult['verdict'];
  actionId: string | null;
  score: number | null;
  gap: number;
  second: string | null;
  semantic: boolean;
  suggestion: string | null;
}

export interface BrainResult {
  mode: TurnMode;
  /** What the standardised commands found (null: not tried, e.g. an answer to a question). */
  command: CommandSummary | null;
  /** Questions the assistant asked in this turn. */
  questions: number;
  reply: string;
  actions: TurnAction[];
  /** What a « oui » will do next (shown as buttons too). */
  pending: Pending | null;
  error: string | null;
  opened: string | null;
  timings: {
    /** From the request to the end of the answer (ms). */
    thinkMs: number;
    /** From the request to the first sentence ready to be spoken (ms). */
    firstSentenceMs: number | null;
    rounds: number;
    promptTokens: number;
    outputTokens: number;
    /** Recognition of the commands (ms). */
    matchMs: number | null;
    /** Time spent waiting for the model (ms). */
    modelMs: number | null;
  };
}

export interface BrainDeps {
  model: () => ChatModel;
  modelName: () => string;
  /** false for models with the « thinking » capability (answer directly), undefined otherwise. */
  think: () => boolean | undefined;
  actions: () => AssistantActionInfo[];
  run: (
    id: string,
    params: unknown,
    options?: { confirmed?: boolean },
  ) => Promise<AssistantOutcome>;
  open: (route: string) => void;
  now?: () => Date;
  /** Read results spoken as they are (faster: no second pass of the model). */
  directReads?: () => boolean;
  /** False when the model cannot call tools: it then only answers, and says it cannot act. */
  toolsAvailable?: () => boolean;
  /** Standardised commands (no generative AI); null when unavailable. */
  recognise?: (text: string) => Promise<MatchResult | null>;
  /** The « IA » switch: off, a request that is not a command is not understood. */
  ai?: () => boolean;
  /** Thomas's instructions for the model ('' or null: the original ones). */
  prompt?: () => string | null;
  /** keep_alive sent to Ollama. */
  keepAlive?: () => string;
}

export const NOT_UNDERSTOOD = 'Je n’ai pas compris ta demande.';

function summarise(match: MatchResult): CommandSummary {
  return {
    verdict: match.verdict,
    actionId: match.best?.actionId ?? null,
    score: match.best?.score ?? null,
    gap: match.gap,
    second: match.second?.actionId ?? null,
    semantic: match.semantic,
    suggestion: match.suggestion?.phrase ?? null,
  };
}

const countQuestions = (reply: string) =>
  splitSentences(reply).filter((s) => /\?\s*$/.test(s)).length;

const MAX_ROUNDS = 4;
/** A turn never takes longer than this (a slow PC, a model that rambles). */
const TURN_TIMEOUT_MS = 120_000;
export const TIMEOUT_MESSAGE =
  'Le modèle met trop de temps à répondre (plus de 2 minutes) : essaie un modèle plus petit, ou une commande standardisée.';
const MAX_TURNS_KEPT = 8;

/** Tool names accepted by every model: letters, digits, underscores. */
export const toolName = (actionId: string) => actionId.replace(/\./g, '__').replace(/-/g, '_');

export function toolSchemas(actions: AssistantActionInfo[]): ToolSchema[] {
  return actions.map((action) => ({
    type: 'function',
    function: {
      name: toolName(action.id),
      description: `[${action.moduleName}] ${action.description}${
        action.risk === 'destructive'
          ? ' La confirmation est demandée automatiquement à l’utilisateur.'
          : action.risk === 'sensitive'
            ? ' Action sensible : jamais faite par l’assistant (refus automatique, la page est proposée).'
            : ''
      }`,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(action.parameters).map(([key, p]) => [
            key,
            p.type === 'string[]'
              ? { type: 'array', items: { type: 'string' }, description: p.description }
              : { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) },
          ]),
        ),
        required: action.required,
      },
    },
  }));
}

const normalise = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const YES =
  /^(oui|ouais|ouai|yes|ok|okay|d accord|dac|vas y|go|confirme|je confirme|c est bon|bien sur|exactement|absolument|carrement|parfait|allez|fais le|tu peux|oui vas y|oui oui)( .*)?$/;
const NO =
  /^(non|nan|no|annule|annuler|laisse tomber|stop|arrete|pas du tout|surtout pas|attends|non merci|oublie)( .*)?$/;

/** « oui » / « non » to a pending question (short answers only), else null. */
export function yesNo(text: string): 'yes' | 'no' | null {
  const said = normalise(text);
  if (!said || said.split(' ').length > 7) return null;
  if (NO.test(said)) return 'no';
  if (YES.test(said)) return 'yes';
  return null;
}

/** A sentence that claims something was done: never spoken before a tool confirmed it. */
const CLAIM =
  /\b(j ai (ajoute|supprime|coche|cree|note|mis|enregistre|programme|envoye|publie|fait)|c est (fait|note|coche|ajoute)|voila c est)\b/;

/**
 * The instructions of the model, editable by Thomas (advanced settings).
 * Short and stable: Ollama keeps them in its cache, re-reading them costs
 * seconds on a CPU. Safety never depends on them: confirmations, rights and
 * refusals are applied by the code, whatever the instructions say.
 */
export const DEFAULT_PROMPT = [
  'Tu es l’assistant vocal de ToolBox, l’application de Thomas, musicien.',
  'Réponds en français, en une phrase courte, deux au plus : sans formule de politesse, sans répéter la demande, sans liste ni markdown.',
  'Pour lire ou modifier ToolBox, appelle directement l’outil. Ne demande jamais de confirmation : l’application s’en charge.',
  'Ne demande jamais un paramètre facultatif. Pose au plus une question, seulement s’il manque un paramètre obligatoire.',
  'Passe les dates aux outils telles que dites (« vendredi », « demain »).',
  'N’invente jamais un résultat : dis seulement ce que l’outil a renvoyé.',
  'Culture générale : réponds brièvement ; si tu n’es pas sûr, dis-le.',
].join('\n');

/** What the app adds after the instructions (shown read only): the date, the tools note. */
export function autoPromptLines(now: Date, tools: boolean): string[] {
  const date = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return [
    // The hour, not the minute, and at the end: the start stays identical, so
    // Ollama reuses its cache of it.
    `Nous sommes le ${date}, il est environ ${now.getHours()} h.`,
    ...(tools
      ? []
      : [
          'Le modèle choisi ne sait pas utiliser les outils : si on te demande de lire ou de modifier ToolBox, dis que tu ne peux pas avec ce modèle.',
        ]),
  ];
}

export function systemPrompt(now: Date, tools: boolean, custom?: string | null): string {
  const instructions = custom?.trim() || DEFAULT_PROMPT;
  return [instructions, ...autoPromptLines(now, tools)].join('\n');
}

/**
 * Fewer tools sent to the model (a shorter prompt to read): the actions of the
 * modules the commands found close, plus the hub's own. Unsure → every tool.
 */
export function preselectTools(
  catalog: AssistantActionInfo[],
  match: MatchResult | null,
): AssistantActionInfo[] {
  const best = match?.best;
  if (!best || best.score < 0.4) return catalog;
  const modules = new Set(
    match.ranking
      .filter((c) => c.score >= best.score - 0.15)
      .map((c) => catalog.find((a) => a.id === c.actionId)?.moduleId)
      .filter((id): id is string => Boolean(id)),
  );
  if (modules.size === 0) return catalog;
  modules.add('core');
  return catalog.filter((a) => modules.has(a.moduleId));
}

function parseArguments(call: ToolCall): unknown {
  const args = call.function.arguments;
  if (typeof args !== 'string') return args ?? {};
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return {};
  }
}

/** Where Thomas turns the assistant's rights on (also in Réglages). */
export const RIGHTS_ROUTE = '/m/assistant/commands';

/** One sentence, then the offer to open the rights (the pending « open » takes the « oui »). */
export function forbiddenReply(label: string): string {
  return `Je n’ai pas ce droit : « ${label} » est désactivé. J’ouvre les droits de l’assistant ?`;
}

/** What the model gets back from a tool (small). */
function toolContent(outcome: AssistantOutcome): string {
  switch (outcome.status) {
    case 'done':
      return JSON.stringify({ status: 'fait', message: outcome.message, data: outcome.data });
    case 'confirm':
      return JSON.stringify({ status: 'confirmation demandée', question: outcome.question });
    case 'refused':
      return JSON.stringify({ status: 'refusé (action sensible)', message: outcome.message });
    case 'forbidden':
      return JSON.stringify({ status: 'refusé (droit désactivé)', message: outcome.message });
    default:
      return JSON.stringify({ status: 'erreur', message: outcome.message });
  }
}

export class Brain {
  private history: ChatMessage[] = [];
  private pending: Pending | null = null;

  constructor(private readonly deps: BrainDeps) {}

  /** Forgets the conversation (« Nouvelle conversation », end of the session). */
  reset(): void {
    this.history = [];
    this.pending = null;
  }

  /** The system message: Thomas's (or the original) instructions, then the app's lines. */
  instructions(canUseTools = this.deps.toolsAvailable?.() !== false): string {
    return systemPrompt(this.deps.now?.() ?? new Date(), canUseTools, this.deps.prompt?.());
  }

  get waitingFor(): Pending | null {
    return this.pending;
  }

  /**
   * Has the model read the instructions and the tools once (1 token answered),
   * so Ollama keeps them in its cache: the first real question is then faster.
   */
  async warmup(): Promise<void> {
    const canUseTools = this.deps.toolsAvailable?.() !== false;
    await this.deps.model().chat(
      {
        model: this.deps.modelName(),
        messages: [
          { role: 'system', content: this.instructions(canUseTools) },
          { role: 'user', content: 'Bonjour' },
        ],
        tools: canUseTools ? toolSchemas(this.deps.actions()) : [],
        think: this.deps.think(),
        maxTokens: 1,
        keepAlive: this.deps.keepAlive?.(),
      },
      () => {},
    );
  }

  /** The user answered a pending question with a click (Oui / Non). */
  async answer(yes: boolean, onSentence: (s: string) => void): Promise<BrainResult> {
    return this.handle(yes ? 'oui' : 'non', onSentence);
  }

  async handle(
    text: string,
    onSentence: (sentence: string) => void,
    signal?: AbortSignal,
  ): Promise<BrainResult> {
    const started = Date.now();
    const result: BrainResult = {
      mode: 'ai',
      command: null,
      questions: 0,
      reply: '',
      actions: [],
      pending: null,
      error: null,
      opened: null,
      timings: {
        thinkMs: 0,
        firstSentenceMs: null,
        rounds: 0,
        promptTokens: 0,
        outputTokens: 0,
        matchMs: null,
        modelMs: null,
      },
    };
    const say = (sentence: string) => {
      result.timings.firstSentenceMs ??= Date.now() - started;
      onSentence(sentence);
    };
    const finish = (reply: string, spoken = false) => {
      result.reply = reply.trim();
      if (!spoken) for (const sentence of splitSentences(result.reply)) say(sentence);
      result.timings.thinkMs = Date.now() - started;
      result.pending = this.pending;
      result.questions = countQuestions(result.reply);
      return result;
    };
    const catalog = this.deps.actions();
    const byTool = new Map(catalog.map((a) => [toolName(a.id), a]));

    // A pending question first: only a clear « oui » / « non » answers it.
    const pending = this.pending;
    if (pending) {
      const answer = yesNo(text);
      this.pending = null;
      if (answer) {
        result.mode = 'answer';
        this.remember(text, '');
        if (answer === 'no')
          return this.closeTurn(
            finish(pending.kind === 'confirm' ? 'D’accord, je ne fais rien.' : 'D’accord.'),
            text,
          );
        if (pending.kind === 'open') {
          this.deps.open(pending.route);
          result.opened = pending.route;
          return this.closeTurn(finish(`J’ouvre ${pending.label}.`), text);
        }
        const info = catalog.find((a) => a.id === pending.actionId);
        const outcome = await this.deps.run(pending.actionId, pending.params, { confirmed: true });
        result.actions.push(this.record(info, pending.actionId, outcome));
        const reply =
          outcome.status === 'done'
            ? outcome.message
            : `Ce n’est pas fait : ${'message' in outcome ? outcome.message : ''}`;
        return this.closeTurn(finish(reply), text);
      }
    }

    // Standardised commands first: recognised → run without the model, AI on or off.
    const match = this.deps.recognise ? await this.deps.recognise(text) : null;
    if (match) {
      result.command = summarise(match);
      result.timings.matchMs = match.ms;
      if (match.verdict === 'recognised' && match.best?.params) {
        result.mode = 'command';
        const actionId = match.best.actionId;
        const info = catalog.find((a) => a.id === actionId);
        const params = match.best.params;
        const outcome = await this.deps.run(actionId, params);
        result.actions.push(this.record(info, actionId, outcome));
        const reply = this.react(outcome, info, params) ?? this.doneReply(outcome, result);
        return this.closeTurn(finish(reply), text);
      }
    }
    if (this.deps.ai && !this.deps.ai()) {
      // AI off: Ollama is never called. A close command is suggested, never run.
      result.mode = 'not-understood';
      const hint = match?.suggestion ? ` Tu voulais dire : « ${match.suggestion.phrase} » ?` : '';
      return finish(`${NOT_UNDERSTOOD}${hint}`);
    }

    const canUseTools = this.deps.toolsAvailable?.() !== false;
    const messages: ChatMessage[] = [
      { role: 'system', content: this.instructions(canUseTools) },
      ...this.history,
      { role: 'user', content: text },
    ];
    const turnMessages: ChatMessage[] = [{ role: 'user', content: text }];
    const tools = canUseTools ? toolSchemas(preselectTools(catalog, match)) : [];
    let anyToolResult = false;

    const deadline = AbortSignal.timeout(TURN_TIMEOUT_MS);
    const turnSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        result.timings.rounds = round;
        const splitter = new SentenceSplitter();
        const held: string[] = [];
        let spoken = false;
        const modelStarted = Date.now();
        const chat = await this.deps.model().chat(
          {
            model: this.deps.modelName(),
            messages,
            tools,
            think: this.deps.think(),
            keepAlive: this.deps.keepAlive?.(),
            signal: turnSignal,
          },
          (token) => {
            for (const sentence of splitter.push(token)) {
              // A claim of action before any result is held until we know.
              if (!anyToolResult && CLAIM.test(normalise(sentence))) held.push(sentence);
              else if (held.length === 0) {
                say(sentence);
                spoken = true;
              } else held.push(sentence);
            }
          },
        );
        result.timings.modelMs = (result.timings.modelMs ?? 0) + Date.now() - modelStarted;
        result.timings.promptTokens += chat.promptEvalCount;
        result.timings.outputTokens += chat.evalCount;

        if (chat.toolCalls.length === 0) {
          const rest = splitter.flush();
          if (held.length > 0 && !anyToolResult) {
            // The model claims an action it did not make: never say it.
            const fixed = 'Je n’ai rien fait : je n’ai pas trouvé l’outil pour ça.';
            turnMessages.push({ role: 'assistant', content: fixed });
            this.history.push(...turnMessages);
            this.trim();
            return finish(fixed);
          }
          for (const sentence of [...held, ...rest]) {
            say(sentence);
            spoken = true;
          }
          const reply = chat.content.trim() || 'Je n’ai pas de réponse.';
          turnMessages.push({ role: 'assistant', content: reply });
          this.history.push(...turnMessages);
          this.trim();
          return finish(reply, spoken || reply === '');
        }

        // Tools: run each one (risk rules applied by the hub).
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: chat.content,
          tool_calls: chat.toolCalls,
        };
        messages.push(assistantMessage);
        turnMessages.push(assistantMessage);
        const roundActions: TurnAction[] = [];
        for (const call of chat.toolCalls) {
          const info = byTool.get(call.function.name);
          const actionId = info?.id ?? call.function.name;
          const params = parseArguments(call);
          const outcome: AssistantOutcome = info
            ? await this.deps.run(info.id, params)
            : {
                status: 'invalid',
                id: actionId,
                message: `Outil inconnu « ${call.function.name} »`,
              };
          anyToolResult = true;
          const action = this.record(info, actionId, outcome);
          roundActions.push(action);
          result.actions.push(action);
          const toolMessage: ChatMessage = {
            role: 'tool',
            tool_name: call.function.name,
            content: toolContent(outcome),
          };
          messages.push(toolMessage);
          turnMessages.push(toolMessage);

          const stop = this.react(outcome, info, params);
          if (stop !== null) return this.closeTurn(finish(stop), text, turnMessages);
          if (outcome.status === 'done' && outcome.open) {
            this.deps.open(outcome.open);
            result.opened = outcome.open;
          }
        }

        const changes = roundActions.filter(
          (a) => a.status === 'done' && (a.risk === 'change' || a.risk === 'destructive'),
        );
        if (changes.length > 0) {
          return this.closeTurn(
            finish(changes.map((a) => a.message).join(' ')),
            text,
            turnMessages,
          );
        }
        const reads = roundActions.filter((a) => a.status === 'done');
        if (reads.length === roundActions.length && (this.deps.directReads?.() || result.opened)) {
          return this.closeTurn(finish(reads.map((a) => a.message).join(' ')), text, turnMessages);
        }
        if (round === MAX_ROUNDS) {
          const last = roundActions.at(-1);
          return this.closeTurn(
            finish(last ? last.message : 'Je n’y arrive pas, désolé.'),
            text,
            turnMessages,
          );
        }
        // Otherwise the model answers from the tool results (next round).
      }
    } catch (error) {
      if (signal?.aborted) {
        result.error = 'Interrompu';
        return finish('');
      }
      if (deadline.aborted) {
        result.error = TIMEOUT_MESSAGE;
        return finish(result.error);
      }
      const message =
        error instanceof OllamaError && error.kind === 'offline'
          ? 'Je ne peux pas réfléchir : Ollama ne répond pas. Lance-le, ou ouvre la page de l’assistant pour l’installer.'
          : error instanceof OllamaError && error.kind === 'missing-model'
            ? `Le modèle « ${this.deps.modelName()} » n’est pas installé dans Ollama : télécharge-le depuis la page de l’assistant.`
            : `Erreur du modèle : ${(error as Error).message}`;
      result.error = message;
      return finish(message);
    }
    return finish('Je n’y arrive pas, désolé.');
  }

  /**
   * A confirmation to ask, a refusal (sensitive), a missing right: the reply,
   * with what a « oui » will do next. null when the outcome needs no question.
   */
  private react(
    outcome: AssistantOutcome,
    info: AssistantActionInfo | undefined,
    params: unknown,
  ): string | null {
    if (outcome.status === 'confirm') {
      this.pending = {
        kind: 'confirm',
        actionId: outcome.id,
        params,
        question: outcome.question,
        moduleName: info?.moduleName ?? '',
      };
      return outcome.question;
    }
    if (outcome.status === 'refused') {
      if (outcome.open)
        this.pending = { kind: 'open', route: outcome.open, label: info?.moduleName ?? 'la page' };
      return `${info?.description.replace(/\.$/, '') ?? 'Ça'} : je ne le fais pas moi-même, c’est une action sensible.${outcome.open ? ` Je peux ouvrir ${info?.moduleName ?? 'la page'} pour que tu le fasses. Je l’ouvre ?` : ''}`;
    }
    if (outcome.status === 'forbidden') {
      this.pending = { kind: 'open', route: RIGHTS_ROUTE, label: 'les droits de l’assistant' };
      return forbiddenReply(outcome.right.label);
    }
    return null;
  }

  /** A command done (its own message, the page opened) or its error, said as is. */
  private doneReply(outcome: AssistantOutcome, result: BrainResult): string {
    if (outcome.status === 'done') {
      if (outcome.open) {
        this.deps.open(outcome.open);
        result.opened = outcome.open;
      }
      return outcome.message;
    }
    return 'message' in outcome ? outcome.message : NOT_UNDERSTOOD;
  }

  private record(
    info: AssistantActionInfo | undefined,
    actionId: string,
    outcome: AssistantOutcome,
  ): TurnAction {
    return {
      actionId,
      moduleName: info?.moduleName ?? '?',
      description: info?.description ?? actionId,
      risk: info?.risk ?? 'read',
      status: outcome.status,
      message:
        outcome.status === 'done'
          ? outcome.message
          : outcome.status === 'confirm'
            ? outcome.question
            : outcome.message,
      undoId: outcome.status === 'done' ? outcome.undoId : null,
      open: outcome.status === 'done' || outcome.status === 'refused' ? outcome.open : null,
    };
  }

  /** Keeps the exchange (tool calls included) for follow-up questions. */
  private closeTurn(result: BrainResult, text: string, turn?: ChatMessage[]): BrainResult {
    if (turn) {
      this.history.push(...turn, { role: 'assistant', content: result.reply });
    } else {
      this.remember(text, result.reply);
    }
    this.trim();
    return result;
  }

  private remember(user: string, reply: string): void {
    if (!reply) return;
    this.history.push({ role: 'user', content: user }, { role: 'assistant', content: reply });
  }

  /** Keeps the last turns, cut at a user message (never between a tool call and its result). */
  private trim(): void {
    const starts = this.history.flatMap((m, i) => (m.role === 'user' ? [i] : []));
    if (starts.length > MAX_TURNS_KEPT)
      this.history = this.history.slice(starts[starts.length - MAX_TURNS_KEPT]);
  }
}
