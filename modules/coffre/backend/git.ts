// v0.51.0 E (Expérimental, ADR 0068): Git, without any risk — READ ONLY, and
// never a git command. A project's branch and last commit (its .git), whether
// Git is writing in it right now (a « .lock » file: the project is not copied
// at that moment), and its changes not committed, found like git itself does
// (its index file: size and date of each followed file, then the file's own
// fingerprint when its date changed). Nothing here ever writes.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** The project's git folder (.git, or the folder a « .git » file points to), or null. */
export function gitDir(root: string): string | null {
  const dot = path.join(root, '.git');
  try {
    const s = statSync(dot);
    if (s.isDirectory()) return dot;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'));
    if (!m) return null;
    const dir = path.resolve(root, m[1]!.trim());
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

export interface GitInfo {
  branch: string | null;
  commit: { hash: string; message: string; date: string | null } | null;
}

/** The branch and the last commit, read in .git. */
export function readGit(root: string): GitInfo | null {
  const dir = gitDir(root);
  if (!dir) return null;
  const read = (p: string) => {
    try {
      return readFileSync(path.join(dir, p), 'utf8');
    } catch {
      return null;
    }
  };
  const head = read('HEAD')?.trim() ?? '';
  const branch = head.startsWith('ref: ') ? head.slice(5).replace(/^refs\/heads\//, '') : null;
  const lines = (read(path.join('logs', 'HEAD')) ?? '').trim().split('\n').filter(Boolean);
  const last = lines.at(-1);
  let commit: GitInfo['commit'] = null;
  if (last) {
    const m = /^[0-9a-f]+ ([0-9a-f]+) .*? (\d+) [+-]\d{4}\t(.*)$/.exec(last);
    if (m)
      commit = {
        hash: m[1]!.slice(0, 10),
        message: m[3]!.replace(/^[a-z ()-]+: /, ''),
        date: new Date(Number(m[2]) * 1000).toISOString(),
      };
  }
  if (!commit && /^[0-9a-f]{40}$/.test(head))
    commit = { hash: head.slice(0, 10), message: '', date: null };
  return { branch, commit };
}

/**
 * Git is writing in this project now: its « .lock » file (index.lock, HEAD.lock,
 * a branch being moved…), or null. A project is never copied at that moment.
 */
export function gitLock(root: string): string | null {
  const dir = gitDir(root);
  if (!dir) return null;
  const found = (folder: string, depth: number): string | null => {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return null;
    }
    for (const n of names) if (n.endsWith('.lock')) return path.join(folder, n);
    if (depth <= 0) return null;
    for (const n of names) {
      const full = path.join(folder, n);
      try {
        if (statSync(full).isDirectory()) {
          const hit = found(full, depth - 1);
          if (hit) return hit;
        }
      } catch {
        // gone meanwhile
      }
    }
    return null;
  };
  const top = found(dir, 0);
  if (top) return path.relative(path.dirname(dir), top).replace(/\\/g, '/');
  const ref = found(path.join(dir, 'refs'), 4);
  return ref ? path.relative(path.dirname(dir), ref).replace(/\\/g, '/') : null;
}

interface IndexEntry {
  path: string;
  size: number;
  mtimeSec: number;
  sha1: string;
}

/** The entries of git's index file (versions 2 and 3; version 4: null, not read). */
export function readGitIndex(buf: Buffer): IndexEntry[] | null {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'DIRC') return null;
  const version = buf.readUInt32BE(4);
  if (version !== 2 && version !== 3) return null;
  const count = buf.readUInt32BE(8);
  const out: IndexEntry[] = [];
  let at = 12;
  for (let i = 0; i < count; i++) {
    if (at + 62 > buf.length) return null;
    const mtimeSec = buf.readUInt32BE(at + 8);
    const size = buf.readUInt32BE(at + 36);
    const sha1 = buf.toString('hex', at + 40, at + 60);
    const flags = buf.readUInt16BE(at + 60);
    const extended = version === 3 && (flags & 0x4000) !== 0;
    const nameAt = at + 62 + (extended ? 2 : 0);
    const end = buf.indexOf(0, nameAt);
    if (end < 0) return null;
    const name = buf.toString('utf8', nameAt, end);
    const stage = (flags >> 12) & 3;
    if (stage === 0) out.push({ path: name, size, mtimeSec, sha1 });
    // Padded with 1 to 8 NUL bytes to a multiple of 8 (from the entry's start).
    const len = end - at;
    at += (len + 8) & ~7;
  }
  return out;
}

/** git's fingerprint of a file's content (« blob <taille>\0<contenu> », sha1). */
export function gitBlobSha(content: Buffer): string {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

export interface GitChanges {
  /** Followed files changed or gone since the last commit's index. */
  modified: number;
  deleted: number;
  /** Files saved by the project and not followed by git (its .gitignore apart). */
  untracked: number;
}

/** At most this many changed-date files read again (beyond: « non détecté »). */
const MAX_REHASH = 2000;

/**
 * The changes not committed, as git sees them (its index: size and date, then
 * the content's fingerprint when the date changed), or null when it cannot be
 * told without running git (no index, an index version not read, too many).
 * `saved`: the project's files (its exclusions apart, so its .gitignore too).
 */
export async function gitChanges(
  root: string,
  saved: readonly string[],
): Promise<GitChanges | null> {
  const dir = gitDir(root);
  if (!dir) return null;
  let entries: IndexEntry[] | null;
  try {
    entries = readGitIndex(await readFile(path.join(dir, 'index')));
  } catch {
    return null;
  }
  if (!entries) return null;
  const result: GitChanges = { modified: 0, deleted: 0, untracked: 0 };
  let reread = 0;
  for (const e of entries) {
    const file = path.join(root, ...e.path.split('/'));
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) {
      result.deleted++;
      continue;
    }
    // git keeps the size modulo 2^32.
    if (s.size % 2 ** 32 !== e.size) {
      result.modified++;
      continue;
    }
    if (Math.floor(s.mtimeMs / 1000) === e.mtimeSec) continue;
    if (++reread > MAX_REHASH) return null;
    if (gitBlobSha(await readFile(file)) !== e.sha1) result.modified++;
  }
  const followed = new Set(entries.map((e) => e.path));
  for (const rel of saved)
    if (!followed.has(rel) && !rel.split('/').includes('.git')) result.untracked++;
  return result;
}
