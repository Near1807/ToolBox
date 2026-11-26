// v0.47.0 (Expérimental): the text of an element, for the search in the
// content (ADR 0056). Read only: the file is opened, never written. PDF: one
// part per page (its number); Word / PowerPoint / Excel (.docx, .pptx, .xlsx):
// the XML of the zip (fflate), one part per slide for a presentation; HTML:
// the text only (no script, no style); Markdown, text and code: as they are.
// A project: its text files, one part per file (its relative path). A PDF
// without any text (a scan): « pas de texte » — no OCR.
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { strFromU8, Unzip, UnzipInflate } from 'fflate';
import { extOf, languageOfExt } from '../shared/kinds';
import { listFiles } from './copy';

export interface TextPart {
  /** « 3 » (a PDF's page, a slide), « src/main.c » (a project's file), or « ». */
  part: string;
  text: string;
}
export type ExtractStatus =
  | 'ok'
  | 'notext'
  | 'unsupported'
  | 'toobig'
  | 'error'
  /** v0.47.1: longer than the maximum time: read again at the next start. */
  | 'toolong';
export interface Extracted {
  status: ExtractStatus;
  parts: TextPart[];
  /** Why it failed (an unreadable file), for the logs. */
  error?: string;
}

const TEXT_EXTS = new Set(['txt', 'log', 'md', 'markdown', 'csv', 'tsv', 'ini', 'cfg', 'rst']);
const HTML_EXTS = new Set(['html', 'htm', 'xhtml']);
const OFFICE_EXTS = new Set(['docx', 'pptx', 'xlsx', 'xlsm']);
/** Larger text files are not read (a log of 2 Go says nothing useful). */
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_BINARY_BYTES = 300 * 1024 * 1024;
/** A project: at most this many files read, each at most 1 Mo. */
const MAX_PROJECT_FILES = 2000;
const MAX_PROJECT_FILE_BYTES = 1024 * 1024;
/** What is kept of one part (the index stays small). */
const MAX_PART_CHARS = 400_000;

/** Is this extension read for the search? */
export function readable(ext: string): boolean {
  const e = ext.toLowerCase();
  return (
    e === 'pdf' ||
    TEXT_EXTS.has(e) ||
    HTML_EXTS.has(e) ||
    OFFICE_EXTS.has(e) ||
    languageOfExt(e) !== null
  );
}

/** Lets the PC breathe between two pieces of work (low priority). */
export const yieldNow = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

const clip = (s: string) => (s.length > MAX_PART_CHARS ? s.slice(0, MAX_PART_CHARS) : s);
const squeeze = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** UTF-8 (with or without BOM), UTF-16 with a BOM, else Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  iuml: 'ï',
  euml: 'ë',
  Eacute: 'É',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  hellip: '…',
  ndash: '–',
  mdash: '—',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e] ?? all;
  });
}

/** The text of an HTML page: no script, style, comment nor tag. */
export function htmlText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return squeeze(decodeEntities(body));
}

/**
 * v0.47.1: limits of an Office file's DECOMPRESSED content (a small .docx may
 * unfold to gigabytes: a « zip bomb »). Beyond: « illisible : trop gros ».
 */
export const ZIP_LIMITS = {
  /** All the parts read, together. */
  totalBytes: 100 * 1024 * 1024,
  /** One part. */
  entryBytes: 100 * 1024 * 1024,
  /** Entries in the archive (read or not). */
  entries: 10_000,
};

/** Too large once decompressed (see ZIP_LIMITS): nothing else is read. */
export class TooBig extends Error {
  constructor(what: string) {
    super(`illisible : trop gros (${what})`);
  }
}

/**
 * v0.47.1: the parts of a zip whose name `want` accepts, decompressed in small
 * steps and counted as they come: it stops as soon as a limit is passed
 * (never the whole content in memory first).
 */
export function unzipBounded(
  bytes: Uint8Array,
  want: (name: string) => boolean,
  limits = ZIP_LIMITS,
): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let entries = 0;
  let total = 0;
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    if (failure) return;
    if (++entries > limits.entries) {
      failure = new TooBig(`plus de ${limits.entries} parties`);
      return;
    }
    if (!want(file.name)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) {
        failure = error;
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > limits.entryBytes)
        failure = new TooBig(`« ${file.name} » dépasse ${limits.entryBytes} octets`);
      else if (total > limits.totalBytes)
        failure = new TooBig(`plus de ${limits.totalBytes} octets en tout`);
      if (failure) {
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        const whole = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          whole.set(c, at);
          at += c.length;
        }
        out[file.name] = whole;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const STEP = 64 * 1024;
  for (let at = 0; at < bytes.length && !failure; at += STEP)
    unzip.push(bytes.subarray(at, Math.min(bytes.length, at + STEP)), at + STEP >= bytes.length);
  if (failure) throw failure;
  return out;
}

/** The text runs of an Office XML part (`w:t`, `a:t`, `t`), paragraphs on their own lines. */
function xmlRuns(xml: string, run: string, paragraph: string): string {
  const out: string[] = [];
  const re = new RegExp(
    `<(${run})(?:\\s[^>]*)?>([^<]*)</\\1>|</${paragraph}>|<(?:w:tab|w:br)\\b[^>]*/>`,
    'g',
  );
  for (const m of xml.matchAll(re)) {
    if (m[2] !== undefined) out.push(decodeEntities(m[2]));
    else if (m[0].startsWith('</')) out.push('\n');
    else out.push(' ');
  }
  return squeeze(out.join(''));
}

/** Word, PowerPoint (one part per slide), Excel (the cells' texts). */
export function officeText(bytes: Uint8Array, ext: string): TextPart[] {
  const want = (name: string) =>
    ext === 'docx'
      ? /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name)
      : ext === 'pptx'
        ? /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(name)
        : /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name);
  const files = unzipBounded(bytes, want);
  const num = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  if (ext === 'docx') {
    const order = [
      'word/document.xml',
      ...Object.keys(files)
        .filter((n) => n !== 'word/document.xml')
        .sort(),
    ];
    const text = order
      .filter((n) => files[n])
      .map((n) => xmlRuns(strFromU8(files[n]!), 'w:t', 'w:p'))
      .filter(Boolean)
      .join('\n\n');
    return text ? [{ part: '', text }] : [];
  }
  if (ext === 'pptx') {
    const bySlide = new Map<number, string[]>();
    for (const [name, data] of Object.entries(files)) {
      const t = xmlRuns(strFromU8(data), 'a:t', 'a:p');
      if (t) bySlide.set(num(name), [...(bySlide.get(num(name)) ?? []), t]);
    }
    return [...bySlide.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, list]) => ({ part: String(n), text: list.join('\n') }));
  }
  // Excel: the shared strings and the inline ones (numbers say little to a search).
  const texts: string[] = [];
  if (files['xl/sharedStrings.xml'])
    texts.push(xmlRuns(strFromU8(files['xl/sharedStrings.xml']), 't', 'si'));
  for (const [name, data] of Object.entries(files))
    if (name.startsWith('xl/worksheets/')) {
      const t = xmlRuns(strFromU8(data), 't', 'is');
      if (t) texts.push(t);
    }
  const text = texts.filter(Boolean).join('\n');
  return text ? [{ part: '', text }] : [];
}

// --- PDF (pdf.js, the same library as the reader) -------------------------------------

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}
interface PdfJs {
  getDocument(src: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: PdfTextItem[] }>;
        cleanup(): void;
      }>;
    }>;
    destroy(): Promise<void>;
  };
}
let pdfjs: Promise<PdfJs> | null = null;
/**
 * pdf.js's Node build (an ES module): copied next to the bundle by the build
 * (build/main/pdfjs/, unpacked from app.asar), else node_modules (dev, tests).
 */
let pdfjsOverride: string | null = null;
/** v0.47.1: the worker is told where pdf.js is (found by the main thread). */
export function setPdfjsFile(file: string): void {
  pdfjsOverride = file;
}
export function pdfjsFile(): string {
  if (pdfjsOverride) return pdfjsOverride;
  const built = path
    .join(__dirname, 'pdfjs', 'pdf.mjs')
    .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (existsSync(built)) return built;
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw new Error('pdf.js introuvable');
  }
}
// Loaded by Node itself (require of an ES module, Node 22+): neither esbuild (CommonJS
// bundle) nor the tests' loader touch it.
const nodeRequire = createRequire(__filename);
const loadPdfjs = () => (pdfjs ??= Promise.resolve().then(() => nodeRequire(pdfjsFile()) as PdfJs));

export async function pdfText(
  bytes: Uint8Array,
  signal?: { stopped: boolean },
): Promise<TextPart[]> {
  const lib = await loadPdfjs();
  // v0.47.1: no code is ever built from the PDF's data — pdf.js 6 has no eval
  // path at all (its option `isEvalSupported` is gone; checked by pdf-no-eval.test.ts).
  const task = lib.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const parts: TextPart[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (signal?.stopped) throw new Error('interrompu');
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = squeeze(
        content.items.map((i) => (i.str ?? '') + (i.hasEOL ? '\n' : '')).join(''),
      );
      page.cleanup();
      parts.push({ part: String(n), text: clip(text) });
      // Low priority: the PC breathes between two pages.
      await yieldNow();
    }
    return parts;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** The text of one file (by its extension). */
export async function extractFile(
  file: string,
  ext = extOf(file),
  signal?: { stopped: boolean },
): Promise<Extracted> {
  const e = ext.toLowerCase();
  if (!readable(e)) return { status: 'unsupported', parts: [] };
  const s = await stat(file);
  const binary = e === 'pdf' || OFFICE_EXTS.has(e);
  if (s.size > (binary ? MAX_BINARY_BYTES : MAX_TEXT_BYTES)) return { status: 'toobig', parts: [] };
  try {
    const bytes = new Uint8Array(await readFile(file));
    let parts: TextPart[];
    if (e === 'pdf') {
      parts = await pdfText(bytes, signal);
      // A scan: pages without any text.
      if (!parts.some((p) => p.text.trim())) return { status: 'notext', parts: [] };
      parts = parts.filter((p) => p.text.trim());
    } else if (OFFICE_EXTS.has(e)) parts = officeText(bytes, e === 'xlsm' ? 'xlsx' : e);
    else if (HTML_EXTS.has(e)) parts = [{ part: '', text: htmlText(decodeText(bytes)) }];
    else parts = [{ part: '', text: squeeze(decodeText(bytes)) }];
    parts = parts.map((p) => ({ ...p, text: clip(p.text) })).filter((p) => p.text);
    return { status: parts.length ? 'ok' : 'notext', parts };
  } catch (error) {
    if (signal?.stopped) throw error;
    // v0.47.1: an archive that unfolds too much: « illisible : trop gros », nothing else.
    if (error instanceof TooBig) return { status: 'toobig', parts: [], error: error.message };
    return { status: 'error', parts: [], error: String(error) };
  }
}

/** A project (a folder): its text files, one part per file. */
export async function extractProject(
  dir: string,
  signal?: { stopped: boolean },
): Promise<Extracted> {
  const parts: TextPart[] = [];
  let read = 0;
  for (const rel of listFiles(dir)) {
    if (signal?.stopped) throw new Error('interrompu');
    const ext = extOf(rel);
    if (ext === 'pdf' || OFFICE_EXTS.has(ext) || !readable(ext)) continue;
    if (/(^|\/)(node_modules|\.git|dist|build|target|__pycache__|\.venv)\//.test(rel)) continue;
    const file = path.join(dir, ...rel.split('/'));
    const s = await stat(file).catch(() => null);
    if (!s || s.size > MAX_PROJECT_FILE_BYTES) continue;
    const r = await extractFile(file, ext, signal);
    for (const p of r.parts) parts.push({ part: rel, text: p.text });
    if (++read >= MAX_PROJECT_FILES) break;
    if (read % 20 === 0) await yieldNow();
  }
  return { status: parts.length ? 'ok' : 'notext', parts };
}
