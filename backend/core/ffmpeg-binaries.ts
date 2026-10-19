import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from '@derhuerst/ffprobe-static';

const execFileAsync = promisify(execFile);

/**
 * Binaries cannot be executed from inside app.asar: electron-builder unpacks
 * them (asarUnpack) to app.asar.unpacked, but the packages still report the
 * path inside the archive.
 */
export function toUnpackedPath(binaryPath: string): string {
  return binaryPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

export function getFfmpegPath(): string {
  if (!ffmpegStatic) throw new Error("FFmpeg n'est pas disponible pour cette plateforme");
  return toUnpackedPath(ffmpegStatic);
}

export function getFfprobePath(): string {
  if (!ffprobeStatic) throw new Error("FFprobe n'est pas disponible pour cette plateforme");
  return toUnpackedPath(ffprobeStatic);
}

/** Returns the first line of `<binary> -version`, or null if it cannot run. */
export async function getBinaryVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ['-version'], { timeout: 10_000 });
    return stdout.split(/\r?\n/)[0]?.trim() ?? null;
  } catch {
    return null;
  }
}
