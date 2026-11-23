// An HTML page, ISOLATED: in a frame with sandbox="" (no script, no form, no
// pop-up, an origin of its own) and a policy that allows no request at all
// (default-src 'none': no image, no style sheet, no font from anywhere).
import { useMemo } from 'react';
import { registerReader, type ReaderProps } from './registry';
import { useSourceText } from './useSource';

/** The policy put first in the page: nothing can be loaded, nothing can run. */
export const ISOLATED_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

/** The page as shown: its text after a policy that forbids every request and script. */
export function isolatedDocument(html: string): string {
  // A page without its own background reads as in a browser (light canvas), whatever the theme.
  return `<meta http-equiv="Content-Security-Policy" content="${ISOLATED_CSP}">\n<meta charset="utf-8">\n<meta name="color-scheme" content="light">\n<style>html{background:Canvas;color:CanvasText}</style>\n${html}`;
}

/** The frame itself: no script, no form, no pop-up, an origin of its own. */
export function IsolatedFrame(props: { doc: string; title: string; thumb?: boolean }) {
  return (
    <iframe
      className={props.thumb ? 'coffre-reader-thumb-frame' : 'coffre-reader-frame'}
      title={props.title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={props.doc}
      tabIndex={props.thumb ? -1 : 0}
    />
  );
}

function HtmlReader({ source, mode }: ReaderProps) {
  const { text, error } = useSourceText(source);
  const doc = useMemo(() => (text === null ? null : isolatedDocument(text)), [text]);
  if (error) return <p className="coffre-reader-error">{error}</p>;
  if (doc === null) return null;
  return <IsolatedFrame doc={doc} title={source.name} thumb={mode === 'thumb'} />;
}

registerReader({
  id: 'html',
  label: 'Page web (isolée)',
  extensions: ['html', 'htm'],
  maxBytes: 10_000_000,
  thumbMaxBytes: 1_000_000,
  component: HtmlReader,
});
