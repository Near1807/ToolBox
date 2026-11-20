// v0.44.0: the phone's « Partager » / « Enregistrer sous » (mobile/app/src/share-file.ts):
// the share sheet receives the file (a PNG here), and its cached copy is deleted
// after — at once when cancelled, when Thomas comes back otherwise, and at the
// next start for what a closed app left. The Capacitor plugins are fakes.
import { describe, expect, it } from 'vitest';
import {
  EXPORTS,
  KEEP_MS,
  type ShareDeps,
  shareFile,
  sweepExports,
} from '../mobile/app/src/share-file';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function fakes(answer: 'ok' | 'cancel' = 'ok') {
  const files = new Map<string, string>();
  const shared: { title: string; files: string[]; data: string | undefined }[] = [];
  let back: { then: () => void; ms: number } | null = null;
  const deps: ShareDeps = {
    write: async (path, data) => {
      files.set(path, 'base64' in data ? data.base64 : data.text);
    },
    uri: async (path) => `file:///cache/${path}`,
    share: async (o) => {
      shared.push({ ...o, data: files.get(o.files[0]!.replace('file:///cache/', '')) });
      if (answer === 'cancel') throw new Error('Share canceled');
    },
    remove: async (path) => {
      files.delete(path);
    },
    list: async (folder) =>
      [...files.keys()]
        .filter((p) => p.startsWith(`${folder}/`))
        .map((p) => p.slice(folder.length + 1)),
    later: (then, ms) => {
      back = { then, ms };
    },
    toBase64: (data) => Buffer.from(data).toString('base64'),
  };
  return { deps, files, shared, back: () => back };
}

describe('sharing a file from the phone', () => {
  it('the sheet receives the PNG; its copy is deleted when Thomas comes back (5 min at most)', async () => {
    const f = fakes();
    const name = await shareFile(f.deps, {
      title: 'Partager l’image de la semaine',
      defaultName: 'Agenda semaine du 2026-11-23.png',
      data: PNG,
    });
    expect(name).toBe('Agenda semaine du 2026-11-23.png');
    expect(f.shared).toHaveLength(1);
    const sent = Buffer.from(f.shared[0]!.data!, 'base64');
    expect([...sent.subarray(0, 8)]).toEqual([...PNG.subarray(0, 8)]);
    // Still there while the app it went to may read it…
    expect(f.files.size).toBe(1);
    expect(f.back()!.ms).toBe(KEEP_MS);
    // … deleted when the page comes back.
    f.back()!.then();
    await Promise.resolve();
    expect(f.files.size).toBe(0);
  });
  it('cancelled: nothing kept, « annulé »', async () => {
    const f = fakes('cancel');
    expect(await shareFile(f.deps, { title: 't', defaultName: 'x.png', data: PNG })).toBeNull();
    await Promise.resolve();
    expect(f.files.size).toBe(0);
  });
  it('at the start: what a closed app left is swept', async () => {
    const f = fakes();
    await f.deps.write(`${EXPORTS}/vieux.png`, { base64: 'AA==' });
    await f.deps.write(`${EXPORTS}/notes.md`, { text: '# x' });
    expect(await sweepExports(f.deps)).toBe(2);
    expect(f.files.size).toBe(0);
  });
});
