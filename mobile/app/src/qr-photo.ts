// Reads the pairing QR code from a photo (the phone's camera, through the
// file picker): no live camera, no extra permission. jsQR decodes it.
import jsQR from 'jsqr';

export async function readQrFromPhoto(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  // Large enough for a QR code on a screen, small enough to be quick.
  for (const side of [1600, 1000, 2400]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d');
    if (!g) break;
    g.drawImage(bitmap, 0, 0, w, h);
    const found = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (found?.data) {
      bitmap.close();
      return found.data;
    }
  }
  bitmap.close();
  return null;
}
