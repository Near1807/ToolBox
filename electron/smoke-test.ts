import { writeFileSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
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

    await uiLoaded;
    const title = (await window.webContents.executeJavaScript('document.title')) as string;
    check('ui-loaded', title === 'ToolBox', `title="${title}"`);
  } catch (error) {
    check('exception', false, String(error));
  }

  result.ok = Object.values(result.checks).every((c) => c.ok);
  writeFileSync(outputFile, JSON.stringify(result, null, 2));
  return result.ok;
}
