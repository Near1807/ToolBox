// The Coffre's migrations. 1 to 7: the model of v0.45–v0.49 (published: never
// changed). 8 (v0.50.0, ADR 0067): the model « tout est dossier » — a dated
// exception decided by Thomas: only with an EMPTY Coffre (else a refusal:
// nothing touched, the Coffre waits), the old tables are dropped (their rows
// logically deleted by « Réinitialiser le Coffre » stay in the automatic backup
// taken before) and the new ones created.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  changesTableSql,
  MigrationRefusal,
  SYNC_COLUMNS,
  type Migration,
  type MigrationDatabase,
} from '@hub/sdk/core';
import { DOWNLOADS_MIGRATION_SQL } from './downloads';
import { RULES_MIGRATION_SQL } from './learning';
import { TEXT_MIGRATION_SQL } from './text-index';

/** Migration 7: the imports of this PC (v0.48; the table is dropped by migration 8). */
const IMPORTS_MIGRATION_SQL = (t: string) => `
  CREATE TABLE ${t} (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    bytes_done INTEGER NOT NULL DEFAULT 0,
    bytes_total INTEGER NOT NULL DEFAULT 0,
    created_json TEXT NOT NULL DEFAULT '[]',
    error TEXT
  );
`;

/** The Coffre's own folders on the PC (empty ones do not make it « not empty »). */
const TECHNICAL = new Set(['_arrivée', '_corbeille', '_toolbox', '_à ranger']);

/** Files in the Coffre's folder on the PC (its technical folders, when empty, apart). */
function filesOnPc(root: string | undefined): number {
  if (!root || !existsSync(root)) return 0;
  let n = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else n++;
    }
  };
  walk(root);
  return n;
}

/** Folders at the top of the Coffre's folder on the PC that are not its technical ones. */
function foldersOnPc(root: string | undefined): string[] {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !TECHNICAL.has(e.name.toLowerCase()))
    .map((e) => e.name);
}

/** v0.50.0: the new model's tables (ADR 0067). */
const FOLDERS_MODEL_SQL = (t: (name: string) => string) => `
  CREATE TABLE ${t('folders')} (
    ${SYNC_COLUMNS},
    parent_id TEXT,
    name TEXT NOT NULL,
    color TEXT,
    sort INTEGER,
    course_name TEXT,
    end_of_route INTEGER NOT NULL DEFAULT 0,
    project INTEGER NOT NULL DEFAULT 0,
    default_labels_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE ${t('items')} (
    ${SYNC_COLUMNS},
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    rel_path TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT,
    ext TEXT NOT NULL DEFAULT '',
    folder_id TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    trashed_at TEXT,
    trash_from TEXT,
    source_path TEXT,
    source_sha256 TEXT,
    source_url TEXT,
    referrer_url TEXT,
    file_date TEXT,
    archived_at TEXT,
    stat_json TEXT,
    opened_at TEXT,
    original_name TEXT
  );
  CREATE INDEX ${t('items_folder')} ON ${t('items')} (folder_id);
  CREATE INDEX ${t('items_sha')} ON ${t('items')} (sha256);
  CREATE TABLE ${t('labels')} (
    ${SYNC_COLUMNS},
    item_id TEXT NOT NULL,
    family TEXT NOT NULL,
    value TEXT NOT NULL,
    origin TEXT NOT NULL,
    reason TEXT
  );
  CREATE INDEX ${t('labels_item')} ON ${t('labels')} (item_id);
  CREATE TABLE ${t('label_sets')} (
    ${SYNC_COLUMNS},
    name TEXT NOT NULL,
    labels_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE ${t('copies')} (
    ${SYNC_COLUMNS},
    item_id TEXT NOT NULL,
    disk_id TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    sha256 TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    copied_at TEXT,
    trashed_at TEXT,
    damaged_at TEXT
  );
  CREATE INDEX ${t('copies_item')} ON ${t('copies')} (item_id);
  CREATE TABLE ${t('versions')} (
    ${SYNC_COLUMNS},
    item_id TEXT NOT NULL,
    disk_id TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    name TEXT NOT NULL,
    sha256 TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    saved_at TEXT NOT NULL
  );
  CREATE INDEX ${t('versions_item')} ON ${t('versions')} (item_id);
  ${TEXT_MIGRATION_SQL(t('text'), t('text_state'))}
  ${DOWNLOADS_MIGRATION_SQL(t('downloads'))}
`;

/** The old model's tables whose live rows mean « the Coffre is not empty ». */
const OLD_LIVE = ['items', 'contexts', 'attributes', 'also', 'copies', 'versions'];
/** Every table of the old model dropped (the disks, the rules and the journal stay). */
const OLD_TABLES = [
  'items',
  'contexts',
  'attributes',
  'also',
  'imports',
  'copies',
  'versions',
  'text',
  'text_state',
  'downloads',
];

/** v0.50.0 (ADR 0067): migration 8 — only with an empty Coffre. */
export function migrateToFolders(db: MigrationDatabase): void {
  const live = OLD_LIVE.map((name) => ({
    name,
    n: (
      db.prepare(`SELECT COUNT(*) AS n FROM ${db.table(name)} WHERE deleted_at IS NULL`).get() as {
        n: number;
      }
    ).n,
  }));
  const rows = live.reduce((s, l) => s + l.n, 0);
  const files = filesOnPc(db.libraryDir);
  const folders = foldersOnPc(db.libraryDir);
  if (rows || files || folders.length) {
    const what = [
      rows ? `${rows} ligne(s) dans la base` : '',
      files ? `${files} fichier(s) dans son dossier du PC` : '',
      folders.length ? `des dossiers (${folders.slice(0, 3).join(', ')})` : '',
    ]
      .filter(Boolean)
      .join(', ');
    throw new MigrationRefusal(
      `Le Coffre n’est pas vide (${what}). Cette version (dossiers, étiquettes) demande un ` +
        'Coffre vide ; rien n’a été touché. Pour continuer : réinstalle la v0.49.0, fais ' +
        '« Réinitialiser le Coffre » (Gestion › Zone sensible), puis réinstalle cette version.',
    );
  }
  for (const name of OLD_TABLES) db.exec(`DROP TABLE IF EXISTS ${db.table(name)}`);
  // Every learned rule pointed to an old context (site, word: its id; ext: « id:ext »).
  db.exec(`DELETE FROM ${db.table('rules')}`);
  db.exec(FOLDERS_MODEL_SQL((name) => db.table(name)));
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'elements, contexts, attributes, « aussi utilisé », journal (ready for sync)',
    up: `
        CREATE TABLE coffre__items (
          ${SYNC_COLUMNS},
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          rel_path TEXT,
          external_path TEXT,
          size INTEGER NOT NULL DEFAULT 0,
          sha256 TEXT,
          ext TEXT NOT NULL DEFAULT '',
          context_id TEXT,
          arrival INTEGER NOT NULL DEFAULT 0,
          pinned INTEGER NOT NULL DEFAULT 0,
          trashed_at TEXT,
          trash_from TEXT,
          source_path TEXT,
          source_url TEXT,
          referrer_url TEXT,
          file_date TEXT
        );
        CREATE INDEX coffre__items_context ON coffre__items (context_id);
        CREATE INDEX coffre__items_sha ON coffre__items (sha256);
        CREATE TABLE coffre__contexts (
          ${SYNC_COLUMNS},
          parent_id TEXT,
          name TEXT NOT NULL,
          color TEXT,
          sort INTEGER,
          cover_item_id TEXT
        );
        CREATE TABLE coffre__attributes (
          ${SYNC_COLUMNS},
          item_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          origin TEXT NOT NULL,
          reason TEXT
        );
        CREATE INDEX coffre__attributes_item ON coffre__attributes (item_id);
        CREATE TABLE coffre__also (
          ${SYNC_COLUMNS},
          item_id TEXT NOT NULL,
          context_id TEXT NOT NULL
        );
        ${changesTableSql('coffre__changes')}
      `,
  },
  {
    version: 2,
    description:
      'v0.46.0 : le disque (disques, copies, anciennes versions), archivés, état des fichiers du PC',
    up: `
        ALTER TABLE coffre__items ADD COLUMN archived_at TEXT;
        ALTER TABLE coffre__items ADD COLUMN stat_json TEXT;
        ALTER TABLE coffre__items ADD COLUMN opened_at TEXT;
        CREATE TABLE coffre__disks (
          ${SYNC_COLUMNS},
          name TEXT NOT NULL,
          rel_root TEXT NOT NULL,
          last_root TEXT,
          last_update_at TEXT,
          last_update_json TEXT,
          last_verify_json TEXT
        );
        CREATE TABLE coffre__copies (
          ${SYNC_COLUMNS},
          item_id TEXT NOT NULL,
          disk_id TEXT NOT NULL,
          rel_path TEXT NOT NULL,
          sha256 TEXT,
          size INTEGER NOT NULL DEFAULT 0,
          copied_at TEXT,
          trashed_at TEXT,
          damaged_at TEXT
        );
        CREATE INDEX coffre__copies_item ON coffre__copies (item_id);
        CREATE TABLE coffre__versions (
          ${SYNC_COLUMNS},
          item_id TEXT NOT NULL,
          disk_id TEXT NOT NULL,
          rel_path TEXT NOT NULL,
          name TEXT NOT NULL,
          sha256 TEXT,
          size INTEGER NOT NULL DEFAULT 0,
          saved_at TEXT NOT NULL
        );
        CREATE INDEX coffre__versions_item ON coffre__versions (item_id);
      `,
  },
  {
    version: 3,
    description:
      'v0.47.0 : texte des éléments pour la recherche dans le contenu (index FTS5, gardé sur le PC)',
    up: TEXT_MIGRATION_SQL('coffre__text', 'coffre__text_state'),
  },
  {
    version: 4,
    description:
      'v0.47.0 : fichiers de Téléchargements suivis (surveillance désactivée par défaut ; état de ce PC)',
    up: DOWNLOADS_MIGRATION_SQL('coffre__downloads'),
  },
  {
    version: 5,
    description:
      'v0.47.0 : ce que le Coffre apprend des choix de Thomas (règles, prêt pour la synchro)',
    up: RULES_MIGRATION_SQL('coffre__rules'),
  },
  {
    version: 6,
    description: 'v0.47.0 : « Lié au cours … » d’un contexte (« Maintenant »)',
    up: `ALTER TABLE coffre__contexts ADD COLUMN course_name TEXT;`,
  },
  {
    version: 7,
    description:
      'v0.48.0 : nom d’origine d’un élément, marque « à compléter », imports d’arborescence (état de ce PC, reprise)',
    up: `
        ALTER TABLE coffre__items ADD COLUMN original_name TEXT;
        ALTER TABLE coffre__items ADD COLUMN to_complete INTEGER NOT NULL DEFAULT 0;
        ${IMPORTS_MIGRATION_SQL('coffre__imports')}
      `,
  },
  {
    version: 8,
    description:
      'v0.50.0 : modèle « tout est dossier » (dossiers, étiquettes, ensembles) ; exige un Coffre vide ; anciennes tables du Coffre supprimées (exception datée, ADR 0067)',
    up: migrateToFolders,
  },
  {
    version: 9,
    description:
      'v0.51.0 : projets avancés — fichiers intérieurs indexés, copie du disque fichier par fichier, versions par fichier, exclusions par projet, projet suivi en place (ajouts seulement, ADR 0068)',
    up: `
        ALTER TABLE coffre__items ADD COLUMN tracked_path TEXT;
        ALTER TABLE coffre__items ADD COLUMN missing_at TEXT;
        ALTER TABLE coffre__items ADD COLUMN exclusions_json TEXT;
        ALTER TABLE coffre__versions ADD COLUMN inner_rel TEXT;
        CREATE TABLE coffre__inner_files (
          item_id TEXT NOT NULL,
          rel TEXT NOT NULL,
          name TEXT NOT NULL,
          ext TEXT NOT NULL DEFAULT '',
          folded TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          mtime INTEGER NOT NULL DEFAULT 0,
          sha256 TEXT NOT NULL,
          text_sha TEXT,
          text_status TEXT,
          text_rows TEXT,
          text_at TEXT,
          PRIMARY KEY (item_id, rel)
        );
        CREATE TABLE coffre__inner_copies (
          disk_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          rel TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          copied_at TEXT NOT NULL,
          PRIMARY KEY (disk_id, item_id, rel)
        );
      `,
  },
];
