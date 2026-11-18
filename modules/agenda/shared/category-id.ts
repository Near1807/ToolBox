// v0.43.0 (ADR 0049): the identity of a category. A name is compared without
// case, accents or extra spaces (« Réunions » = « reunions »), and every
// category the migration seeds (or that the Agenda makes for a name) gets
// the SAME identifier on the PC and the phone: a UUID v5 of the folded name.
// Pure, synchronous (a migration runs inside a transaction), portable (no
// Node, no Web Crypto: SHA-1 written here).

/** A name as compared: no accents, lower case, single spaces, trimmed. */
export function foldName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The namespace of the Agenda's categories (fixed, never change it). */
export const CATEGORY_NAMESPACE = '6f1c2a4e-9b3d-4c57-8e21-0a5d7b9c3e14';

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63));
      c &= 63;
      out.push(0x80 | c);
    }
  }
  return out;
}

/** SHA-1 of bytes (FIPS 180-4), 20 bytes. */
export function sha1(bytes: readonly number[]): number[] {
  const ml = bytes.length * 8;
  const msg = [...bytes, 0x80];
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 7; i >= 0; i--) msg.push(i >= 4 ? 0 : (ml >>> (i * 8)) & 0xff);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i++)
      w[i] =
        (msg[off + 4 * i]! << 24) |
        (msg[off + 4 * i + 1]! << 16) |
        (msg[off + 4 * i + 2]! << 8) |
        msg[off + 4 * i + 3]!;
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].flatMap((h) => [
    h >>> 24,
    (h >>> 16) & 255,
    (h >>> 8) & 255,
    h & 255,
  ]);
}

/** UUID v5 (RFC 9562) of `name` in `namespace`. */
export function uuidV5(name: string, namespace = CATEGORY_NAMESPACE): string {
  const ns = namespace
    .replace(/-/g, '')
    .match(/../g)!
    .map((h) => parseInt(h, 16));
  const hash = sha1([...ns, ...utf8(name)]).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The identifier of the category of this name, the same on every device. */
export const categoryIdOf = (name: string) => uuidV5(foldName(name));
