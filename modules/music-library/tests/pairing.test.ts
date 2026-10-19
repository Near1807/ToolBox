import { describe, expect, it } from 'vitest';
import { pairDroppedFiles } from '../frontend/pairing';

describe('pairDroppedFiles', () => {
  it('pairs one sound with one image whatever their names', () => {
    expect(pairDroppedFiles(['C:\\a\\master.wav', 'C:\\a\\artwork.PNG'])).toEqual({
      imports: [{ audioPath: 'C:\\a\\master.wav', coverPath: 'C:\\a\\artwork.PNG' }],
      ignored: [],
    });
  });

  it('pairs several sounds with images of the same name', () => {
    const result = pairDroppedFiles([
      '/x/a.mp3',
      '/x/b.flac',
      '/x/b.jpg',
      '/x/c.png',
      '/x/notes.txt',
    ]);
    expect(result.imports).toEqual([
      { audioPath: '/x/a.mp3', coverPath: null },
      { audioPath: '/x/b.flac', coverPath: '/x/b.jpg' },
    ]);
    expect(result.ignored).toEqual(['/x/notes.txt', '/x/c.png']);
  });

  it('ignores images without any sound', () => {
    expect(pairDroppedFiles(['/x/cover.jpg'])).toEqual({ imports: [], ignored: ['/x/cover.jpg'] });
  });
});
