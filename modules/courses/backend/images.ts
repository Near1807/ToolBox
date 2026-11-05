// Recipe images: whatever the user gives (JPEG, PNG, WebP…) is decoded and
// re-encoded by the core (`ctx.images.normalise`) as a JPEG of 1200 px at
// most on its longest side, so that a picture is light, safe to show
// (nothing of the original file is kept) and identical everywhere. Portable:
// no Node import (ADR 0044). Tested in tests/images.test.ts and
// tests/image-regression.test.ts.
import { base64ToBytes, bytesToBase64, type ImageOptions } from '@hub/sdk/core';

export type { StoredImage } from '@hub/sdk/core';

/** Largest file accepted (before re-encoding). */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** How a recipe image is stored: 1200 px at most, JPEG 82, white under transparency. */
export const RECIPE_IMAGE: ImageOptions = {
  maxSide: 1200,
  quality: 82,
  maxBytes: MAX_INPUT_BYTES,
  background: '#ffffff',
};

/** `data:image/jpeg;base64,…` (export) from the stored bytes. */
export function toDataUrl(data: Uint8Array): string {
  return `data:image/jpeg;base64,${bytesToBase64(data)}`;
}

/** The bytes of a `data:image/…;base64,…` URL (import), or null when it is not one. */
export function fromDataUrl(value: string): Uint8Array | null {
  const m = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!m) return null;
  return base64ToBytes(m[1]!.replace(/\s+/g, ''));
}
