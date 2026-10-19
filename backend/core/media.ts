import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import path from 'node:path';

export const MEDIA_PREFIX = '/api/media/';

function isInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  return target === resolvedRoot || target.startsWith(resolvedRoot + path.sep);
}

/**
 * Signed URLs for files shown by the UI with <img>/<audio>/<video>, which
 * cannot send the session token. The HMAC key is random per session, so URLs
 * cannot be forged and expire when the app restarts. Only files under the
 * allowed roots (userData folders, output folder, module assets) can be signed.
 */
export class MediaSigner {
  private readonly key = randomBytes(32);

  constructor(private readonly allowedRoots: () => string[]) {}

  private signature(filePath: string): Buffer {
    return createHmac('sha256', this.key).update(filePath).digest().subarray(0, 24);
  }

  url(filePath: string): string {
    const absolute = path.resolve(filePath);
    if (!this.allowedRoots().some((root) => isInside(root, absolute))) {
      throw new Error(`Fichier hors des dossiers autorisés : ${absolute}`);
    }
    const token = `${Buffer.from(absolute).toString('base64url')}.${this.signature(absolute).toString('base64url')}`;
    let version = '';
    try {
      version = `?v=${Math.round(statSync(absolute).mtimeMs)}`;
    } catch {
      // Missing file: the URL will answer 404.
    }
    return `${MEDIA_PREFIX}${token}/${encodeURIComponent(path.basename(absolute))}${version}`;
  }

  /** Returns the file path of a valid token, or null. */
  resolve(token: string): string | null {
    const [encodedPath, encodedSignature] = token.split('.');
    if (!encodedPath || !encodedSignature) return null;
    const filePath = Buffer.from(encodedPath, 'base64url').toString();
    const expected = this.signature(filePath);
    const given = Buffer.from(encodedSignature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (!this.allowedRoots().some((root) => isInside(root, filePath))) return null;
    return filePath;
  }
}

/** Extracts the token from a media URL ("/api/media/<token>/<name>?v=…"), or null. */
export function mediaTokenFromUrl(url: string): string | null {
  const match = /\/api\/media\/([^/?#]+)\//.exec(url);
  return match?.[1] ?? null;
}
