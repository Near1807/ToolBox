// Markdown rendered by markdown-it WITHOUT the file's HTML (html: false: any
// tag is shown as text) and without images (no request to anywhere); a link
// is shown, never followed.
import { useMemo, type MouseEvent } from 'react';
import MarkdownIt from 'markdown-it';
import { registerReader, type ReaderProps } from './registry';
import { useSourceText } from './useSource';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.disable('image');

/** Safe HTML of a Markdown text (tested: no raw HTML, no image). */
export function renderMarkdown(text: string): string {
  return md.render(text);
}

const stopLinks = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('a')) e.preventDefault();
};

function MarkdownReader({ source, mode }: ReaderProps) {
  const { text, error } = useSourceText(source, mode === 'thumb' ? 1500 : undefined);
  const html = useMemo(() => (text === null ? null : renderMarkdown(text)), [text]);
  if (error) return <p className="coffre-reader-error">{error}</p>;
  if (html === null) return null;
  return (
    <div
      className={mode === 'thumb' ? 'coffre-reader-thumb-md' : 'coffre-reader-markdown'}
      onClick={stopLinks}
      // markdown-it with html: false escapes every tag of the file.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

registerReader({
  id: 'markdown',
  label: 'Markdown',
  extensions: ['md', 'markdown'],
  maxBytes: 5_000_000,
  thumbMaxBytes: 1_000_000,
  component: MarkdownReader,
});
