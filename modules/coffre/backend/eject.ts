// v0.46.0: « Éjecter le disque » — Windows' own « Éjecter » (the verb of the
// Explorer's menu on the drive, through the Shell), then a check that the
// drive is really gone. When Windows refuses (a file open somewhere) or on
// another system: say it, and point to Windows' icon (« Retirer le
// périphérique en toute sécurité »). Never forces anything.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export interface EjectResult {
  ok: boolean;
  message: string;
}

const FALLBACK =
  "Utilise l'icône « Retirer le périphérique en toute sécurité » de Windows (en bas à droite), puis débranche le disque.";

/** Runs a PowerShell command (no profile, no window), resolves with its exit code. */
function powershell(command: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** The drive (« E: ») of a folder on Windows, or null. */
export function driveOf(folder: string): string | null {
  const m = /^([a-zA-Z]):/.exec(path.resolve(folder));
  return m ? `${m[1]!.toUpperCase()}:` : null;
}

export async function ejectDisk(folder: string): Promise<EjectResult> {
  const drive = process.platform === 'win32' ? driveOf(folder) : null;
  if (!drive) return { ok: false, message: `Éjection depuis ToolBox impossible ici. ${FALLBACK}` };
  if (drive === 'C:')
    return { ok: false, message: 'Le coffre du disque est sur C: : rien à éjecter.' };
  // The drive's « Éjecter » verb, as the Explorer does it.
  await powershell(
    `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${drive}').InvokeVerb('Eject')`,
    20_000,
  );
  // Gone within 10 seconds: ejected.
  for (let i = 0; i < 20; i++) {
    const still = await access(`${drive}\\`).then(
      () => true,
      () => false,
    );
    if (!still) return { ok: true, message: `Disque éjecté (${drive}) : tu peux le débrancher.` };
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    ok: false,
    message: `Windows n'a pas pu éjecter ${drive} (un fichier y est peut-être ouvert). ${FALLBACK}`,
  };
}
