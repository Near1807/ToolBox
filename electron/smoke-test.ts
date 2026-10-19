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
 * proves that the backend, SQLite, FFmpeg/ffprobe and the UI bundle all work
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
