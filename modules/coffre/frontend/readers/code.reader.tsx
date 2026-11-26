// Code, coloured by highlight.js (local, bundled): only the languages below
// are loaded. highlight.js escapes the text itself: its output holds only its
// own <span class="hljs-…"> (no HTML of the file ever reaches the page).
import { useEffect, useMemo, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import lua from 'highlight.js/lib/languages/lua';
import matlab from 'highlight.js/lib/languages/matlab';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import verilog from 'highlight.js/lib/languages/verilog';
import vhdl from 'highlight.js/lib/languages/vhdl';
import xml from 'highlight.js/lib/languages/xml';
import x86asm from 'highlight.js/lib/languages/x86asm';
import yaml from 'highlight.js/lib/languages/yaml';
import dos from 'highlight.js/lib/languages/dos';
import julia from 'highlight.js/lib/languages/julia';
import { useMarks } from './mark';
import { registerReader, type ReaderProps } from './registry';
import { useSourceText } from './useSource';

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  latex,
  lua,
  matlab,
  php,
  powershell,
  python,
  r,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  verilog,
  vhdl,
  xml,
  x86asm,
  yaml,
  dos,
  julia,
};
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

/** Extension → highlight.js language. */
export const HLJS_OF_EXT: Record<string, string> = {
  py: 'python',
  pyw: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  go: 'go',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  lua: 'lua',
  r: 'r',
  m: 'matlab',
  jl: 'julia',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  bat: 'dos',
  cmd: 'dos',
  css: 'css',
  scss: 'css',
  vhd: 'vhdl',
  vhdl: 'vhdl',
  v: 'verilog',
  asm: 'x86asm',
  s: 'x86asm',
  tex: 'latex',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  svg: 'xml',
};

const THUMB_LINES = 18;

/** The coloured HTML of a text (escaped by highlight.js), or null when it cannot. */
export function highlight(text: string, ext: string): string | null {
  const language = HLJS_OF_EXT[ext];
  if (!language) return null;
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

function CodeReader({ source, mode, locate }: ReaderProps) {
  const { text, error } = useSourceText(source, mode === 'thumb' ? 4000 : undefined);
  const shown = useMemo(
    () =>
      text === null
        ? null
        : mode === 'thumb'
          ? text.split('\n').slice(0, THUMB_LINES).join('\n')
          : text,
    [text, mode],
  );
  const html = useMemo(
    () => (shown === null ? null : highlight(shown, source.ext)),
    [shown, source.ext],
  );
  const box = useRef<HTMLPreElement>(null);
  useMarks(box, mode === 'full' ? locate?.query : null, html ?? shown);
  // v0.47.0: the line numbers (a column beside, the text itself is never cut).
  const lines = useMemo(
    () => (mode === 'full' && shown !== null ? shown.split('\n').length : 0),
    [shown, mode],
  );
  // v0.51.0: opened at a line (a search result): that line brought into view.
  const wanted = mode === 'full' ? (locate?.line ?? null) : null;
  useEffect(() => {
    const pre = box.current;
    if (!wanted || !pre || !lines) return;
    const lineHeight = pre.scrollHeight / lines;
    let scroller: HTMLElement | null = pre.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight)
      scroller = scroller.parentElement;
    scroller?.scrollTo({ top: Math.max(0, (wanted - 3) * lineHeight) });
  }, [wanted, lines, html]);
  if (error) return <p className="coffre-reader-error">{error}</p>;
  if (shown === null) return null;
  const className = `hljs ${mode === 'thumb' ? 'coffre-reader-thumb-text' : 'coffre-reader-code'}`;
  const code =
    html === null ? (
      <pre ref={box} className={className}>
        {shown}
      </pre>
    ) : (
      // highlight.js escaped the text: only its own spans are HTML.
      <pre ref={box} className={className} dangerouslySetInnerHTML={{ __html: html }} />
    );
  if (mode === 'thumb') return code;
  return (
    <div className="coffre-reader-lines">
      <pre className="coffre-reader-lines__numbers hljs" aria-hidden>
        {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
      </pre>
      {code}
    </div>
  );
}

registerReader({
  id: 'code',
  label: 'Code',
  extensions: Object.keys(HLJS_OF_EXT).filter((e) => e !== 'svg'),
  maxBytes: 5_000_000,
  thumbMaxBytes: 1_000_000,
  component: CodeReader,
});
