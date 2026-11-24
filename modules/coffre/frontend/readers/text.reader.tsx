// Plain text: shown as it is (never interpreted). v0.47.0: a search's words marked.
import { useRef } from 'react';
import { useMarks } from './mark';
import { registerReader, type ReaderProps } from './registry';
import { useSourceText } from './useSource';

const THUMB_CHARS = 1200;

function TextReader({ source, mode, locate }: ReaderProps) {
  const { text, error } = useSourceText(source, mode === 'thumb' ? THUMB_CHARS : undefined);
  const box = useRef<HTMLPreElement>(null);
  useMarks(box, mode === 'full' ? locate?.query : null, text);
  if (error) return <p className="coffre-reader-error">{error}</p>;
  if (text === null) return null;
  return (
    <pre ref={box} className={mode === 'thumb' ? 'coffre-reader-thumb-text' : 'coffre-reader-text'}>
      {text}
    </pre>
  );
}

registerReader({
  id: 'text',
  label: 'Texte',
  extensions: ['txt', 'log', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'env'],
  maxBytes: 20_000_000,
  thumbMaxBytes: 2_000_000,
  component: TextReader,
});
