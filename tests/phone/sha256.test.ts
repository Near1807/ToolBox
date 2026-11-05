// The phone's synchronous sha256 (plain JavaScript) gives exactly Node's
// digests, hence the same legacy ids as the PC.
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { legacyUuid } from '../../backend/core/legacy-id';
import { legacyKey, legacyUuidFromHash } from '../../backend/core/legacy-id-core';
import { sha256Hex } from '../../packages/phone/sha256';

const node = (text: string) => createHash('sha256').update(text).digest('hex');

describe('phone sha256 = Node', () => {
  it('known vectors, every length around the block boundaries, random texts, UTF-8', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    for (let n = 0; n < 200; n++) {
      const text = 'x'.repeat(n);
      expect(sha256Hex(text), `length ${n}`).toBe(node(text));
    }
    for (let i = 0; i < 200; i++) {
      const text = randomBytes(1 + (i % 97)).toString('base64') + ' é « ü » 漢字 🙂';
      expect(sha256Hex(text)).toBe(node(text));
    }
  });
  it('same legacy ids as the PC', () => {
    for (let i = 1; i < 50; i++) {
      const seed = randomBytes(8).toString('hex');
      expect(legacyUuidFromHash(sha256Hex(legacyKey(seed, 'timer:preset', i)))).toBe(
        legacyUuid(seed, 'timer:preset', i),
      );
    }
  });
});
