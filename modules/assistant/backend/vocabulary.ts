// The words of the assistant, edited by Thomas (page « Mots ») :
// - corrections: « when the ear writes X, understand Y » (« tout doux » → « to-do »),
//   applied right after the transcription, on whole words only;
// - expected words: English words and names given to whisper.cpp with each
//   recording (its « prompt »), so it writes « Obsidian » and not « obsidienne »;
// - nicknames of the tools (« mes tâches » → To-do), used by « ouvre … ».
import type { Migration, ModuleDatabase } from '@hub/sdk/backend';

/** English words (and words of the trade) prefilled in the list, editable. */
export const DEFAULT_WORDS = [
  'ToolBox',
  'to-do',
  'mix',
  'master',
  'mastering',
  'drop',
  'Reel',
  'Reels',
  'Short',
  'Shorts',
  'sidechain',
  'preset',
  'beat',
  'sample',
  'stems',
  'kick',
  'snare',
  'hi-hat',
  'synth',
  'build-up',
  'release',
  'feat',
  'remix',
  'playlist',
  'YouTube',
  'Instagram',
  'Spotify',
  'SoundCloud',
  'FL Studio',
  'plugin',
  'LUFS',
  'true peak',
];

/** Prefilled nicknames of the tools and pages (key: module id or page route), editable. */
export const DEFAULT_NICKNAMES: Record<string, string[]> = {
  todo: ['to-do', 'todo', 'ma to-do', 'liste de tâches', 'mes tâches'],
  'release-planner': ['planning', 'le planning', 'calendrier de sortie', 'les sorties'],
  'youtube-stats': ['stats', 'statistiques', 'les stats YouTube'],
  'music-library': ['bibliothèque', 'biblio', 'mes morceaux'],
  'youtube-video': ['vidéo YouTube', 'générateur de vidéo'],
  'instagram-video': ['pack insta', 'pack Instagram'],
  'custom-reels': ['Reels perso', 'mes Reels'],
  'master-analysis': ['analyse du master', 'analyse', 'le master'],
  assistant: ['assistant', 'assistant vocal'],
  '/': ['accueil', 'page d’accueil'],
  '/settings': ['réglages', 'paramètres'],
  '/outputs': ['fichiers générés'],
  '/jobs': ['tâches en cours', 'rendus en cours'],
};

const sql = (text: string) => text.replace(/'/g, "''");

export const VOCABULARY_MIGRATION: Migration = {
  version: 2,
  description: 'corrections, expected words and tool nicknames (voice assistant)',
  up: `
    CREATE TABLE assistant__corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      heard TEXT NOT NULL UNIQUE,
      replacement TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE assistant__words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE assistant__nicknames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      nickname TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (target, nickname)
    );
    INSERT INTO assistant__corrections (heard, replacement, created_at)
      VALUES ('tout doux', 'to-do', '2026-10-24T00:00:00.000Z');
    ${DEFAULT_WORDS.map(
      (w) =>
        `INSERT INTO assistant__words (word, created_at) VALUES ('${sql(w)}', '2026-10-24T00:00:00.000Z');`,
    ).join('\n')}
    ${Object.entries(DEFAULT_NICKNAMES)
      .flatMap(([target, list]) =>
        list.map(
          (n) =>
            `INSERT INTO assistant__nicknames (target, nickname, created_at) VALUES ('${sql(target)}', '${sql(n)}', '2026-10-24T00:00:00.000Z');`,
        ),
      )
      .join('\n')}
  `,
};

/** Lower case, no accents, apostrophes and dashes as spaces: for comparing words. */
export function foldWord(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Correction {
  id: number;
  heard: string;
  replacement: string;
}

/**
 * Applies the corrections on whole words only (never inside another word),
 * whatever the case and accents: « Ouvre la Tout-Doux » → « Ouvre la to-do ».
 * The longest « heard » first, each part of the text replaced once.
 */
export function applyCorrections(text: string, corrections: Correction[]): string {
  // Words of the text with their position (letters, digits, inner apostrophes and dashes).
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    folded: foldWord(m[0]),
  }));
  const rules = corrections
    .map((c) => ({ ...c, words: foldWord(c.heard).split(' ').filter(Boolean) }))
    .filter((c) => c.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length || b.heard.length - a.heard.length);
  const replaced: { start: number; end: number; text: string }[] = [];
  const used = new Set<number>();
  for (const rule of rules) {
    for (let i = 0; i + rule.words.length <= tokens.length; i++) {
      const span = tokens.slice(i, i + rule.words.length);
      if (span.some((_, k) => used.has(i + k))) continue;
      if (!span.every((t, k) => t.folded === rule.words[k])) continue;
      span.forEach((_, k) => used.add(i + k));
      replaced.push({ start: span[0]!.start, end: span.at(-1)!.end, text: rule.replacement });
    }
  }
  let result = text;
  for (const r of replaced.sort((a, b) => b.start - a.start))
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  return result;
}

/**
 * The words given to whisper.cpp (its « prompt »): a short comma list, the
 * most useful first, cut to `maxChars` (whisper reads at most ~220 tokens).
 */
export function expectedWordsPrompt(groups: string[][], maxChars = 700): string {
  const seen = new Set<string>();
  const words: string[] = [];
  let length = 0;
  for (const group of groups)
    for (const raw of group) {
      const word = raw.replace(/\s+/g, ' ').trim();
      const key = foldWord(word);
      if (!word || seen.has(key)) continue;
      if (length + word.length + 2 > maxChars) return words.join(', ');
      seen.add(key);
      words.push(word);
      length += word.length + 2;
    }
  return words.join(', ');
}

const MAX = 120;

function clean(text: unknown, what: string): string {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) throw new Error(`Écris ${what}`);
  if (value.length > MAX) throw new Error(`Trop long (${MAX} caractères au plus)`);
  return value;
}

export class Vocabulary {
  constructor(private readonly db: ModuleDatabase) {}

  // Corrections ------------------------------------------------------------

  corrections(): Correction[] {
    return this.db
      .prepare('SELECT id, heard, replacement FROM assistant__corrections ORDER BY heard')
      .all() as Correction[];
  }

  /** Adds or replaces the correction of `heard` (one correction per heard text). */
  setCorrection(heard: unknown, replacement: unknown, id?: number): Correction {
    const h = clean(heard, 'ce que l’oreille écrit');
    const r = clean(replacement, 'ce qu’il faut comprendre');
    if (foldWord(h) === foldWord(r)) throw new Error('Les deux textes sont identiques');
    const existing = this.corrections().find(
      (c) => foldWord(c.heard) === foldWord(h) && c.id !== id,
    );
    if (existing) throw new Error(`« ${existing.heard} » a déjà une correction`);
    if (id !== undefined) {
      const changes = this.db
        .prepare('UPDATE assistant__corrections SET heard = ?, replacement = ? WHERE id = ?')
        .run(h, r, id).changes;
      if (changes === 0) throw new Error('Correction introuvable');
      return { id, heard: h, replacement: r };
    }
    const result = this.db
      .prepare(
        'INSERT INTO assistant__corrections (heard, replacement, created_at) VALUES (?, ?, ?)',
      )
      .run(h, r, new Date().toISOString());
    return { id: Number(result.lastInsertRowid), heard: h, replacement: r };
  }

  removeCorrection(id: number): void {
    if (this.db.prepare('DELETE FROM assistant__corrections WHERE id = ?').run(id).changes === 0)
      throw new Error('Correction introuvable');
  }

  correct(text: string): string {
    return applyCorrections(text, this.corrections());
  }

  // Expected words ---------------------------------------------------------

  words(): { id: number; word: string }[] {
    return this.db
      .prepare('SELECT id, word FROM assistant__words ORDER BY word COLLATE NOCASE')
      .all() as { id: number; word: string }[];
  }

  addWord(word: unknown): void {
    const w = clean(word, 'un mot');
    if (this.words().some((x) => foldWord(x.word) === foldWord(w))) return;
    this.db
      .prepare('INSERT INTO assistant__words (word, created_at) VALUES (?, ?)')
      .run(w, new Date().toISOString());
  }

  removeWord(id: number): void {
    if (this.db.prepare('DELETE FROM assistant__words WHERE id = ?').run(id).changes === 0)
      throw new Error('Mot introuvable');
  }

  /** « Rétablir la liste d'origine »: the default words added back (Thomas's are kept). */
  restoreWords(): number {
    let added = 0;
    for (const word of DEFAULT_WORDS) {
      const before = this.words().length;
      this.addWord(word);
      if (this.words().length > before) added++;
    }
    return added;
  }

  // Nicknames of the tools -------------------------------------------------

  nicknames(): Record<string, { id: number; nickname: string }[]> {
    const rows = this.db
      .prepare('SELECT id, target, nickname FROM assistant__nicknames ORDER BY id')
      .all() as { id: number; target: string; nickname: string }[];
    const result: Record<string, { id: number; nickname: string }[]> = {};
    for (const row of rows)
      (result[row.target] ??= []).push({ id: row.id, nickname: row.nickname });
    return result;
  }

  nicknameMap(): Record<string, string[]> {
    return Object.fromEntries(
      Object.entries(this.nicknames()).map(([target, list]) => [
        target,
        list.map((n) => n.nickname),
      ]),
    );
  }

  addNickname(target: unknown, nickname: unknown): void {
    const t = clean(target, 'l’outil');
    const n = clean(nickname, 'un surnom');
    this.db
      .prepare(
        'INSERT OR IGNORE INTO assistant__nicknames (target, nickname, created_at) VALUES (?, ?, ?)',
      )
      .run(t, n, new Date().toISOString());
  }

  removeNickname(id: number): void {
    if (this.db.prepare('DELETE FROM assistant__nicknames WHERE id = ?').run(id).changes === 0)
      throw new Error('Surnom introuvable');
  }

  // Export / import (with the dictionary of the commands) ------------------

  export() {
    return {
      corrections: this.corrections().map(({ heard, replacement }) => ({ heard, replacement })),
      words: this.words().map((w) => w.word),
      nicknames: Object.entries(this.nicknameMap()).flatMap(([target, list]) =>
        list.map((nickname) => ({ target, nickname })),
      ),
    };
  }

  /** Adds what the file has; an existing correction of the same heard text is kept. */
  import(data: { corrections?: unknown; words?: unknown; nicknames?: unknown }): {
    corrections: number;
    words: number;
    nicknames: number;
    skipped: number;
  } {
    const counts = { corrections: 0, words: 0, nicknames: 0, skipped: 0 };
    const list = (value: unknown) => (Array.isArray(value) ? value : []);
    this.db.transaction(() => {
      for (const entry of list(data.corrections)) {
        const e = entry as { heard?: unknown; replacement?: unknown };
        try {
          this.setCorrection(e.heard, e.replacement);
          counts.corrections++;
        } catch {
          counts.skipped++;
        }
      }
      for (const entry of list(data.words)) {
        try {
          const before = this.words().length;
          this.addWord(entry);
          if (this.words().length > before) counts.words++;
        } catch {
          counts.skipped++;
        }
      }
      for (const entry of list(data.nicknames)) {
        const e = entry as { target?: unknown; nickname?: unknown };
        try {
          const before = JSON.stringify(this.nicknameMap());
          this.addNickname(e.target, e.nickname);
          if (JSON.stringify(this.nicknameMap()) !== before) counts.nicknames++;
        } catch {
          counts.skipped++;
        }
      }
    });
    return counts;
  }
}
