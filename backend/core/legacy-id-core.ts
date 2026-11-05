// The UUID of a row that had a number before, PORTABLE part (ADR 0044): the
// format, from the sha256 of « seed|kind|oldId » given by the platform (Node's
// crypto on the PC: ./legacy-id.ts; packages/phone/sha256.ts on the phone).
// Same text everywhere: a fresh install converts the rows its first migration
// created (the Timer's two presets), on the PC and on the phone alike.

/** The text hashed for a row. */
export function legacyKey(seed: string, kind: string, oldId: number): string {
  return `${seed}|${kind}|${oldId}`;
}

/** A UUID version 8 (RFC 9562: built by the application) from a sha256 in hex. */
export function legacyUuidFromHash(sha256Hex: string): string {
  const hex = sha256Hex.slice(0, 32);
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
