// Pure helpers for files dropped onto the library (testable without a browser).

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'flac'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];

export interface TrackImport {
  audioPath: string;
  coverPath: string | null;
}

function parts(filePath: string): { base: string; ext: string } {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = name.lastIndexOf('.');
  return dot === -1
    ? { base: name.toLowerCase(), ext: '' }
    : { base: name.slice(0, dot).toLowerCase(), ext: name.slice(dot + 1).toLowerCase() };
}

/**
 * Groups dropped files into tracks:
 * - one sound + one image → that image is the cover;
 * - several sounds → each takes the image with the same file name, if any;
 * - files of other types are reported as ignored.
 */
export function pairDroppedFiles(paths: string[]): { imports: TrackImport[]; ignored: string[] } {
  const audios = paths.filter((p) => AUDIO_EXTENSIONS.includes(parts(p).ext));
  const images = paths.filter((p) => IMAGE_EXTENSIONS.includes(parts(p).ext));
  const ignored = paths.filter((p) => !audios.includes(p) && !images.includes(p));

  if (audios.length === 1) {
    return { imports: [{ audioPath: audios[0]!, coverPath: images[0] ?? null }], ignored };
  }
  const imports = audios.map((audioPath) => ({
    audioPath,
    coverPath: images.find((image) => parts(image).base === parts(audioPath).base) ?? null,
  }));
  const usedImages = new Set(imports.map((i) => i.coverPath));
  return { imports, ignored: [...ignored, ...images.filter((i) => !usedImages.has(i))] };
}
