// PDF by pdf.js (pdfjs-dist, local and bundled; its worker is a file of the
// app, loaded from the app's own server). Loaded only when a PDF is shown.
// The thumbnail is the first page. v0.47.0: the full reader draws the pages
// that are seen (any page reachable at once: « aller à la page »), with their
// text layer (selectable; a search's words marked), a zoom, and a search in
// the document (each page's text read once, occurrences with ↑ ↓). Opened
// from a search: at its page, its words marked. The same reader in the
// preview and in the reading window.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon } from '@hub/sdk/frontend';
import { findWords, markWords, wordsOf } from './mark';
import { bytesOf, registerReader, type ReaderProps, type ReaderSource } from './registry';

type PdfJs = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

let loading: Promise<PdfJs> | null = null;
/** pdf.js, loaded once (its worker served by the app). */
function pdfjs(): Promise<PdfJs> {
  loading ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return lib;
  });
  return loading;
}

/** Thumbnails one at a time (a context with 200 PDF does not freeze the page). */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

async function open(source: ReaderSource): Promise<PdfDocument> {
  const lib = await pdfjs();
  const data = new Uint8Array(await bytesOf(source));
  // No script of the PDF ever runs, no XFA form; nothing fetched from outside.
  return lib.getDocument({ data, enableXfa: false, stopAtErrors: false }).promise;
}

async function drawThumb(doc: PdfDocument, canvas: HTMLCanvasElement, width: number) {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: (width / base.width) * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
}

function PdfThumb({ source }: { source: ReaderSource }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void inTurn(async () => {
      if (!live || !canvas.current) return;
      const doc = await open(source);
      try {
        if (live && canvas.current) await drawThumb(doc, canvas.current, 360);
      } finally {
        void doc.loadingTask.destroy();
      }
    }).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [source]);
  if (failed) return null;
  return <canvas ref={canvas} className="coffre-reader-thumb-pdf" />;
}

/** One page: drawn when it comes near the view, with its text layer. */
function PdfPage(props: {
  doc: PdfDocument;
  n: number;
  /** CSS width of the page (px). */
  width: number;
  /** Height / width of the first page (the size kept before it is drawn). */
  ratio: number;
  query: string;
  /** Called once its text layer holds the marks (the search's ↑ ↓). */
  onMarks: (n: number, marks: HTMLElement[]) => void;
}) {
  const { doc, n, width, query, onMarks } = props;
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [height, setHeight] = useState(width * props.ratio);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setNear(entries.some((e) => e.isIntersecting)),
      {
        rootMargin: '600px 0px',
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near || !box.current) return;
    const root = box.current;
    let live = true;
    let cancel: (() => void) | null = null;
    void (async () => {
      const lib = await pdfjs();
      const page = await doc.getPage(n);
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale });
      setHeight(viewport.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const task = page.render({
        canvas,
        viewport: page.getViewport({ scale: scale * dpr }),
      });
      cancel = () => task.cancel();
      await task.promise;
      if (!live) return;
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      const text = new lib.TextLayer({
        textContentSource: await page.getTextContent(),
        container: layer,
        viewport,
      });
      await text.render();
      if (!live) return;
      root.replaceChildren(canvas, layer);
      root.style.setProperty('--total-scale-factor', String(scale));
      onMarks(n, markWords(layer, query));
      page.cleanup();
    })().catch(() => undefined);
    return () => {
      live = false;
      cancel?.();
    };
  }, [near, doc, n, width, query, onMarks]);
  return (
    <div
      ref={box}
      className="coffre-reader-pdf__page"
      data-page={n}
      aria-label={`Page ${n}`}
      style={{ width, height }}
    />
  );
}

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
/** The zoom just below / above the one shown (in %). */
const smaller = (pct: number) => [...ZOOMS].reverse().find((z) => z * 100 < pct - 1) ?? ZOOMS[0]!;
const larger = (pct: number) => ZOOMS.find((z) => z * 100 > pct + 1) ?? ZOOMS[ZOOMS.length - 1]!;

function PdfFull({ source, locate, window: inWindow }: ReaderProps) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(860);
  /** null: fit the width; a number: that zoom of the page's width (1 = 100 %). */
  const [zoom, setZoom] = useState<number | null>(null);
  const [baseWidth, setBaseWidth] = useState(612);
  const [pageInput, setPageInput] = useState('1');
  const [query, setQuery] = useState(locate?.query ?? '');
  /** The pages holding the words, for the query they answer. */
  const [answer, setAnswer] = useState<{ query: string; pages: number[] } | null>(null);
  const [hit, setHit] = useState(0);
  const marks = useRef(new Map<number, HTMLElement[]>());

  useEffect(() => {
    let live = true;
    let opened: PdfDocument | null = null;
    open(source)
      .then(async (d) => {
        opened = d;
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        if (!live) return void d.loadingTask.destroy();
        setRatio(first.height / first.width);
        setBaseWidth(first.width);
        setDoc(d);
      })
      .catch((e: unknown) => live && setError(`PDF illisible : ${String(e)}`));
    return () => {
      live = false;
      if (opened) void opened.loadingTask.destroy();
    };
  }, [source]);

  // The width that fits (the window or the preview changes size).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(Math.max(240, el.clientWidth - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);
  const width = zoom === null ? Math.min(fit, inWindow ? 1400 : 980) : baseWidth * (96 / 72) * zoom;

  const goTo = useCallback((n: number, smooth = false) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    el?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Opened from a search: at its page.
  const started = useRef(false);
  useEffect(() => {
    if (!doc || started.current) return;
    started.current = true;
    const n = Math.min(Math.max(1, locate?.page ?? 1), doc.numPages);
    if (n > 1) requestAnimationFrame(() => goTo(n));
  }, [doc, locate?.page, goTo]);

  // The page shown (the one at the top of the view).
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 40;
      let n = 1;
      for (const p of el.querySelectorAll<HTMLElement>('[data-page]'))
        if (p.getBoundingClientRect().top <= top) n = Number(p.dataset.page);

      setPageInput(String(n));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [doc]);

  // The search in the document: each page's text read once.
  const texts = useRef<Promise<string[]> | null>(null);
  useEffect(() => {
    texts.current = null;
  }, [doc]);
  useEffect(() => {
    if (!doc) return;
    const words = wordsOf(query);
    if (!words.length) return;
    let live = true;
    const t = setTimeout(() => {
      texts.current ??= (async () => {
        const out: string[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const c = await (await doc.getPage(n)).getTextContent();
          out.push(c.items.map((i) => ('str' in i ? i.str : '')).join(' '));
        }
        return out;
      })();
      void texts.current.then((all) => {
        if (!live) return;
        const pages = all.flatMap((t, i) => (findWords(t, words).length ? [i + 1] : []));
        setAnswer({ query, pages });
        const start = locate?.page && pages.includes(locate.page) ? pages.indexOf(locate.page) : 0;
        setHit(start);
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [doc, query, locate?.page]);

  const found = wordsOf(query).length && answer?.query === query ? answer.pages : null;
  const onMarks = useCallback((n: number, list: HTMLElement[]) => {
    marks.current.set(n, list);
  }, []);
  const showHit = (i: number) => {
    if (!found?.length) return;
    const k = (i + found.length) % found.length;
    setHit(k);
    const n = found[k]!;
    goTo(n, true);
    setTimeout(() => {
      for (const m of document.querySelectorAll('.coffre-hit--current'))
        m.classList.remove('coffre-hit--current');
      const first = marks.current.get(n)?.[0];
      first?.classList.add('coffre-hit--current');
      first?.scrollIntoView({ block: 'center' });
    }, 350);
  };

  const pages = useMemo(
    () => (doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : []),
    [doc],
  );
  if (error) return <p className="coffre-reader-error">{error}</p>;
  if (!doc) return <p className="muted coffre-reader-wait">Ouverture du PDF…</p>;
  const shownZoom = Math.round((width / (baseWidth * (96 / 72))) * 100);
  return (
    <div className="coffre-reader-pdf-wrap">
      <div className="coffre-reader-pdf__tools" role="toolbar" aria-label="Outils du PDF">
        <form
          className="coffre-reader-pdf__goto"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.min(Math.max(1, Number(pageInput) || 1), doc.numPages);
            goTo(n);
          }}
        >
          <input
            className="input"
            inputMode="numeric"
            aria-label="Aller à la page"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
          />
          <span className="muted">/ {doc.numPages}</span>
        </form>
        <span className="coffre-reader-pdf__zoom">
          <button
            type="button"
            className="icon-button"
            aria-label="Réduire"
            title="Réduire"
            onClick={() => setZoom(smaller(shownZoom))}
          >
            −
          </button>
          <span className="coffre-reader-pdf__pct" aria-live="polite">
            {shownZoom} %
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Agrandir"
            title="Agrandir"
            onClick={() => setZoom(larger(shownZoom))}
          >
            +
          </button>
          <Button variant="secondary" onClick={() => setZoom(null)} disabled={zoom === null}>
            Ajuster
          </Button>
        </span>
        <span className="coffre-reader-pdf__find">
          <Icon name="search" />
          <input
            className="input"
            type="search"
            placeholder="Chercher dans le document"
            aria-label="Chercher dans le document"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                showHit(hit + (e.shiftKey ? -1 : 1));
              }
            }}
          />
          {found !== null && (
            <>
              <span className="muted coffre-reader-pdf__count">
                {found.length
                  ? `page ${found[hit] ?? found[0]} · ${hit + 1} / ${found.length} page${found.length > 1 ? 's' : ''}`
                  : 'aucune page'}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Page précédente avec ce mot"
                disabled={!found.length}
                onClick={() => showHit(hit - 1)}
              >
                <Icon name="arrow-up" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Page suivante avec ce mot"
                disabled={!found.length}
                onClick={() => showHit(hit + 1)}
              >
                <Icon name="arrow-down" />
              </button>
            </>
          )}
        </span>
      </div>
      <div className="coffre-reader-pdf" ref={scroller}>
        {pages.map((n) => (
          <PdfPage
            key={n}
            doc={doc}
            n={n}
            width={width}
            ratio={ratio}
            query={query}
            onMarks={onMarks}
          />
        ))}
      </div>
    </div>
  );
}

function PdfReader(props: ReaderProps) {
  return props.mode === 'thumb' ? <PdfThumb source={props.source} /> : <PdfFull {...props} />;
}

registerReader({
  id: 'pdf',
  label: 'PDF',
  extensions: ['pdf'],
  maxBytes: 300_000_000,
  thumbMaxBytes: 60_000_000,
  component: PdfReader,
});
