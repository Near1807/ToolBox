import { describe, expect, it } from 'vitest';
import { ManifestError, validateManifest } from '../../backend/core/modules/manifest';

const valid = {
  id: 'music-library',
  name: 'Bibliothèque',
  description: 'Morceaux',
  version: '1.0.0',
  section: 'Musique',
  icon: '🎵',
};

describe('validateManifest', () => {
  it('accepts a minimal manifest', () => {
    expect(validateManifest(valid, 'music-library').id).toBe('music-library');
  });

  it('requires the id to match the folder name', () => {
    expect(() => validateManifest(valid, 'other')).toThrow(/nom du dossier/);
  });

  it('rejects invalid ids, versions and unknown keys with readable messages', () => {
    expect(() => validateManifest({ ...valid, id: 'Music_Library' })).toThrow(ManifestError);
    expect(() => validateManifest({ ...valid, version: 'v1' })).toThrow(/version/);
    expect(() => validateManifest({ ...valid, unknown: true })).toThrow(ManifestError);
  });

  it('accepts the assistant and global keys permissions, and hidden settings', () => {
    const manifest = validateManifest({
      ...valid,
      permissions: { assistant: true, globalKeys: true },
      settings: [{ key: 'k', type: 'string', label: 'K', hidden: true }],
    });
    expect(manifest.permissions).toEqual({ assistant: true, globalKeys: true });
    expect(() => validateManifest({ ...valid, permissions: { microphone: true } })).toThrow();
  });

  it('rejects reserved ids', () => {
    expect(() => validateManifest({ ...valid, id: 'core' })).toThrow(/réservé/);
  });

  it('validates the settings schema', () => {
    expect(() =>
      validateManifest({
        ...valid,
        settings: [{ key: 'a', type: 'select', label: 'A', options: [] }],
      }),
    ).toThrow(ManifestError);
    expect(() =>
      validateManifest({
        ...valid,
        settings: [
          { key: 'a', type: 'string', label: 'A' },
          { key: 'a', type: 'number', label: 'B' },
        ],
      }),
    ).toThrow(/deux fois/);
  });
});
