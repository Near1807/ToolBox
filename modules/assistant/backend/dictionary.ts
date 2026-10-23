// The dictionary of the commands: Thomas's own phrases, and the module phrases
// he hid (never deleted: « Rétablir » brings them back). Only phrases change
// here, never an action, its parameters or its risk level.
import type { Migration, ModuleDatabase } from '@hub/sdk/backend';

export const DICTIONARY_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'dictionary of the commands',
    up: `
      CREATE TABLE assistant__phrases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (action_id, text)
      );
      CREATE TABLE assistant__hidden_phrases (
        action_id TEXT NOT NULL,
        text TEXT NOT NULL,
        hidden_at TEXT NOT NULL,
        PRIMARY KEY (action_id, text)
      );
    `,
  },
];

export interface UserPhrase {
  id: number;
  actionId: string;
  text: string;
  createdAt: string;
}

/** The file of « Exporter le dictionnaire ». */
export interface DictionaryFile {
  format: 'toolbox-assistant-commands';
  version: 1;
  exportedAt: string;
  phrases: { action: string; text: string }[];
  hidden: { action: string; text: string }[];
}

const MAX_PHRASE = 200;

export function cleanPhrase(text: unknown): string {
  const phrase = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!phrase) throw new Error('Écris une phrase');
  if (phrase.length > MAX_PHRASE)
    throw new Error(`Phrase trop longue (${MAX_PHRASE} caractères au plus)`);
  return phrase;
}

export class Dictionary {
  constructor(private readonly db: ModuleDatabase) {}

  phrases(actionId?: string): UserPhrase[] {
    const rows = (
      actionId
        ? this.db
            .prepare(
              'SELECT id, action_id, text, created_at FROM assistant__phrases WHERE action_id = ? ORDER BY id',
            )
            .all(actionId)
        : this.db
            .prepare('SELECT id, action_id, text, created_at FROM assistant__phrases ORDER BY id')
            .all()
    ) as { id: number; action_id: string; text: string; created_at: string }[];
    return rows.map((r) => ({
      id: r.id,
      actionId: r.action_id,
      text: r.text,
      createdAt: r.created_at,
    }));
  }

  phrase(id: number): UserPhrase | null {
    return this.phrases().find((p) => p.id === id) ?? null;
  }

  hidden(actionId?: string): { actionId: string; text: string }[] {
    const rows = (
      actionId
        ? this.db
            .prepare('SELECT action_id, text FROM assistant__hidden_phrases WHERE action_id = ?')
            .all(actionId)
        : this.db.prepare('SELECT action_id, text FROM assistant__hidden_phrases').all()
    ) as { action_id: string; text: string }[];
    return rows.map((r) => ({ actionId: r.action_id, text: r.text }));
  }

  /** Adds a phrase (nothing if it is already there); returns its id. */
  add(actionId: string, text: string): number {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO assistant__phrases (action_id, text, created_at) VALUES (?, ?, ?)',
      )
      .run(actionId, text, new Date().toISOString());
    const row = this.db
      .prepare('SELECT id FROM assistant__phrases WHERE action_id = ? AND text = ?')
      .get(actionId, text) as { id: number };
    return row.id;
  }

  update(id: number, text: string): void {
    this.db.prepare('UPDATE assistant__phrases SET text = ? WHERE id = ?').run(text, id);
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM assistant__phrases WHERE id = ?').run(id);
  }

  hide(actionId: string, text: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO assistant__hidden_phrases (action_id, text, hidden_at) VALUES (?, ?, ?)',
      )
      .run(actionId, text, new Date().toISOString());
  }

  unhide(actionId: string, text: string): void {
    this.db
      .prepare('DELETE FROM assistant__hidden_phrases WHERE action_id = ? AND text = ?')
      .run(actionId, text);
  }

  /**
   * « Rétablir les phrases d'origine »: the module phrases shown again and
   * Thomas's phrases removed (asked after a confirmation in the interface).
   */
  restore(actionId?: string): { removed: number; shown: number } {
    const run = (sql: string) =>
      actionId
        ? this.db.prepare(`${sql} WHERE action_id = ?`).run(actionId)
        : this.db.prepare(sql).run();
    return this.db.transaction(() => ({
      removed: run('DELETE FROM assistant__phrases').changes,
      shown: run('DELETE FROM assistant__hidden_phrases').changes,
    }));
  }

  export(): DictionaryFile {
    return {
      format: 'toolbox-assistant-commands',
      version: 1,
      exportedAt: new Date().toISOString(),
      phrases: this.phrases().map((p) => ({ action: p.actionId, text: p.text })),
      hidden: this.hidden().map((h) => ({ action: h.actionId, text: h.text })),
    };
  }

  /**
   * Adds what the file has and the dictionary has not: nothing is removed or
   * replaced. Phrases of unknown commands (module missing) are skipped.
   */
  import(
    file: unknown,
    known: (actionId: string) => boolean,
  ): { added: number; hidden: number; skipped: number } {
    const data = file as Partial<DictionaryFile> | null;
    if (!data || data.format !== 'toolbox-assistant-commands' || data.version !== 1)
      throw new Error('Ce fichier n’est pas un dictionnaire de commandes ToolBox');
    const list = (value: unknown) =>
      (Array.isArray(value) ? value : []).filter(
        (e): e is { action: string; text: string } =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.action === 'string' &&
          typeof e.text === 'string',
      );
    let added = 0;
    let hidden = 0;
    let skipped = 0;
    this.db.transaction(() => {
      for (const entry of list(data.phrases)) {
        let text: string;
        try {
          text = cleanPhrase(entry.text);
        } catch {
          skipped++;
          continue;
        }
        if (!known(entry.action)) {
          skipped++;
          continue;
        }
        const before = this.phrases(entry.action).length;
        this.add(entry.action, text);
        if (this.phrases(entry.action).length > before) added++;
      }
      for (const entry of list(data.hidden)) {
        if (!known(entry.action)) {
          skipped++;
          continue;
        }
        const before = this.hidden(entry.action).length;
        this.hide(entry.action, entry.text);
        if (this.hidden(entry.action).length > before) hidden++;
      }
    });
    return { added, hidden, skipped };
  }
}
