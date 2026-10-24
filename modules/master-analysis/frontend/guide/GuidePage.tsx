// The guide of « Analyse du master »: a separate page, opened only on demand
// (« Guide » button, « ? » next to a graph or a measure → ?s=<section>).
// Table of contents, search, annotated captures of the real interface.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Page, useModule } from '@hub/sdk/frontend';
import { GUIDE, fold, searchGuide, type Block, type GuideSection } from './content';
import shots from './shots.json';

const IMAGES = import.meta.glob<string>('./img/*.jpg', { eager: true, import: 'default' });

interface Shot {
  file: string;
  width: number;
  height: number;
  /** Boxes of the marks, in % of the capture. */
  marks: Record<string, { x: number; y: number; w: number; h: number }>;
}

export function GuidePage() {
  const module = useModule();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const target = params.get('s');
  const results = useMemo(() => searchGuide(query), [query]);
  const words = useMemo(() => fold(query).split(/\s+/).filter(Boolean), [query]);
  const open = (id: string) => {
    setQuery('');
    setParams({ s: id });
  };

  // A new search starts at the top of the results.
  useEffect(() => {
    if (query) document.querySelector('.ma-guide')?.scrollIntoView({ block: 'start' });
  }, [query]);
  useEffect(() => {
    if (!target || query) return;
    const el = document.getElementById(`guide-${target}`);
    el?.scrollIntoView({ block: 'start' });
  }, [target, query]);

  const shown: { title: string; sections: GuideSection[] }[] = query
    ? GUIDE.map((chapter) => ({
        title: chapter.title,
        sections: results.filter((r) => r.chapter.id === chapter.id).map((r) => r.section),
      })).filter((c) => c.sections.length > 0)
    : GUIDE;

  return (
    <Page
      title="Guide — Analyse du master"
      subtitle="Comment lire chaque vue, chaque mesure et chaque graphe. L’analyse reste purement informative."
      actions={
        <Button variant="secondary" onClick={() => navigate(module.path())}>
          Retour à l’analyse
        </Button>
      }
    >
      <div className="ma-guide">
        <nav className="ma-guide__toc" aria-label="Sommaire du guide">
          <input
            className="input"
            type="search"
            placeholder="Rechercher (ex. PLR, mono, drop)"
            aria-label="Rechercher dans le guide"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <p className="small muted" role="status">
              {results.length === 0
                ? 'Aucun résultat.'
                : `${results.length} partie${results.length > 1 ? 's' : ''} trouvée${results.length > 1 ? 's' : ''}.`}
            </p>
          )}
          {GUIDE.map((chapter) => (
            <div key={chapter.id}>
              <strong className="small">{chapter.title}</strong>
              <ul>
                {chapter.sections.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`ma-link small${target === s.id ? ' ma-guide__current' : ''}`}
                      onClick={() => open(s.id)}
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="ma-guide__content">
          {shown.map((chapter) => (
            <section key={chapter.title}>
              <h2>{chapter.title}</h2>
              {chapter.sections.map((s) => (
                <article
                  key={s.id}
                  id={`guide-${s.id}`}
                  className={`card ma-guide__section${target === s.id && !query ? ' ma-guide__section--target' : ''}`}
                >
                  <h3>{highlight(s.title, words)}</h3>
                  {s.blocks.map((block, i) => (
                    <Fragment key={i}>{renderBlock(block, words, open)}</Fragment>
                  ))}
                </article>
              ))}
            </section>
          ))}
        </div>
      </div>
    </Page>
  );
}

function renderBlock(block: Block, words: string[], open: (id: string) => void): ReactNode {
  const text = (s: string) => inline(s, words, open);
  if (typeof block === 'string') return <p>{text(block)}</p>;
  if ('list' in block)
    return (
      <ul>
        {block.list.map((item, i) => (
          <li key={i}>{text(item)}</li>
        ))}
      </ul>
    );
  if ('steps' in block)
    return (
      <ol>
        {block.steps.map((item, i) => (
          <li key={i}>{text(item)}</li>
        ))}
      </ol>
    );
  if ('terms' in block)
    return (
      <dl className="ma-guide__terms">
        {block.terms.map(([term, definition]) => (
          <Fragment key={term}>
            <dt>{highlight(term, words)}</dt>
            <dd>{text(definition)}</dd>
          </Fragment>
        ))}
      </dl>
    );
  if ('note' in block) return <p className="ma-guide__note small">{text(block.note)}</p>;
  return <Capture block={block} words={words} />;
}

/** A capture of the interface with numbered boxes, and the legend of the numbers. */
function Capture(props: { block: Extract<Block, { shot: string }>; words: string[] }) {
  const shot = (shots as Record<string, Shot>)[props.block.shot];
  const src = shot ? IMAGES[`./img/${shot.file}`] : undefined;
  return (
    <figure className="ma-guide__shot">
      {shot && src ? (
        <div className="ma-guide__frame">
          <img src={src} alt={props.block.caption} width={shot.width} height={shot.height} />
          {props.block.marks.map((m, i) => {
            const box = shot.marks[m.id];
            if (!box) return null;
            return (
              <span
                key={m.id}
                className="ma-guide__mark"
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.w}%`,
                  height: `${box.h}%`,
                }}
              >
                <b>{i + 1}</b>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="small muted">(Capture indisponible.)</p>
      )}
      <figcaption>
        <span className="small muted">{highlight(props.block.caption, props.words)}</span>
        <ol className="ma-guide__legend small">
          {props.block.marks.map((m) => (
            <li key={m.id}>{highlight(m.label, props.words)}</li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}

/** **bold** and [[id|text]] links, with the searched words marked. */
function inline(text: string, words: string[], open: (id: string) => void): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('**'))
      return <strong key={i}>{inline(part.slice(2, -2), words, open)}</strong>;
    const link = /^\[\[([^|\]]+)\|([^\]]+)\]\]$/.exec(part);
    if (link)
      return (
        <Link
          key={i}
          to={`?s=${link[1]}`}
          onClick={(e) => {
            e.preventDefault();
            open(link[1]!);
          }}
        >
          {highlight(link[2]!, words)}
        </Link>
      );
    return <Fragment key={i}>{highlight(part, words)}</Fragment>;
  });
}

/** Marks the searched words (accents and case ignored). */
function highlight(text: string, words: string[]): ReactNode {
  if (!words.length) return text;
  const folded = fold(text);
  const ranges: [number, number][] = [];
  for (const w of words) {
    let at = folded.indexOf(w);
    while (at >= 0) {
      ranges.push([at, at + w.length]);
      at = folded.indexOf(w, at + w.length);
    }
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last) continue;
    out.push(text.slice(last, start), <mark key={start}>{text.slice(start, end)}</mark>);
    last = end;
  }
  out.push(text.slice(last));
  return out;
}
