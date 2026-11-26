// v0.48.0 (Expérimental): the route picker's logic — a route typed
// (« Cours/Thermo/Labos », « cours › thermo », « Cours\Thermo »), completed
// segment by segment (accents and case ignored, tolerant: « cou/the » →
// « Cours/Thermo »), the segments that do not exist yet shown « nouveau »
// (created only at the validation), the names Windows refuses signalled.
// Pure (tested): the component (frontend/RoutePicker.tsx) only shows it.
import { fold } from './deduce';
import { invalidName } from './names';

/** What the picker needs of a folder. */
export interface RouteFolder {
  id: string;
  parentId: string | null;
  name: string;
  path: string[];
}

/** What the picker gives back. */
export type RoutePick =
  | { kind: 'existing'; id: string }
  /** To create at the validation (its existing beginning included). */
  | { kind: 'new'; path: string[] }
  | { kind: 'pending' }
  | { kind: 'root' };

/** The separators accepted between two segments. */
const SEPARATOR = /\s*(?:\/|\\|›|>)\s*/;

/** « Cours / Thermo/ » → segments ["Cours", "Thermo"], trailing: true (a child is being typed). */
export function splitRoute(text: string): { segments: string[]; trailing: boolean } {
  const trailing = /(?:\/|\\|›|>)\s*$/.test(text);
  const segments = text
    .split(SEPARATOR)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return { segments, trailing };
}

/** How the route reads in the interface. */
export const routeLabel = (path: readonly string[]) => path.join(' › ');

/**
 * How well a typed segment matches a name: 4 equal, 3 beginning, 2 beginning
 * of a word, 1 inside, 0 not at all (accents and case ignored).
 */
export function segmentScore(typed: string, name: string): number {
  const t = fold(typed).trim();
  const n = fold(name);
  if (!t) return 1;
  if (n === t) return 4;
  if (n.startsWith(t)) return 3;
  if (n.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(t))) return 2;
  return n.includes(t) ? 1 : 0;
}

export interface RouteSuggestion {
  id: string;
  path: string[];
  score: number;
}

/**
 * The existing folders a typed route may mean, best first. The typed
 * segments match the path's segments in order, the last one the folder's
 * own name; one segment alone matches a folder anywhere in the tree.
 */
export function suggestRoutes(
  text: string,
  folders: readonly RouteFolder[],
  limit = 30,
): RouteSuggestion[] {
  const { segments } = splitRoute(text);
  if (!segments.length) return [];
  const out: RouteSuggestion[] = [];
  for (const c of folders) {
    if (c.path.length < segments.length) continue;
    const last = segmentScore(segments[segments.length - 1]!, c.path[c.path.length - 1]!);
    if (!last) continue;
    // The earlier typed segments, in order, among the earlier path segments.
    let score = last * 2;
    let at = 0;
    let fine = true;
    for (const typed of segments.slice(0, -1)) {
      let best = 0;
      while (at < c.path.length - 1 && !best) {
        best = segmentScore(typed, c.path[at]!);
        at++;
      }
      if (!best) {
        fine = false;
        break;
      }
      score += best;
    }
    if (!fine) continue;
    // Shallow routes and full routes typed first.
    score -= (c.path.length - segments.length) * 0.5;
    out.push({ id: c.id, path: c.path, score });
  }
  return out
    .sort((a, b) => b.score - a.score || routeLabel(a.path).localeCompare(routeLabel(b.path), 'fr'))
    .slice(0, limit);
}

export interface ResolvedSegment {
  name: string;
  /** The existing folder of this segment, or null (« nouveau »). */
  id: string | null;
  /** Why Windows refuses it (only for a new one), or null. */
  error: string | null;
}

export interface ResolvedRoute {
  segments: ResolvedSegment[];
  /** The folder the route names, when every segment exists. */
  existingId: string | null;
  /** The route to create at the validation (the existing beginning included), or null. */
  newPath: string[] | null;
  /** The first error (nothing can be validated), or null. */
  error: string | null;
}

/** The route exactly as typed: each segment existing (exact name, accents ignored) or new. */
export function resolveRoute(text: string, folders: readonly RouteFolder[]): ResolvedRoute {
  const { segments } = splitRoute(text);
  const out: ResolvedSegment[] = [];
  let parent: string | null = null;
  let creating = false;
  for (const name of segments) {
    const found: RouteFolder | undefined = creating
      ? undefined
      : folders.find((c) => c.parentId === parent && fold(c.name) === fold(name));
    if (found) {
      out.push({ name: found.name, id: found.id, error: null });
      parent = found.id;
    } else {
      creating = true;
      out.push({ name, id: null, error: invalidName(name) });
    }
  }
  const error = out.find((s) => s.error)?.error ?? null;
  const last = out[out.length - 1];
  return {
    segments: out,
    existingId: last && !creating ? last.id : null,
    newPath: creating ? out.map((s) => s.name) : null,
    error: out.length ? error : 'Route vide',
  };
}

/**
 * Tab: the typed text completed — its last segment replaced by the best
 * suggestion's path (the earlier segments too, when they were partial).
 */
export function completeRoute(text: string, folders: readonly RouteFolder[]): string | null {
  const best = suggestRoutes(text, folders, 1)[0];
  if (!best) return null;
  const done = best.path.join('/');
  return fold(done) === fold(splitRoute(text).segments.join('/')) ? null : done;
}

/** The folder and all its descendants (a folder never moves into one of them). */
export function subtreeOf(id: string, folders: readonly RouteFolder[]): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of folders)
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
  }
  return out;
}
