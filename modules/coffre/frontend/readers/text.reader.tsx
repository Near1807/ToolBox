// Plain text: shown as it is (never interpreted).
import { registerReader, type ReaderProps } from './registry';
import { useSourceText } from './useSource';

const THUMB_CHARS = 1200;

function TextReader({ source, mode }: ReaderProps) {
  const { text, error } = useSourceText(source, mode === 'thumb' ? THUMB_CHARS : undefined);
  if (error) return <p className="coffre-reader-error">{error}</p>;
  if (text === null) return null;
  return (
    <pre className={mode === 'thumb' ? 'coffre-reader-thumb-text' : 'coffre-reader-text'}>
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
