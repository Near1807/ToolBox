// The files named by synchronised rows (a recipe picture…, ADR 0044,
// v0.33.0): they travel AFTER the data, in both directions, once per
// fingerprint (sha256), in pieces of a reasonable size. A missing file never
// stops the data: it arrives at the next synchronisation.
// Safety: a device never trusts a path sent by the other. A file is named by
// its row (scope, table, id); each side reads ITS OWN row (the data are
// already synchronised) for the file name and the fingerprint, checks the
// name (no folder, no « .. »), and a received file is written only when its
// sha256 is the row's. A synchronisation never deletes a file (a deleted row
// keeps its file: restorable).
// Portable: no Node import (it also runs in the phone's Worker).
import type { FileTable, SyncEngine } from './engine';

/** A file as both devices name it: by its row. */
export interface FileRef {
  scope: string;
  /** The table's name in the module (as declared in `sync.files`). */
  entity: string;
  id: string;
  sha256: string;
}

/** A piece of a file (base64), and its whole size. */
export interface FileChunk {
  offset: number;
  total: number;
  data: string;
}

/** Bytes per piece (before base64): 512 KiB, a recipe picture in one or two. */
export const FILE_CHUNK = 512 * 1024;
/** No file larger than this travels (a recipe picture is far smaller). */
const MAX_FILE = 32 * 1024 * 1024;

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;
const SHA = /^[0-9a-f]{64}$/;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Row {
  id: string;
  name: string;
  sha256: string;
}

export class SyncFiles {
  /** Files being received, by fingerprint (pieces kept until the last one). */
  private readonly incoming = new Map<
    string,
    { total: number; parts: Uint8Array[]; got: number }
  >();

  constructor(private readonly engine: SyncEngine) {}

  private rows(t: FileTable, id?: string): Row[] {
    const sql = `SELECT id, ${t.column} AS name, ${t.sha256} AS sha256 FROM ${t.table} WHERE deleted_at IS NULL${id ? ' AND id = ?' : ''}`;
    return (id ? this.engine.query<Row>(sql, id) : this.engine.query<Row>(sql)).filter(
      (r) => typeof r.name === 'string' && SAFE_NAME.test(r.name) && SHA.test(String(r.sha256)),
    );
  }

  private path(t: FileTable, row: Row): string {
    return t.files.dataPath(t.folder, row.name);
  }

  private present(t: FileTable, row: Row): boolean {
    try {
      return t.files.fileSize(this.path(t, row)) !== null;
    } catch {
      return false;
    }
  }

  private table(ref: { scope: string; entity: string }): FileTable {
    const t = this.engine
      .fileTables()
      .find((f) => f.scope === ref.scope && f.entity === ref.entity);
    if (!t) throw new Error('Fichier inconnu');
    return t;
  }

  /** The row named by the other device, read here: its name and fingerprint are ours. */
  private own(ref: FileRef): { t: FileTable; row: Row } {
    const t = this.table(ref);
    const row = this.rows(t, ref.id)[0];
    if (!row || row.sha256 !== ref.sha256) throw new Error('Fichier inconnu ici');
    return { t, row };
  }

  /**
   * The files this device lacks (one per fingerprint). A file present here
   * under another row with the same fingerprint is copied first: it never
   * travels twice.
   */
  missing(): FileRef[] {
    const out: FileRef[] = [];
    const seen = new Set<string>();
    for (const t of this.engine.fileTables()) {
      let rows: Row[];
      try {
        rows = this.rows(t);
      } catch {
        continue; // The table does not exist yet (not migrated): nothing to fetch.
      }
      for (const row of rows) {
        if (this.present(t, row)) continue;
        if (this.copyFromTwin(row.sha256)) continue;
        if (seen.has(row.sha256)) continue;
        seen.add(row.sha256);
        out.push({ scope: t.scope, entity: t.entity, id: row.id, sha256: row.sha256 });
      }
    }
    return out;
  }

  /** A file of the same fingerprint, here: its bytes, or null. */
  private twin(sha256: string): Uint8Array | null {
    for (const t of this.engine.fileTables())
      for (const row of this.rows(t))
        if (row.sha256 === sha256 && this.present(t, row))
          return t.files.readFile(this.path(t, row));
    return null;
  }

  /** Writes the bytes for every live row of this fingerprint that lacks its file. */
  private fill(sha256: string, bytes: Uint8Array): number {
    let n = 0;
    for (const t of this.engine.fileTables())
      for (const row of this.rows(t))
        if (row.sha256 === sha256 && !this.present(t, row)) {
          t.files.writeFile(this.path(t, row), bytes);
          n++;
        }
    return n;
  }

  private copyFromTwin(sha256: string): boolean {
    const bytes = this.twin(sha256);
    if (!bytes) return false;
    this.fill(sha256, bytes);
    return true;
  }

  /** A piece of a file this device has (asked by the other one). */
  read(ref: FileRef, offset: number): FileChunk {
    const { t, row } = this.own(ref);
    const bytes = t.files.readFile(this.path(t, row));
    if (!(Number.isInteger(offset) && offset >= 0 && offset <= bytes.length))
      throw new Error('Morceau invalide');
    return {
      offset,
      total: bytes.length,
      data: toBase64(bytes.subarray(offset, offset + FILE_CHUNK)),
    };
  }

  /**
   * A piece received. The last one completes the file: written only when
   * its sha256 is the row's (else dropped, asked again next time).
   * Returns true once the file is written.
   */
  async receive(ref: FileRef, chunk: FileChunk): Promise<boolean> {
    const { row } = this.own(ref);
    if (!(chunk.total > 0 && chunk.total <= MAX_FILE)) throw new Error('Fichier trop grand');
    let entry = this.incoming.get(row.sha256);
    if (chunk.offset === 0 || !entry || entry.total !== chunk.total) {
      entry = { total: chunk.total, parts: [], got: 0 };
      this.incoming.set(row.sha256, entry);
    }
    if (chunk.offset !== entry.got) throw new Error('Morceau hors d’ordre');
    const part = fromBase64(chunk.data);
    if (entry.got + part.length > entry.total) throw new Error('Morceau trop long');
    entry.parts.push(part);
    entry.got += part.length;
    if (entry.got < entry.total) return false;
    this.incoming.delete(row.sha256);
    const bytes = new Uint8Array(entry.total);
    let at = 0;
    for (const p of entry.parts) {
      bytes.set(p, at);
      at += p.length;
    }
    if ((await sha256Of(bytes)) !== row.sha256) throw new Error('Fichier abîmé en route');
    this.fill(row.sha256, bytes);
    return true;
  }
}
