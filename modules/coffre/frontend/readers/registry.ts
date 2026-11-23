// v0.45.0: the readers of the Coffre's preview — a generic registry. A reader
// says which extensions it shows and gives its component; adding one is
// adding a file `readers/<name>.reader.tsx` that calls registerReader():
// nothing to change anywhere else (readers/index.ts finds the files).
import type { ComponentType } from 'react';

/** What a reader shows: a file of the Coffre (its URL) or a file just dropped (its Blob). */
export interface ReaderSource {
  name: string;
  /** Lowercase, without the dot (« pdf »). */
  ext: string;
  size: number;
  url: string | null;
  blob?: Blob | null;
}

/** v0.47.0: where to open (a search's result): its page, the words to mark. */
export interface ReaderLocate {
  page?: number;
  query?: string;
}

export interface ReaderProps {
  source: ReaderSource;
  /** « thumb »: a card's small preview (light, never interactive). */
  mode: 'full' | 'thumb';
  /** v0.47.0: opened from a search: at its page, the words marked. */
  locate?: ReaderLocate;
  /**
   * v0.47.0: shown in the reading window (fullscreen, its own window): the
   * reader may offer more (a PDF's tools, a Markdown's table of contents…).
   */
  window?: boolean;
}

export interface Reader {
  id: string;
  label: string;
  extensions: readonly string[];
  /** Larger files are not read (the card shows its icon, the preview « Ouvrir »). */
  maxBytes?: number;
  /** The thumbnail is lighter than the file: none above this size. */
  thumbMaxBytes?: number;
  /** When two readers take the same extension, the higher wins (default 0). */
  priority?: number;
  component: ComponentType<ReaderProps>;
}

const registered = new Map<string, Reader>();

/** Adds (or replaces, same id) a reader. */
export function registerReader(reader: Reader): void {
  registered.set(reader.id, reader);
}

export function readers(): Reader[] {
  return [...registered.values()];
}

/** The reader of a source, or null (an icon, and « Ouvrir dans l'application »). */
export function readerFor(source: ReaderSource, mode: 'full' | 'thumb' = 'full'): Reader | null {
  if (!source.url && !source.blob) return null;
  const ext = source.ext.toLowerCase();
  let best: Reader | null = null;
  for (const reader of registered.values()) {
    if (!reader.extensions.includes(ext)) continue;
    const limit = mode === 'thumb' ? (reader.thumbMaxBytes ?? reader.maxBytes) : reader.maxBytes;
    if (limit !== undefined && source.size > limit) continue;
    if (!best || (reader.priority ?? 0) > (best.priority ?? 0)) best = reader;
  }
  return best;
}

/** The bytes of a source (its Blob, or its URL read from the app's own server). */
export async function bytesOf(source: ReaderSource): Promise<ArrayBuffer> {
  if (source.blob) return source.blob.arrayBuffer();
  if (!source.url) throw new Error('Aucun fichier à lire');
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`Lecture impossible (${response.status})`);
  return response.arrayBuffer();
}

/** Its text (UTF-8), at most `max` characters. */
export async function textOf(source: ReaderSource, max = 2_000_000): Promise<string> {
  const text = new TextDecoder('utf-8').decode(await bytesOf(source));
  return text.length > max ? text.slice(0, max) : text;
}
