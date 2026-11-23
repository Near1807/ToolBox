import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { openReaderWindow, readerWindowCount, closeReaderWindows } from './reader-windows';
import { TOKEN_HEADER } from '../backend/core/security';
import type { SystemInfo } from '../backend/server';

export interface SmokeTestResult {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
  system?: SystemInfo;
}

/**
 * Self-check run by CI against the packaged app (`ToolBox.exe --smoke-test=<file>`):
 * proves that the backend, SQLite, FFmpeg/ffprobe, canvas and the UI bundle all work
 * outside dev mode. Writes the result as JSON, then the caller exits.
 */
export async function runSmokeTest(
  outputFile: string,
  apiUrl: string,
  token: string,
  window: BrowserWindow,
  uiLoaded: Promise<void>,
): Promise<boolean> {
  const result: SmokeTestResult = { ok: false, checks: {} };
  const check = (name: string, ok: boolean, detail?: string) => {
    result.checks[name] = { ok, detail };
  };

  try {
    const health = await fetch(`${apiUrl}/api/health`);
    check('api-health', health.ok, `HTTP ${health.status}`);

    const denied = await fetch(`${apiUrl}/api/core/system`);
    check('api-requires-token', denied.status === 401, `HTTP ${denied.status}`);

    const response = await fetch(`${apiUrl}/api/core/system`, {
      headers: { [TOKEN_HEADER]: token },
    });
    const system = (await response.json()) as SystemInfo;
    result.system = system;
    check('sqlite', Boolean(system.sqliteVersion), system.sqliteVersion);
    check('ffmpeg', system.ffmpegVersion !== null, system.ffmpegVersion ?? 'introuvable');
    check('ffprobe', system.ffprobeVersion !== null, system.ffprobeVersion ?? 'introuvable');

    // Canvas (Reels drawn frame by frame): the native binary loads and draws.
    try {
      const { createCanvas } = await import('@napi-rs/canvas');
      const canvas = createCanvas(4, 4);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgb(200, 100, 50)';
      ctx.fillRect(0, 0, 4, 4);
      const pixel = [...canvas.data().subarray(0, 3)].join(',');
      check('canvas', pixel === '200,100,50', `pixel=${pixel}`);
    } catch (error) {
      check('canvas', false, String(error));
    }

    // onnxruntime-web (model of the voice commands): its WebAssembly is found
    // in the packaged app. A tiny Identity model, no download needed.
    try {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(
        Buffer.from(
          'CAg6RgoQCgF4EgF5IghJZGVudGl0eRIIaWRlbnRpdHlaEwoBeBIOCgwIARIICgIIAQoCCAJiEwoBeRIOCgwIARIICgIIAQoCCAJCBAoAEA0=',
          'base64',
        ),
      );
      const out = await session.run({
        x: new ort.Tensor('float32', Float32Array.from([1, 2]), [1, 2]),
      });
      const values = Array.from(out.y!.data as Float32Array).join(',');
      check('onnxruntime', values === '1,2', `sortie=${values}`);
    } catch (error) {
      check('onnxruntime', false, String(error));
    }

    // Module system end to end with the example module (migration, routes, settings).
    const authed = { [TOKEN_HEADER]: token, 'content-type': 'application/json' };
    const modules = (await (
      await fetch(`${apiUrl}/api/core/modules`, { headers: authed })
    ).json()) as { id: string; status: string; error?: string }[];
    const template = modules.find((m) => m.id === 'template');
    check(
      'module-loaded',
      template?.status === 'loaded',
      template?.error ?? template?.status ?? 'absent',
    );
    // Every bundled module must load in the packaged app (assets unpacked, dependencies met…).
    const broken = modules.filter((m) => m.status !== 'loaded');
    check(
      'all-modules-loaded',
      broken.length === 0,
      broken.length === 0
        ? `${modules.length} module(s)`
        : broken.map((m) => `${m.id}: ${m.error ?? m.status}`).join(' ; '),
    );
    const created = await fetch(`${apiUrl}/api/modules/template/notes`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ text: 'smoke test' }),
    });
    check('module-route', created.ok, `HTTP ${created.status}`);

    // v0.47.0: pdf.js's Node build is found in the packaged app (unpacked from the asar):
    // a PDF put in the Coffre is found by a word of its page 2.
    try {
      const dir = mkdtempSync(path.join(tmpdir(), 'toolbox-smoke-'));
      const pdf = path.join(dir, 'smoke.pdf');
      writeFileSync(pdf, tinyPdf(['Page un', 'Le mot fusibleSmoke est ici']));
      const deposit = await fetch(`${apiUrl}/api/modules/coffre/deposit/apply`, {
        method: 'POST',
        headers: authed,
        body: JSON.stringify({ entries: [{ path: pdf, newContext: ['Smoke'], attributes: [] }] }),
      });
      let found = '';
      for (let i = 0; i < 60 && deposit.ok && !found; i++) {
        const r = (await (
          await fetch(`${apiUrl}/api/modules/coffre/search?q=fusiblesmoke`, { headers: authed })
        ).json()) as { results: { hits: { part: string }[] }[] };
        found = r.results[0]?.hits[0]?.part ?? '';
        if (!found) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      check(
        'pdf-text',
        found === '2',
        deposit.ok ? `page=${found || 'introuvable'}` : `HTTP ${deposit.status}`,
      );
    } catch (error) {
      check('pdf-text', false, String(error));
    }

    await uiLoaded;
    // v0.47.0: a reading window opens (a module's page alone).
    try {
      openReaderWindow('/m/template/', 'Smoke');
      const opened = readerWindowCount();
      closeReaderWindows();
      check('reader-window', opened === 1, `fenêtres=${opened}`);
    } catch (error) {
      check('reader-window', false, String(error));
    }
    const title = (await window.webContents.executeJavaScript('document.title')) as string;
    check('ui-loaded', title === 'ToolBox', `title="${title}"`);
  } catch (error) {
    check('exception', false, String(error));
  }

  result.ok = Object.values(result.checks).every((c) => c.ok);
  writeFileSync(outputFile, JSON.stringify(result, null, 2));
  return result.ok;
}

/** A PDF whose pages hold these lines (Helvetica), for the pdf-text check. */
function tinyPdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const add = (o: string) => objs.push(o);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + pages.length * 2 + 1;
  const kids: number[] = [];
  for (const text of pages) {
    const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`,
      ),
    );
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
