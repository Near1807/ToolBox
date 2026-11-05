// Images given by the user (`ctx.images`, PC implementation): decoded and
// re-encoded as a JPEG by @napi-rs/canvas (Skia), so that a picture is light,
// safe to show (nothing of the original file is kept) and identical
// everywhere. The code moved here unchanged from the Courses module (v0.29.1,
// ADR 0044): same reduction, same JPEG, same fingerprint.
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { ImageOptions, StoredImage } from '../../packages/sdk/core';

/** Decodes and re-encodes an image; throws a French message when it is not one. */
export async function normaliseImage(
  input: Uint8Array,
  options: ImageOptions,
): Promise<StoredImage> {
  if (input.length === 0) throw new Error('Image vide');
  if (input.length > options.maxBytes)
    throw new Error(`Image trop lourde (${options.maxBytes / (1024 * 1024)} Mo au plus)`);
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  } catch {
    throw new Error('Image illisible (JPEG, PNG ou WebP attendu)');
  }
  if (!(image.width > 0 && image.height > 0)) throw new Error('Image illisible');
  const scale = Math.min(1, options.maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  g.fillStyle = options.background;
  g.fillRect(0, 0, width, height);
  g.drawImage(image, 0, 0, width, height);
  const data = await canvas.encode('jpeg', options.quality);
  return { data, width, height, sha256: createHash('sha256').update(data).digest('hex') };
}
