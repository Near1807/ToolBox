// The object URL of a Blob, or the source's own URL; the text of a source.
import { useEffect, useMemo, useState } from 'react';
import { textOf, type ReaderSource } from './registry';

export function useSourceUrl(source: ReaderSource): string | null {
  const blobUrl = useMemo(
    () => (source.blob ? URL.createObjectURL(source.blob) : null),
    [source.blob],
  );
  // Freed a while after (a remount in development reuses it meanwhile).
  useEffect(() => {
    if (!blobUrl) return;
    return () => {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    };
  }, [blobUrl]);
  return blobUrl ?? source.url;
}

interface TextState {
  source: ReaderSource | null;
  text: string | null;
  error: string | null;
}

/** The source's text (null while reading), and the error if any. */
export function useSourceText(
  source: ReaderSource,
  max?: number,
): { text: string | null; error: string | null } {
  const [state, setState] = useState<TextState>({ source: null, text: null, error: null });
  useEffect(() => {
    let live = true;
    textOf(source, max)
      .then((text) => live && setState({ source, text, error: null }))
      .catch((e: unknown) => live && setState({ source, text: null, error: String(e) }));
    return () => {
      live = false;
    };
  }, [source, max]);
  return state.source === source ? state : { text: null, error: null };
}
