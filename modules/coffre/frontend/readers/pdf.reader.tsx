// PDF by pdf.js (pdfjs-dist, local and bundled; its worker is a file of the
// app, loaded from the app's own server). Loaded only when a PDF is shown.
// The thumbnail is the first page; the full reader draws the pages one after
// the other (20 first, then « Afficher la suite »).
import { useEffect, useRef, useState } from 'react';
import { Button } from '@hub/sdk/frontend';
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

async function drawPage(doc: PdfDocument, n: number, canvas: HTMLCanvasElement, width: number) {
  const page = await doc.getPage(n);
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
        if (live && canvas.current) await drawPage(doc, 1, canvas.current, 360);
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

const BATCH = 20;

function PdfFull({ source }: { source: ReaderSource }) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(BATCH);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let opened: PdfDocument | null = null;
    open(source)
      .then((d) => {
        opened = d;
        if (live) setDoc(d);
        else void d.loadingTask.destroy();
      })
      .catch((e: unknown) => live && setError(`PDF illisible : ${String(e)}`));
    return () => {
      live = false;
      if (opened) void opened.loadingTask.destroy();
    };
  }, [source]);
  useEffect(() => {
    if (!doc || !box.current) return;
    let live = true;
    const width = Math.min(980, box.current.clientWidth - 24);
    const canvases = [...box.current.querySelectorAll('canvas')];
    void (async () => {
      for (let i = 0; i < canvases.length && live; i++) {
        const c = canvases[i]!;
        if (c.dataset.drawn) continue;
        c.dataset.drawn = '1';
        await drawPage(doc, i + 1, c, width).catch(() => undefined);
      }
    })();
    return () => {
      live = false;
    };
  }, [doc, shown]);
  if (error) return <p className="coffre-reader-error">{error}</p>;
  if (!doc) return <p className="muted coffre-reader-wait">Ouverture du PDF…</p>;
  const count = Math.min(shown, doc.numPages);
  return (
    <div className="coffre-reader-pdf" ref={box}>
      {Array.from({ length: count }, (_, i) => (
        <canvas key={i} aria-label={`Page ${i + 1}`} />
      ))}
      {doc.numPages > count && (
        <Button variant="secondary" onClick={() => setShown((s) => s + BATCH)}>
          Afficher la suite ({doc.numPages - count} pages)
        </Button>
      )}
    </div>
  );
}

function PdfReader({ source, mode }: ReaderProps) {
  return mode === 'thumb' ? <PdfThumb source={source} /> : <PdfFull source={source} />;
}

registerReader({
  id: 'pdf',
  label: 'PDF',
  extensions: ['pdf'],
  maxBytes: 300_000_000,
  thumbMaxBytes: 60_000_000,
  component: PdfReader,
});
