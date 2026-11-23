// Markdown rendered by markdown-it WITHOUT the file's HTML (html: false: any
// tag is shown as text) and without images (no request to anywhere); a link
// is shown, never followed.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import MarkdownIt from 'markdown-it';
import { useMarks } from './mark';
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

interface Heading {
  level: number;
  text: string;
  el: HTMLElement;
}

function MarkdownReader({ source, mode, locate, window: inWindow }: ReaderProps) {
  const { text, error } = useSourceText(source, mode === 'thumb' ? 1500 : undefined);
  const html = useMemo(() => (text === null ? null : renderMarkdown(text)), [text]);
  const box = useRef<HTMLDivElement>(null);
  useMarks(box, mode === 'full' ? locate?.query : null, html);
  // v0.47.0: the table of contents (reading window): the headings of the page.
  const [toc, setToc] = useState<Heading[]>([]);
  useEffect(() => {
    if (!inWindow || !box.current) return setToc([]);
    setToc(
      [...box.current.querySelectorAll<HTMLElement>('h1, h2, h3')].map((el) => ({
        level: Number(el.tagName[1]),
        text: el.textContent ?? '',
        el,
      })),
    );
  }, [html, inWindow]);
  if (error) return <p className="coffre-reader-error">{error}</p>;
  if (html === null) return null;
  const page = (
    <div
      ref={box}
      className={mode === 'thumb' ? 'coffre-reader-thumb-md' : 'coffre-reader-markdown'}
      onClick={stopLinks}
      // markdown-it with html: false escapes every tag of the file.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
  if (!inWindow || toc.length < 2) return page;
  return (
    <div className="coffre-reader-md-layout">
      <nav className="coffre-reader-toc" aria-label="Sommaire">
        <strong className="coffre-reader-toc__title">Sommaire</strong>
        {toc.map((h, i) => (
          <button
            key={i}
            type="button"
            className={`coffre-reader-toc__item coffre-reader-toc__item--${h.level}`}
            onClick={() => h.el.scrollIntoView({ block: 'start', behavior: 'smooth' })}
          >
            {h.text}
          </button>
        ))}
      </nav>
      {page}
    </div>
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
