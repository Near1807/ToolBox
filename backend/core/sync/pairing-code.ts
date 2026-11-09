// The pairing code (ADR 0044): what the PC shows (QR code, and the same text
// to type by hand if the camera fails) and the phone reads. It holds the
// PC's local address and port, a single-use token (10 minutes), and the
// first 16 bytes of the SHA-256 of the PC's certificate: the phone talks to
// that certificate only (pinning), never to another one.
//   TBX1-ABCD-EFGH-…   (Crockford base 32, no I/L/O/U: easy to type)
// Portable: no Node import.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'TBX1';

export interface PairingInfo {
  /** IPv4 address of the PC on the local network. */
  host: string;
  port: number;
  /** Single-use token, hex (10 bytes). */
  token: string;
  /** First 16 bytes of the certificate's SHA-256, hex. */
  pin: string;
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Uint8Array {
  const clean = text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('Code d’appairage illisible');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

const hexBytes = (hex: string) =>
  new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const checksum = (bytes: Uint8Array) => bytes.reduce((s, b) => (s * 31 + b) % 251, 7);

export function encodePairing(info: PairingInfo): string {
  const ip = info.host.split('.').map(Number);
  if (ip.length !== 4 || ip.some((n) => !(n >= 0 && n <= 255)))
    throw new Error('Adresse IPv4 attendue');
  const token = hexBytes(info.token);
  const pin = hexBytes(info.pin);
  if (token.length !== 10 || pin.length !== 16) throw new Error('Jeton ou empreinte invalide');
  const body = new Uint8Array([...ip, info.port >> 8, info.port & 255, ...token, ...pin]);
  const all = new Uint8Array([...body, checksum(body)]);
  const groups = toBase32(all).match(/.{1,4}/g)!;
  return [PREFIX, ...groups].join('-');
}

/** Reads a code (from the QR code or typed by hand); throws a French message when it is not one. */
export function decodePairing(code: string): PairingInfo {
  const text = code.trim().toUpperCase().replace(/\s+/g, '');
  if (!text.startsWith(PREFIX))
    throw new Error('Ce n’est pas un code d’appairage ToolBox (il commence par TBX1).');
  const bytes = fromBase32(text.slice(PREFIX.length));
  if (bytes.length < 33) throw new Error('Code d’appairage incomplet : vérifie chaque groupe.');
  const body = bytes.slice(0, 32);
  if (checksum(body) !== bytes[32])
    throw new Error('Code d’appairage faux : un caractère est mal recopié.');
  return {
    host: [...body.slice(0, 4)].join('.'),
    port: (body[4]! << 8) | body[5]!,
    token: toHex(body.slice(6, 16)),
    pin: toHex(body.slice(16, 32)),
  };
}

/** « 3B:66:5A:… » (the certificate's full SHA-256) → the 16 bytes the code carries. */
export function pinOf(fingerprint256: string): string {
  return fingerprint256.replace(/:/g, '').toLowerCase().slice(0, 32);
}

// « QR de l'adresse » (ADR 0044, v0.33.0): the PC's address on the network it
// is on now, its port and its certificate's fingerprint, WITHOUT any token.
// A phone already paired with this PC reads it to find it again on another
// Wi-Fi: no new pairing, no new first synchronisation. It is useless to any
// other phone (no token), and the phone checks that the fingerprint is the
// one of ITS PC before using the address.
//   TBXA-ABCD-…
const ADDRESS_PREFIX = 'TBXA';

export interface AddressInfo {
  host: string;
  port: number;
  pin: string;
}

export function encodeAddress(info: AddressInfo): string {
  const ip = info.host.split('.').map(Number);
  if (ip.length !== 4 || ip.some((n) => !(n >= 0 && n <= 255)))
    throw new Error('Adresse IPv4 attendue');
  const pin = hexBytes(info.pin);
  if (pin.length !== 16) throw new Error('Empreinte invalide');
  const body = new Uint8Array([...ip, info.port >> 8, info.port & 255, ...pin]);
  const all = new Uint8Array([...body, checksum(body)]);
  return [ADDRESS_PREFIX, ...toBase32(all).match(/.{1,4}/g)!].join('-');
}

/** Reads an address code (QR or typed); throws a French message when it is not one. */
export function decodeAddress(code: string): AddressInfo {
  const text = code.trim().toUpperCase().replace(/\s+/g, '');
  if (text.startsWith(PREFIX))
    throw new Error(
      'C’est un code d’appairage (TBX1) : pour une nouvelle adresse, affiche sur le PC « QR de l’adresse » (TBXA).',
    );
  if (!text.startsWith(ADDRESS_PREFIX))
    throw new Error('Ce n’est pas un code d’adresse ToolBox (il commence par TBXA).');
  const bytes = fromBase32(text.slice(ADDRESS_PREFIX.length));
  if (bytes.length < 23) throw new Error('Code d’adresse incomplet : vérifie chaque groupe.');
  const body = bytes.slice(0, 22);
  if (checksum(body) !== bytes[22])
    throw new Error('Code d’adresse faux : un caractère est mal recopié.');
  return {
    host: [...body.slice(0, 4)].join('.'),
    port: (body[4]! << 8) | body[5]!,
    pin: toHex(body.slice(6, 22)),
  };
}

/** Any ToolBox code read on a photo: a pairing code or an address code. */
export function codeKind(code: string): 'pairing' | 'address' | null {
  const text = code.trim().toUpperCase();
  return text.startsWith(PREFIX) ? 'pairing' : text.startsWith(ADDRESS_PREFIX) ? 'address' : null;
}
