// v0.46.0: finding the Coffre's disk by its IDENTITY, wherever it is mounted
// (E: today, F: tomorrow). READ ONLY: this file never writes anything. Each
// probe is asynchronous and bounded in time (a sleeping or absent drive never
// freezes ToolBox).
import { readdir, readFile, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { IDENTITY_FILE, parseIdentity, type DiskIdentity } from './disk-layout';

/**
 * The roots of the mounted volumes. Windows: the drive letters C: to Z: that
 * answer. Elsewhere: « / », /media/<user>/*, /run/media/<user>/*, /mnt/*.
 * `TOOLBOX_COFFRE_VOLUMES` (paths separated by path.delimiter) replaces the
 * list: the tests simulate drives with folders.
 */
export async function volumeRoots(): Promise<string[]> {
  const forced = process.env.TOOLBOX_COFFRE_VOLUMES;
  if (forced) return forced.split(path.delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`);
    const found = await Promise.all(
      letters.map(async (root) => ((await answers(() => stat(root))) ? root : null)),
    );
    return found.filter((r): r is string => r !== null);
  }
  const out = ['/'];
  for (const base of ['/media', '/run/media', '/mnt']) {
    const level = async (dir: string, depth: number) => {
      const names = (await answers(() => readdir(dir))) ?? [];
      for (const n of names) {
        const full = path.join(dir, n);
        if (depth === 0) out.push(full);
        else await level(full, depth - 1);
      }
    };
    await level(base, base === '/mnt' ? 0 : 1);
  }
  return out;
}

/** A filesystem call that gives up after `ms` (null on error or timeout). */
export async function answers<T>(call: () => Promise<T>, ms = 1500): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The volume a path is on (the longest known root containing it), and the path inside it. */
export function splitVolume(p: string, roots: readonly string[]): { root: string; rel: string } {
  const abs = path.resolve(p);
  const same = (a: string, b: string) =>
    process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  let best: string | null = null;
  for (const r of roots) {
    const root = path.resolve(r);
    const inside =
      same(abs, root) ||
      (abs.length > root.length &&
        same(abs.slice(0, root.length), root) &&
        (root.endsWith(path.sep) || abs[root.length] === path.sep));
    if (inside && (!best || root.length > best.length)) best = root;
  }
  const root = best ?? path.parse(abs).root;
  return { root, rel: path.relative(root, abs) };
}

/** The identity of a ToolBox-Coffre folder, or null (absent, unreadable, not one). */
export async function readIdentity(dir: string): Promise<DiskIdentity | null> {
  const text = await answers(() => readFile(path.join(dir, IDENTITY_FILE), 'utf8'));
  return text === null ? null : parseIdentity(text);
}

/**
 * Where the disk of identity `id` is now: its last place first, then the same
 * relative path on every volume. Null when it is not plugged in.
 */
export async function findDisk(
  id: string,
  relRoot: string,
  lastRoot: string | null,
): Promise<string | null> {
  if (lastRoot && (await readIdentity(lastRoot))?.id === id) return lastRoot;
  for (const root of await volumeRoots()) {
    const candidate = path.join(root, relRoot);
    if (candidate === lastRoot) continue;
    if ((await readIdentity(candidate))?.id === id) return candidate;
  }
  return null;
}

/** Free and total bytes of the volume holding `dir` (null when unknown). */
export async function spaceOf(dir: string): Promise<{ free: number; total: number } | null> {
  const s = await answers(() => statfs(dir));
  return s ? { free: s.bavail * s.bsize, total: s.blocks * s.bsize } : null;
}
