// Tables of « Analyse du master »: projects (a library track, or a free group
// named by the user), their versions (copies of the imported files), the
// analyses cached by file content, reference profiles and their tracks, the
// files already seen in the watched folder.
import type { ModuleContext } from '@hub/sdk/backend';
import type { Section } from '../shared/types';

export const MIGRATION_V1 = `
  CREATE TABLE master_analysis__groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    suggested_track_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE master_analysis__analyses (
    hash TEXT PRIMARY KEY,
    analyzer INTEGER NOT NULL,
    summary TEXT NOT NULL,
    analysis_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE master_analysis__versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    original_path TEXT,
    hash TEXT NOT NULL,
    size INTEGER,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    job_id TEXT,
    sections TEXT,
    align_offset REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX master_analysis__versions_group ON master_analysis__versions (group_id);
  CREATE TABLE master_analysis__profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE master_analysis__refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    hash TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    job_id TEXT,
    sections TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE master_analysis__watch (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    hash TEXT,
    version_id INTEGER,
    seen_at TEXT NOT NULL
  );
`;

export interface GroupRow {
  id: number;
  track_id: number | null;
  name: string;
  suggested_track_id: number | null;
  created_at: string;
}

export interface VersionRow {
  id: number;
  group_id: number;
  number: number;
  name: string;
  file_path: string;
  original_name: string;
  original_path: string | null;
  hash: string;
  size: number | null;
  source: 'import' | 'library' | 'watch';
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  error: string | null;
  job_id: string | null;
  sections: string | null;
  align_offset: number | null;
  created_at: string;
}

export interface ProfileRow {
  id: number;
  name: string;
  created_at: string;
}

export interface RefRow {
  id: number;
  profile_id: number;
  name: string;
  file_path: string;
  original_name: string;
  hash: string;
  status: VersionRow['status'];
  error: string | null;
  job_id: string | null;
  sections: string | null;
  created_at: string;
}

/** Light summary kept in the database (lists, badges, assistant) — the curves are in a file. */
export interface AnalysisSummary {
  integrated: number | null;
  lra: number | null;
  truePeak: number | null;
  samplePeak: number | null;
  plr: number | null;
  crest: number | null;
  correlation: number | null;
  width: number | null;
  monoLoss: number | null;
  durationSec: number;
  sampleRate: number;
  bitDepth: number | null;
  channels: number;
  codec: string;
  format: string;
  overs: { start: number; end: number; value: number | null }[];
  clips: number;
  leadingSilence: number;
  trailingSilence: number;
  dc: number[];
  bands: { id: string; db: number | null; relative: number | null }[];
}

export class MasterStore {
  readonly t: Record<'groups' | 'analyses' | 'versions' | 'profiles' | 'refs' | 'watch', string>;

  constructor(private readonly ctx: ModuleContext) {
    const db = ctx.db;
    this.t = {
      groups: db.table('groups'),
      analyses: db.table('analyses'),
      versions: db.table('versions'),
      profiles: db.table('profiles'),
      refs: db.table('refs'),
      watch: db.table('watch'),
    };
  }

  private get db() {
    return this.ctx.db;
  }

  // Groups ---------------------------------------------------------------------

  groups(): GroupRow[] {
    return this.db.prepare(`SELECT * FROM ${this.t.groups} ORDER BY id`).all() as GroupRow[];
  }

  group(id: number): GroupRow | null {
    return (
      (this.db.prepare(`SELECT * FROM ${this.t.groups} WHERE id = ?`).get(id) as GroupRow) ?? null
    );
  }

  groupOfTrack(trackId: number): GroupRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM ${this.t.groups} WHERE track_id = ?`)
        .get(trackId) as GroupRow) ?? null
    );
  }

  /** The group of a track, created when needed. */
  ensureTrackGroup(trackId: number, name: string): GroupRow {
    const existing = this.groupOfTrack(trackId);
    if (existing) return existing;
    const id = this.db
      .prepare(`INSERT INTO ${this.t.groups} (track_id, name, created_at) VALUES (?, ?, ?)`)
      .run(trackId, name, new Date().toISOString()).lastInsertRowid;
    return this.group(Number(id))!;
  }

  createFreeGroup(name: string, suggestedTrackId: number | null = null): GroupRow {
    const id = this.db
      .prepare(
        `INSERT INTO ${this.t.groups} (track_id, name, suggested_track_id, created_at) VALUES (NULL, ?, ?, ?)`,
      )
      .run(name, suggestedTrackId, new Date().toISOString()).lastInsertRowid;
    return this.group(Number(id))!;
  }

  renameGroup(id: number, name: string): void {
    this.db.prepare(`UPDATE ${this.t.groups} SET name = ? WHERE id = ?`).run(name, id);
  }

  /** Moves every version of `from` into `to` (numbers continue), then removes `from`. */
  mergeGroups(from: number, to: number): void {
    const next = this.nextNumber(to);
    const versions = this.versions(from);
    const update = this.db.prepare(
      `UPDATE ${this.t.versions} SET group_id = ?, number = ? WHERE id = ?`,
    );
    versions.forEach((v, i) => update.run(to, next + i, v.id));
    this.db.prepare(`DELETE FROM ${this.t.groups} WHERE id = ?`).run(from);
  }

  setGroupTrack(id: number, trackId: number | null): void {
    this.db
      .prepare(`UPDATE ${this.t.groups} SET track_id = ?, suggested_track_id = NULL WHERE id = ?`)
      .run(trackId, id);
  }

  deleteGroupIfEmpty(id: number): void {
    if (this.versions(id).length === 0)
      this.db.prepare(`DELETE FROM ${this.t.groups} WHERE id = ? AND track_id IS NULL`).run(id);
  }

  // Versions -------------------------------------------------------------------

  versions(groupId?: number): VersionRow[] {
    return (
      groupId === undefined
        ? this.db.prepare(`SELECT * FROM ${this.t.versions} ORDER BY group_id, number`).all()
        : this.db
            .prepare(`SELECT * FROM ${this.t.versions} WHERE group_id = ? ORDER BY number`)
            .all(groupId)
    ) as VersionRow[];
  }

  version(id: number): VersionRow | null {
    return (
      (this.db.prepare(`SELECT * FROM ${this.t.versions} WHERE id = ?`).get(id) as VersionRow) ??
      null
    );
  }

  nextNumber(groupId: number): number {
    const row = this.db
      .prepare(`SELECT MAX(number) AS n FROM ${this.t.versions} WHERE group_id = ?`)
      .get(groupId) as { n: number | null };
    return (row.n ?? 0) + 1;
  }

  addVersion(
    v: Omit<
      VersionRow,
      | 'id'
      | 'number'
      | 'name'
      | 'status'
      | 'error'
      | 'job_id'
      | 'sections'
      | 'align_offset'
      | 'created_at'
    > & { name?: string },
  ): VersionRow {
    const number = this.nextNumber(v.group_id);
    const created = new Date();
    const date = created.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const id = this.db
      .prepare(
        `INSERT INTO ${this.t.versions} (group_id, number, name, file_path, original_name, original_path, hash, size, source, status, created_at)
         VALUES (@group_id, @number, @name, @file_path, @original_name, @original_path, @hash, @size, @source, 'queued', @created_at)`,
      )
      .run({
        ...v,
        number,
        name: v.name?.trim() || `v${number} — ${date}`,
        created_at: created.toISOString(),
      }).lastInsertRowid;
    return this.version(Number(id))!;
  }

  setVersionFile(id: number, filePath: string): void {
    this.db.prepare(`UPDATE ${this.t.versions} SET file_path = ? WHERE id = ?`).run(filePath, id);
  }

  setVersion(
    id: number,
    fields: Partial<
      Pick<VersionRow, 'name' | 'status' | 'error' | 'job_id' | 'sections' | 'align_offset'>
    >,
  ): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.db
      .prepare(
        `UPDATE ${this.t.versions} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`,
      )
      .run({ ...fields, id });
  }

  deleteVersion(id: number): void {
    this.db.prepare(`DELETE FROM ${this.t.versions} WHERE id = ?`).run(id);
  }

  sectionsOf(row: { sections: string | null }): Section[] | null {
    if (!row.sections) return null;
    try {
      return JSON.parse(row.sections) as Section[];
    } catch {
      return null;
    }
  }

  // Analyses (by content) ---------------------------------------------------------

  analysis(hash: string): {
    hash: string;
    analyzer: number;
    summary: AnalysisSummary;
    analysis_ms: number;
    created_at: string;
  } | null {
    const row = this.db.prepare(`SELECT * FROM ${this.t.analyses} WHERE hash = ?`).get(hash) as
      | { hash: string; analyzer: number; summary: string; analysis_ms: number; created_at: string }
      | undefined;
    return row ? { ...row, summary: JSON.parse(row.summary) as AnalysisSummary } : null;
  }

  saveAnalysis(hash: string, analyzer: number, summary: AnalysisSummary, ms: number): void {
    this.db
      .prepare(
        `INSERT INTO ${this.t.analyses} (hash, analyzer, summary, analysis_ms, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (hash) DO UPDATE SET analyzer = excluded.analyzer, summary = excluded.summary,
           analysis_ms = excluded.analysis_ms, created_at = excluded.created_at`,
      )
      .run(hash, analyzer, JSON.stringify(summary), ms, new Date().toISOString());
  }

  /** Is a cached analysis still used by a version or a reference? */
  hashUsed(hash: string): boolean {
    const v = this.db.prepare(`SELECT 1 FROM ${this.t.versions} WHERE hash = ? LIMIT 1`).get(hash);
    const r = this.db.prepare(`SELECT 1 FROM ${this.t.refs} WHERE hash = ? LIMIT 1`).get(hash);
    return Boolean(v || r);
  }

  forgetAnalysis(hash: string): void {
    this.db.prepare(`DELETE FROM ${this.t.analyses} WHERE hash = ?`).run(hash);
  }

  // Profiles and references --------------------------------------------------------

  profiles(): ProfileRow[] {
    return this.db.prepare(`SELECT * FROM ${this.t.profiles} ORDER BY name`).all() as ProfileRow[];
  }

  profile(id: number): ProfileRow | null {
    return (
      (this.db.prepare(`SELECT * FROM ${this.t.profiles} WHERE id = ?`).get(id) as ProfileRow) ??
      null
    );
  }

  addProfile(name: string): ProfileRow {
    const id = this.db
      .prepare(`INSERT INTO ${this.t.profiles} (name, created_at) VALUES (?, ?)`)
      .run(name, new Date().toISOString()).lastInsertRowid;
    return this.profile(Number(id))!;
  }

  renameProfile(id: number, name: string): void {
    this.db.prepare(`UPDATE ${this.t.profiles} SET name = ? WHERE id = ?`).run(name, id);
  }

  deleteProfile(id: number): void {
    this.db.prepare(`DELETE FROM ${this.t.profiles} WHERE id = ?`).run(id);
  }

  refs(profileId?: number): RefRow[] {
    return (
      profileId === undefined
        ? this.db.prepare(`SELECT * FROM ${this.t.refs} ORDER BY profile_id, id`).all()
        : this.db
            .prepare(`SELECT * FROM ${this.t.refs} WHERE profile_id = ? ORDER BY id`)
            .all(profileId)
    ) as RefRow[];
  }

  ref(id: number): RefRow | null {
    return (this.db.prepare(`SELECT * FROM ${this.t.refs} WHERE id = ?`).get(id) as RefRow) ?? null;
  }

  addRef(r: Pick<RefRow, 'profile_id' | 'name' | 'file_path' | 'original_name' | 'hash'>): RefRow {
    const id = this.db
      .prepare(
        `INSERT INTO ${this.t.refs} (profile_id, name, file_path, original_name, hash, status, created_at)
         VALUES (@profile_id, @name, @file_path, @original_name, @hash, 'queued', @created_at)`,
      )
      .run({ ...r, created_at: new Date().toISOString() }).lastInsertRowid;
    return this.ref(Number(id))!;
  }

  setRef(
    id: number,
    fields: Partial<
      Pick<RefRow, 'name' | 'status' | 'error' | 'job_id' | 'sections' | 'file_path'>
    >,
  ): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.db
      .prepare(
        `UPDATE ${this.t.refs} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`,
      )
      .run({ ...fields, id });
  }

  deleteRef(id: number): void {
    this.db.prepare(`DELETE FROM ${this.t.refs} WHERE id = ?`).run(id);
  }

  // Watched folder ---------------------------------------------------------------

  seen(path: string): {
    path: string;
    size: number;
    mtime: number;
    hash: string | null;
    version_id: number | null;
  } | null {
    return (
      (this.db.prepare(`SELECT * FROM ${this.t.watch} WHERE path = ?`).get(path) as never) ?? null
    );
  }

  markSeen(
    path: string,
    size: number,
    mtime: number,
    hash: string | null,
    versionId: number | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO ${this.t.watch} (path, size, mtime, hash, version_id, seen_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, hash = excluded.hash,
           version_id = excluded.version_id, seen_at = excluded.seen_at`,
      )
      .run(path, size, mtime, hash, versionId, new Date().toISOString());
  }

  versionsWithHash(hash: string): VersionRow[] {
    return this.db
      .prepare(`SELECT * FROM ${this.t.versions} WHERE hash = ?`)
      .all(hash) as VersionRow[];
  }
}
