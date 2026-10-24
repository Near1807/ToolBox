// Stored form of an analysis: JSON with the big arrays as base64 (Float32 or
// Uint8), read back the same way by the backend and the interface.
import type { Analysis } from './types';

type Typed = Float32Array | Uint8Array;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step)
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encodeArray = (array: Typed) => ({
  $type: array instanceof Float32Array ? 'f32' : 'u8',
  data: toBase64(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)),
});

function decodeArray(value: { $type: string; data: string }): Typed {
  const bytes = fromBase64(value.data);
  if (value.$type === 'u8') return bytes;
  // Copy into an aligned buffer.
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  return new Float32Array(aligned.buffer);
}

export function encodeAnalysis(analysis: Analysis): string {
  return JSON.stringify(analysis, (_key, value: unknown) =>
    value instanceof Float32Array || value instanceof Uint8Array ? encodeArray(value) : value,
  );
}

export function decodeAnalysis(text: string): Analysis {
  return JSON.parse(text, (_key, value: unknown) =>
    value && typeof value === 'object' && '$type' in value && 'data' in value
      ? decodeArray(value as { $type: string; data: string })
      : value,
  ) as Analysis;
}
