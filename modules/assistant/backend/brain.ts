// The assistant's reasoning loop: the local model chooses tools (the actions
// of the modules, ctx.assistant), the hub runs them under its risk rules, and
// the answer is spoken sentence by sentence. Honesty rules enforced here, not
// left to the model:
// - after a change, what is said is the action's own message (what really
//   happened), never the model's paraphrase;
// - a destructive action waits for a « oui » recognised by this code;
// - a sentence claiming an action before any tool result is held back.
import type { AssistantActionInfo, AssistantOutcome, AssistantRisk } from '@hub/sdk/backend';
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

export interface BrainResult {
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
}

const MAX_ROUNDS = 4;
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

function systemPrompt(now: Date): string {
  const date = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(now);
  return [
    'Tu es l’assistant vocal de ToolBox, l’application de bureau de Thomas, musicien : bibliothèque de morceaux, vidéos YouTube, Reels Instagram, planning de sortie, statistiques YouTube, to-do.',
    `Nous sommes le ${date}, il est ${time}.`,
    'Règles :',
    '- Réponds en français, en une à trois phrases courtes et naturelles à l’oral : pas de listes, pas de markdown, pas d’émojis.',
    '- Pour lire ou modifier les données de ToolBox, utilise les outils. N’invente jamais un résultat : ne dis qu’une chose est faite que si un outil l’a confirmé.',
    '- Si la demande est ambiguë (date, tag, morceau, tâche), pose une seule question courte au lieu de deviner.',
    '- Passe les dates aux outils telles que dites (« vendredi », « demain ») : ne les convertis pas.',
    '- Ne fais jamais les actions sensibles (envoyer sur YouTube, publier, supprimer des fichiers, changer une date programmée) : dis-le et propose d’ouvrir la page.',
    '- Après un outil, appuie-toi uniquement sur son résultat ; reprends les chiffres tels quels.',
    '- Culture générale : réponds brièvement avec tes connaissances ; si tu n’es pas sûr, dis-le. Tu n’as pas accès à internet.',
  ].join('\n');
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

/** What the model gets back from a tool (small). */
function toolContent(outcome: AssistantOutcome): string {
  switch (outcome.status) {
    case 'done':
      return JSON.stringify({ status: 'fait', message: outcome.message, data: outcome.data });
    case 'confirm':
      return JSON.stringify({ status: 'confirmation demandée', question: outcome.question });
    case 'refused':
      return JSON.stringify({ status: 'refusé (action sensible)', message: outcome.message });
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

  get waitingFor(): Pending | null {
    return this.pending;
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
      reply: '',
      actions: [],
      pending: null,
      error: null,
      opened: null,
      timings: { thinkMs: 0, firstSentenceMs: null, rounds: 0, promptTokens: 0, outputTokens: 0 },
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

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(this.deps.now?.() ?? new Date()) },
      ...this.history,
      { role: 'user', content: text },
    ];
    const turnMessages: ChatMessage[] = [{ role: 'user', content: text }];
    const tools = toolSchemas(catalog);
    let anyToolResult = false;

    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        result.timings.rounds = round;
        const splitter = new SentenceSplitter();
        const held: string[] = [];
        let spoken = false;
        const chat = await this.deps
          .model()
          .chat(
            { model: this.deps.modelName(), messages, tools, think: this.deps.think(), signal },
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

          if (outcome.status === 'confirm') {
            this.pending = {
              kind: 'confirm',
              actionId: outcome.id,
              params,
              question: outcome.question,
              moduleName: info?.moduleName ?? '',
            };
            return this.closeTurn(finish(outcome.question), text, turnMessages);
          }
          if (outcome.status === 'refused') {
            if (outcome.open)
              this.pending = {
                kind: 'open',
                route: outcome.open,
                label: info?.moduleName ?? 'la page',
              };
            const reply = `${info?.description.replace(/\.$/, '') ?? 'Ça'} : je ne le fais pas moi-même, c’est une action sensible.${outcome.open ? ` Je peux ouvrir ${info?.moduleName ?? 'la page'} pour que tu le fasses. Je l’ouvre ?` : ''}`;
            return this.closeTurn(finish(reply), text, turnMessages);
          }
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
