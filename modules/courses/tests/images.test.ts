// Recipe images: normalised (JPEG, longest side ≤ 1200 px, white under any
// transparency) and data URLs read back strictly.
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { fromDataUrl, normaliseImage, toDataUrl } from '../backend/images';

const png = (w: number, h: number) => {
  const c = createCanvas(w, h);
  c.getContext('2d').fillRect(0, 0, w / 2, h / 2);
  return c.toBuffer('image/png');
};

describe('recipe images', () => {
  it('resizes the longest side to 1200 px and stores JPEG', async () => {
    const img = await normaliseImage(png(1000, 3000));
    expect([img.width, img.height]).toEqual([400, 1200]);
    expect(img.data.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(img.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('keeps a small image at its size', async () => {
    const img = await normaliseImage(png(320, 240));
    expect([img.width, img.height]).toEqual([320, 240]);
  });
  it('refuses what is not an image', async () => {
    await expect(normaliseImage(Buffer.from('bonjour'))).rejects.toThrow();
  });
  it('data URLs: round trip, other types refused', () => {
    const buf = Buffer.from([1, 2, 3]);
    expect(fromDataUrl(toDataUrl(buf))).toEqual(buf);
    expect(fromDataUrl('data:text/html;base64,AAAA')).toBeNull();
    expect(fromDataUrl('pas une url')).toBeNull();
  });
});
