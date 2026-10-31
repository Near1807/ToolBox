// Recipe images: whatever the user gives (JPEG, PNG, WebP…) is decoded and
// re-encoded as a JPEG of 1200 px at most on its longest side, so that a
// picture is light, safe to show (nothing of the original file is kept) and
// identical everywhere. Tested in tests/images.test.ts.
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';

/** Largest file accepted (before re-encoding). */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
/** Longest side of the stored image. */
const MAX_SIDE = 1200;
/** Background under transparent pixels (a JPEG has none). */
const BACKGROUND = '#ffffff';

export interface StoredImage {
  data: Buffer;
  width: number;
  height: number;
  sha256: string;
}

/** Decodes and re-encodes an image; throws a French message when it is not one. */
export async function normaliseImage(input: Buffer): Promise<StoredImage> {
  if (input.length === 0) throw new Error('Image vide');
  if (input.length > MAX_INPUT_BYTES) throw new Error('Image trop lourde (20 Mo au plus)');
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(input);
  } catch {
    throw new Error('Image illisible (JPEG, PNG ou WebP attendu)');
  }
  if (!(image.width > 0 && image.height > 0)) throw new Error('Image illisible');
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  g.fillStyle = BACKGROUND;
  g.fillRect(0, 0, width, height);
  g.drawImage(image, 0, 0, width, height);
  const data = await canvas.encode('jpeg', 82);
  return { data, width, height, sha256: createHash('sha256').update(data).digest('hex') };
}

/** `data:image/jpeg;base64,…` (export) from the stored bytes. */
export function toDataUrl(data: Buffer): string {
  return `data:image/jpeg;base64,${data.toString('base64')}`;
}

/** The bytes of a `data:image/…;base64,…` URL (import), or null when it is not one. */
export function fromDataUrl(value: string): Buffer | null {
  const m = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!m) return null;
  return Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64');
}
