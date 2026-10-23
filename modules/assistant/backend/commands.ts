// The standardised commands of the assistant: the actions of the modules that
// declare example phrases and an extractor (MODULES.md §5.15), with Thomas's
// dictionary on top. Keeps the index up to date (a new phrase counts at once).
import type { AssistantActionInfo, ModuleContext } from '@hub/sdk/backend';
import { Dictionary, cleanPhrase } from './dictionary';
import type { Embedder } from './embedder';
import {
  CommandIndex,
  DEFAULT_MATCH,
  type Candidate,
  type CommandSpec,
  type MatchResult,
  type MatchSettings,
} from './matcher';

export interface CommandPhraseDto {
  /** Thomas's phrases only (module phrases have none). */
  id: number | null;
  text: string;
  source: 'module' | 'user';
  hidden: boolean;
}

export interface CommandDto {
  id: string;
  moduleId: string;
  moduleName: string;
  description: string;
  risk: AssistantActionInfo['risk'];
  parameters: { name: string; description: string; required: boolean }[];
  right: { id: string; label: string; granted: boolean } | null;
  phrases: CommandPhraseDto[];
  /** Runs from a phrase (false: disabled for lack of the right). */
  available: boolean;
}

export interface ConflictDto {
  actionId: string;
  moduleName: string;
  description: string;
  score: number;
  phrase: string;
}

export class CommandService {
  readonly dictionary: Dictionary;
  private readonly index = new CommandIndex();
  private signature = '';
  private building: Promise<void> | null = null;

  constructor(
    private readonly ctx: ModuleContext,
    private readonly settings: () => MatchSettings,
  ) {
    this.dictionary = new Dictionary(ctx.db);
  }

  setEmbedder(embedder: Embedder | null): void {
    this.index.setEmbedder(embedder);
    this.signature = '';
  }

  get semantic(): boolean {
    return this.index.semantic;
  }

  /** Actions that can be recognised from a phrase. */
  private actions(): AssistantActionInfo[] {
    return this.ctx.assistant.actions().filter((a) => a.extracts && a.risk !== 'sensitive');
  }

  list(): CommandDto[] {
    const user = this.dictionary.phrases();
    const hidden = this.dictionary.hidden();
    return this.actions().map((action) => {
      const hiddenTexts = new Set(
        hidden.filter((h) => h.actionId === action.id).map((h) => h.text),
      );
      return {
        id: action.id,
        moduleId: action.moduleId,
        moduleName: action.moduleName,
        description: action.description,
        risk: action.risk,
        parameters: Object.entries(action.parameters).map(([name, p]) => ({
          name,
          description: p.description,
          required: action.required.includes(name),
        })),
        right: action.right,
        phrases: [
          ...action.examples.map((text) => ({
            id: null,
            text,
            source: 'module' as const,
            hidden: hiddenTexts.has(text),
          })),
          ...user
            .filter((p) => p.actionId === action.id)
            .map((p) => ({ id: p.id, text: p.text, source: 'user' as const, hidden: false })),
        ],
        available: action.right === null || action.right.granted,
      };
    });
  }

  private specs(): CommandSpec[] {
    return this.list().map((command) => ({
      id: command.id,
      moduleName: command.moduleName,
      description: command.description,
      risk: command.risk,
      required: command.parameters.filter((p) => p.required).map((p) => p.name),
      phrases: command.phrases
        .filter((p) => !p.hidden)
        .map(({ text, source }) => ({ text, source })),
      extract: (utterance: string) => this.ctx.assistant.extract(command.id, utterance),
    }));
  }

  /** Rebuilds the index when a phrase, a module or the embeddings changed. */
  async ready(): Promise<void> {
    const specs = this.specs();
    const signature = JSON.stringify(specs.map((s) => [s.id, s.phrases.map((p) => p.text)]));
    if (signature === this.signature && !this.building) return;
    if (signature !== this.signature) {
      this.signature = signature;
      const build = this.index.build(specs);
      this.building = build;
      try {
        await build;
      } finally {
        if (this.building === build) this.building = null;
      }
      return;
    }
    await this.building;
  }

  async match(utterance: string, settings = this.settings()): Promise<MatchResult> {
    await this.ready();
    return this.index.match(utterance, settings);
  }

  describe(candidate: Candidate | null): ConflictDto | null {
    if (!candidate) return null;
    const action = this.ctx.assistant.actions().find((a) => a.id === candidate.actionId);
    return {
      actionId: candidate.actionId,
      moduleName: action?.moduleName ?? '',
      description: action?.description ?? candidate.actionId,
      score: candidate.score,
      phrase: candidate.phrase,
    };
  }

  private known(actionId: string): boolean {
    return this.actions().some((a) => a.id === actionId);
  }

  private check(actionId: string): void {
    if (!this.known(actionId)) throw new Error('Commande inconnue');
  }

  /** Commands a phrase would be too close to (same scores as the recognition). */
  async conflicts(actionId: string, text: string): Promise<ConflictDto[]> {
    await this.ready();
    const settings = this.settings() ?? DEFAULT_MATCH;
    return (await this.index.conflicts(actionId, text, settings)).map((c) => this.describe(c)!);
  }

  /**
   * Adds Thomas's phrase. Too close to another command: not saved, the
   * conflicts are returned (saved only with `force`, after his confirmation).
   */
  async addPhrase(
    actionId: string,
    raw: unknown,
    force = false,
  ): Promise<{ saved: boolean; id: number | null; conflicts: ConflictDto[] }> {
    this.check(actionId);
    const text = cleanPhrase(raw);
    const conflicts = await this.conflicts(actionId, text);
    if (conflicts.length > 0 && !force) return { saved: false, id: null, conflicts };
    const id = this.dictionary.add(actionId, text);
    await this.ready();
    return { saved: true, id, conflicts };
  }

  async updatePhrase(
    id: number,
    raw: unknown,
    force = false,
  ): Promise<{ saved: boolean; conflicts: ConflictDto[] }> {
    const phrase = this.dictionary.phrase(id);
    if (!phrase) throw new Error('Phrase introuvable');
    const text = cleanPhrase(raw);
    const conflicts = await this.conflicts(phrase.actionId, text);
    if (conflicts.length > 0 && !force) return { saved: false, conflicts };
    this.dictionary.update(id, text);
    await this.ready();
    return { saved: true, conflicts };
  }

  async removePhrase(id: number): Promise<void> {
    if (!this.dictionary.phrase(id)) throw new Error('Phrase introuvable');
    this.dictionary.remove(id);
    await this.ready();
  }

  async setHidden(actionId: string, text: string, hidden: boolean): Promise<void> {
    const action = this.actions().find((a) => a.id === actionId);
    if (!action?.examples.includes(text)) throw new Error('Phrase du module introuvable');
    if (hidden) this.dictionary.hide(actionId, text);
    else this.dictionary.unhide(actionId, text);
    await this.ready();
  }

  async restore(actionId?: string): Promise<{ removed: number; shown: number }> {
    if (actionId) this.check(actionId);
    const result = this.dictionary.restore(actionId);
    await this.ready();
    return result;
  }

  async import(file: unknown): Promise<{ added: number; hidden: number; skipped: number }> {
    const result = this.dictionary.import(file, (id) => this.known(id));
    await this.ready();
    return result;
  }
}
