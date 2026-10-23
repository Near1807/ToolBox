import { randomUUID } from 'node:crypto';
import {
  HttpError,
  type AssistantActionDefinition,
  type AssistantActionInfo,
  type AssistantOutcome,
  type AssistantParameter,
  type AssistantParams,
  type ModuleAssistant,
  type ModuleLogger,
  type ModuleManifest,
} from '../../packages/sdk/backend';

// Registry of the actions modules offer to the voice assistant (ADR 0028).
// The hub, not the assistant, enforces the risk rules: a destructive action
// never runs without `confirmed`, a sensitive one never runs at all. Undo
// handlers live in memory only (they end with the app, like the conversation).

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const UNDO_TTL_MS = 60 * 60 * 1000;
const UNDO_MAX = 100;

interface Entry {
  info: AssistantActionInfo;
  definition: AssistantActionDefinition;
}

interface UndoEntry {
  run: () => void | Promise<void>;
  moduleId: string;
  label: string;
  expires: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Coerces what a model sends (numbers as strings, a tag list as "a, b") and checks types. */
function coerce(key: string, spec: AssistantParameter, value: unknown): AssistantParams[string] {
  const fail = (expected: string): never => {
    throw new TypeError(`Paramètre « ${key} » : ${expected} attendu`);
  };
  switch (spec.type) {
    case 'string': {
      if (typeof value === 'number') value = String(value);
      if (typeof value !== 'string') fail('du texte');
      const text = (value as string).trim();
      if (spec.enum && !spec.enum.includes(text)) fail(`une valeur parmi ${spec.enum.join(', ')}`);
      return text;
    }
    case 'number':
    case 'integer': {
      const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof number !== 'number' || !Number.isFinite(number)) fail('un nombre');
      if (spec.type === 'integer' && !Number.isInteger(number)) fail('un nombre entier');
      return number as number;
    }
    case 'boolean':
      if (value === 'true' || value === 'false') return value === 'true';
      if (typeof value !== 'boolean') fail('vrai ou faux');
      return value as boolean;
    case 'string[]': {
      const list = typeof value === 'string' ? value.split(',') : value;
      if (!Array.isArray(list) || list.some((v) => typeof v !== 'string' && typeof v !== 'number'))
        fail('une liste de textes');
      return (list as (string | number)[]).map((v) => String(v).trim()).filter(Boolean);
    }
  }
}

/** Checks parameters against the action's declaration; throws a French TypeError. */
export function validateParams(
  definition: AssistantActionDefinition,
  raw: unknown,
): AssistantParams {
  const specs = definition.parameters ?? {};
  const input = raw === undefined || raw === null ? {} : raw;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Paramètres : un objet attendu');
  }
  const params: AssistantParams = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const spec = specs[key];
    if (!spec) throw new TypeError(`Paramètre inconnu « ${key} »`);
    // Models often send "" or null for an optional parameter they do not use.
    if (value === null || value === undefined || value === '') continue;
    params[key] = coerce(key, spec, value);
  }
  for (const key of definition.required ?? []) {
    if (params[key] === undefined) throw new TypeError(`Paramètre « ${key} » manquant`);
  }
  return params;
}

function checkDefinition(definition: AssistantActionDefinition): void {
  const where = `Action d’assistant « ${definition.name} »`;
  if (!NAME.test(definition.name)) throw new Error(`${where} : nom en kebab-case attendu`);
  if (!definition.description.trim()) throw new Error(`${where} : description manquante`);
  for (const key of definition.required ?? []) {
    if (!definition.parameters?.[key])
      throw new Error(`${where} : « ${key} » requis mais non déclaré`);
  }
  if (definition.risk === 'sensitive') {
    if (definition.run)
      throw new Error(`${where} : une action sensible ne s’exécute jamais (pas de run)`);
  } else if (!definition.run) {
    throw new Error(`${where} : run() manquant`);
  }
  if (definition.risk === 'destructive' && !definition.confirmation) {
    throw new Error(`${where} : une action destructrice doit fournir confirmation()`);
  }
}

export class AssistantRegistry {
  private readonly actions = new Map<string, Entry>();
  private readonly undos = new Map<string, UndoEntry>();

  /** Declares an action; returns a function that removes it (module failing to start). */
  define(moduleId: string, moduleName: string, definition: AssistantActionDefinition): () => void {
    checkDefinition(definition);
    const id = `${moduleId}.${definition.name}`;
    if (this.actions.has(id)) throw new Error(`Action d’assistant « ${id} » déjà déclarée`);
    const base = moduleId === 'core' ? '' : `/m/${moduleId}`;
    const page =
      definition.risk === 'sensitive'
        ? `${base}/${(definition.page ?? '').replace(/^\//, '')}`.replace(/\/$/, '') || '/'
        : null;
    this.actions.set(id, {
      definition,
      info: {
        id,
        moduleId,
        moduleName,
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters ?? {},
        required: definition.required ?? [],
        risk: definition.risk,
        page,
      },
    });
    return () => {
      this.actions.delete(id);
    };
  }

  list(): AssistantActionInfo[] {
    return [...this.actions.values()].map((entry) => entry.info);
  }

  async run(
    id: string,
    raw: unknown,
    options: { confirmed?: boolean } = {},
    logger?: ModuleLogger,
  ): Promise<AssistantOutcome> {
    const entry = this.actions.get(id);
    if (!entry) return { status: 'invalid', id, message: `Action inconnue « ${id} »` };
    const { definition, info } = entry;
    if (definition.risk === 'sensitive') {
      return {
        status: 'refused',
        id,
        message: `« ${definition.description} » : je ne le fais pas moi-même (action sensible). Je peux ouvrir la page pour que tu le fasses.`,
        open: info.page,
      };
    }
    let params: AssistantParams;
    try {
      params = validateParams(definition, raw);
    } catch (error) {
      return { status: 'invalid', id, message: errorMessage(error) };
    }
    try {
      if (definition.risk === 'destructive' && options.confirmed !== true) {
        return { status: 'confirm', id, question: await definition.confirmation!(params) };
      }
      const result = await definition.run!(params);
      let undoId: string | null = null;
      if (result.undo && definition.risk !== 'read') {
        undoId = this.keepUndo(info.moduleId, result.message, result.undo);
      }
      return {
        status: 'done',
        id,
        message: result.message,
        data: result.data ?? null,
        undoId,
        open: result.open ?? null,
      };
    } catch (error) {
      // An HttpError is an expected refusal (unknown task…): no log noise.
      if (!(error instanceof HttpError)) logger?.error(`Action « ${id} » en échec`, error);
      return { status: 'error', id, message: errorMessage(error) };
    }
  }

  async undo(undoId: string): Promise<{ ok: boolean; message: string }> {
    this.prune();
    const entry = this.undos.get(undoId);
    if (!entry) return { ok: false, message: 'Rien à annuler (trop ancien ou déjà annulé).' };
    this.undos.delete(undoId);
    try {
      await entry.run();
      return { ok: true, message: `Annulé : ${entry.label}` };
    } catch (error) {
      return { ok: false, message: `Annulation impossible : ${errorMessage(error)}` };
    }
  }

  private keepUndo(moduleId: string, label: string, run: () => void | Promise<void>): string {
    this.prune();
    const id = randomUUID();
    this.undos.set(id, { run, moduleId, label, expires: Date.now() + UNDO_TTL_MS });
    while (this.undos.size > UNDO_MAX) this.undos.delete(this.undos.keys().next().value!);
    return id;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, entry] of this.undos) if (entry.expires < now) this.undos.delete(id);
  }

  /** ctx.assistant of a module: catalog, run and undo only with permissions.assistant. */
  forModule(
    manifest: ModuleManifest,
    logger: ModuleLogger,
    onDispose: (dispose: () => void) => void,
  ): ModuleAssistant {
    const allowed = manifest.permissions?.assistant === true;
    const guard = () => {
      if (!allowed) {
        throw new Error('ctx.assistant : « permissions.assistant » non déclaré dans module.json');
      }
    };
    return {
      define: (definition) => onDispose(this.define(manifest.id, manifest.name, definition)),
      actions: () => {
        guard();
        return this.list();
      },
      run: (id, params, options) => {
        guard();
        return this.run(id, params, options, logger);
      },
      undo: (undoId) => {
        guard();
        return this.undo(undoId);
      },
    };
  }
}
