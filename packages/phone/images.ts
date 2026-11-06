// ctx.images.normalise on the phone (ADR 0044): the same rules as the PC
// (backend/core/images.ts) with the browser's decoder and encoder
// (createImageBitmap, OffscreenCanvas, in the Worker): same longest side,
// same JPEG quality, same weight limit, same white under transparency, same
// messages. The JPEG bytes may differ from Skia's (another encoder): the
// image reference compares sizes, refusals and rows, not bytes.
// Portable: no Node import; needs OffscreenCanvas (the app's Worker).
import type { ImageOptions, StoredImage } from '../sdk/core';

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function normaliseImageWeb(
  input: Uint8Array,
  options: ImageOptions,
): Promise<StoredImage> {
  if (input.length === 0) throw new Error('Image vide');
  if (input.length > options.maxBytes)
    throw new Error(`Image trop lourde (${options.maxBytes / (1024 * 1024)} Mo au plus)`);
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(new Blob([input as BlobPart]));
  } catch {
    throw new Error('Image illisible (JPEG, PNG ou WebP attendu)');
  }
  try {
    if (!(image.width > 0 && image.height > 0)) throw new Error('Image illisible');
    const scale = Math.min(1, options.maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Image illisible');
    g.fillStyle = options.background;
    g.fillRect(0, 0, width, height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: options.quality / 100 });
    const data = new Uint8Array(await blob.arrayBuffer());
    const sha256 = hex(await crypto.subtle.digest('SHA-256', data as BufferSource));
    return { data, width, height, sha256 };
  } finally {
    image.close();
  }
}
