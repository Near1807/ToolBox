// Client of the local Ollama server (docs.ollama.com/api): is it running,
// installed models, capabilities, download with progress, chat with tools
// (streamed, so the voice can start on the first sentence).

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<
        string,
        { type: string; description: string; enum?: string[]; items?: { type: string } }
      >;
      required: string[];
    };
  };
}

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_name: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  /** Only for models with the « thinking » capability: false = answer directly. */
  think?: boolean;
  /** Longest answer, in tokens (MAX_ANSWER_TOKENS by default). */
  maxTokens?: number;
  /** How long Ollama keeps the model loaded after the request (« 30m », « -1 » = always). */
  keepAlive?: string;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  /** Nanoseconds, as reported by Ollama. */
  promptEvalCount: number;
  evalCount: number;
  totalDurationMs: number;
}

/** The brain's view of a chat model (the tests use a fake one). */
export interface ChatModel {
  chat(request: ChatRequest, onToken: (text: string) => void): Promise<ChatResult>;
}

/** A spoken answer is one or two short sentences: the model is cut beyond (never rambles for minutes). */
export const MAX_ANSWER_TOKENS = 120;

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'missing-model' | 'other',
  ) {
    super(message);
  }
}

/** Ollama's errors are in English: the usual ones said in French, the original kept. */
export function explain(message: string): string {
  if (/does not support tools/i.test(message)) {
    return 'Ce modèle ne sait pas utiliser d’outils : choisis-en un autre (Ministral 3, Qwen 3.5…) pour agir sur ToolBox.';
  }
  if (/file does not exist|manifest unknown/i.test(message)) {
    return `Ce modèle n’existe pas sur ollama.com : vérifie son nom (${message}).`;
  }
  if (
    /forbidden|dial tcp|no such host|connection refused|timeout|EOF/i.test(message) &&
    /registry|manifest|pull|https?:/i.test(message)
  ) {
    return `Téléchargement impossible : le registre d’Ollama ne répond pas (connexion Internet ?). Détail : ${message}`;
  }
  return `Ollama : ${message}`;
}

async function* ndjson(response: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) yield JSON.parse(line) as Record<string, unknown>;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as Record<string, unknown>;
}

export class OllamaClient implements ChatModel {
  constructor(
    private readonly baseUrl: () => string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl().replace(/\/+$/, '')}${path}`;
  }

  private async request(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(this.url(path), {
        ...init,
        signal: init.signal ?? (init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined),
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError' && init.signal?.aborted) throw error;
      throw new OllamaError(
        `Ollama ne répond pas sur ${this.baseUrl()} : est-il lancé ?`,
        'offline',
      );
    }
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        // Plain text error.
      }
      const missing = response.status === 404 || /not found|does not exist/i.test(message);
      throw new OllamaError(explain(message), missing ? 'missing-model' : 'other');
    }
    return response;
  }

  /** Version, or null when Ollama is not running. */
  async version(): Promise<string | null> {
    try {
      const response = await this.request('/api/version', { timeoutMs: 1500 });
      return ((await response.json()) as { version?: string }).version ?? 'inconnue';
    } catch {
      return null;
    }
  }

  async models(): Promise<{ name: string; size: number; parameterSize: string | null }[]> {
    const response = await this.request('/api/tags', { timeoutMs: 5000 });
    const body = (await response.json()) as {
      models?: { name: string; size: number; details?: { parameter_size?: string } }[];
    };
    return (body.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size ?? null,
    }));
  }

  async capabilities(model: string): Promise<string[]> {
    const response = await this.request('/api/show', {
      method: 'POST',
      body: JSON.stringify({ model }),
      timeoutMs: 10_000,
    });
    return ((await response.json()) as { capabilities?: string[] }).capabilities ?? [];
  }

  /** Downloads a model (`ollama pull`), with progress. */
  async pull(
    model: string,
    onProgress: (fraction: number | null, status: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.request('/api/pull', {
      method: 'POST',
      body: JSON.stringify({ model, stream: true }),
      signal,
    });
    for await (const event of ndjson(response)) {
      if (typeof event.error === 'string') throw new OllamaError(explain(event.error), 'other');
      const total = Number(event.total ?? 0);
      const completed = Number(event.completed ?? 0);
      onProgress(total > 0 ? completed / total : null, String(event.status ?? ''));
    }
  }

  async chat(request: ChatRequest, onToken: (text: string) => void): Promise<ChatResult> {
    const response = await this.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        stream: true,
        keep_alive: request.keepAlive ?? '30m',
        ...(request.think === undefined ? {} : { think: request.think }),
        options: { temperature: 0.3, num_predict: request.maxTokens ?? MAX_ANSWER_TOKENS },
      }),
      signal: request.signal,
    });
    let content = '';
    const toolCalls: ToolCall[] = [];
    let last: Record<string, unknown> = {};
    for await (const event of ndjson(response)) {
      if (typeof event.error === 'string') throw new OllamaError(explain(event.error), 'other');
      const message = event.message as { content?: string; tool_calls?: ToolCall[] } | undefined;
      if (message?.content) {
        content += message.content;
        onToken(message.content);
      }
      if (message?.tool_calls?.length) toolCalls.push(...message.tool_calls);
      last = event;
    }
    return {
      content,
      toolCalls,
      promptEvalCount: Number(last.prompt_eval_count ?? 0),
      evalCount: Number(last.eval_count ?? 0),
      totalDurationMs: Math.round(Number(last.total_duration ?? 0) / 1e6),
    };
  }
}
