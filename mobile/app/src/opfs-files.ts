// The modules' data folders on the phone (ctx.files, packages/phone/files.ts):
// files in OPFS, under « files/ » (next to the base's pool, never mixed with
// it). The modules read and write synchronously: every file is loaded in
// memory at start (a few recipe pictures of ~150 kB), and each write or
// removal goes through to OPFS in order; the Worker waits for them
// (`flush`) before answering a request, so an answered change is on disk.
// Images are shown through blob: URLs made here (same origin as the page).
import type { FileStore } from '../../../packages/phone/files';

const ROOT = 'files';

async function folder(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create });
  for (const part of path.split('/').filter(Boolean).slice(0, -1))
    dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}
const nameOf = (path: string) => path.split('/').filter(Boolean).at(-1)!;

export class OpfsFileStore implements FileStore {
  private readonly files = new Map<string, Uint8Array>();
  private readonly urls = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private failure: Error | null = null;

  /** Reads every file of « files/ » (at start, before the modules). */
  async load(): Promise<void> {
    const root = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(ROOT, {
      create: true,
    });
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of (
        dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
      ).entries()) {
        const path = `${prefix}/${name}`;
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, path);
        else {
          const file = await (handle as FileSystemFileHandle).getFile();
          this.files.set(path, new Uint8Array(await file.arrayBuffer()));
        }
      }
    };
    await walk(root, '');
  }

  private later(job: () => Promise<void>) {
    this.queue = this.queue.then(job).catch((error: unknown) => {
      this.failure = error instanceof Error ? error : new Error(String(error));
    });
  }

  /** Waits for the writes in progress; throws if one failed (the change is not on disk). */
  async flush(): Promise<void> {
    await this.queue;
    const failure = this.failure;
    this.failure = null;
    if (failure) throw new Error(`Fichier non enregistré sur le téléphone : ${failure.message}`);
  }

  private forget(path: string) {
    const url = this.urls.get(path);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(path);
  }

  read(path: string) {
    return this.files.get(path) ?? null;
  }

  write(path: string, data: Uint8Array) {
    const copy = new Uint8Array(data);
    this.files.set(path, copy);
    this.forget(path);
    this.later(async () => {
      const dir = await folder(path, true);
      const handle = await dir.getFileHandle(nameOf(path), { create: true });
      const access = await (
        handle as unknown as {
          createSyncAccessHandle(): Promise<{
            truncate(n: number): void;
            write(d: Uint8Array, o: { at: number }): number;
            flush(): void;
            close(): void;
          }>;
        }
      ).createSyncAccessHandle();
      try {
        access.truncate(0);
        access.write(copy, { at: 0 });
        access.flush();
      } finally {
        access.close();
      }
    });
  }

  remove(path: string) {
    this.files.delete(path);
    this.forget(path);
    this.later(async () => {
      const dir = await folder(path, false).catch(() => null);
      await dir?.removeEntry(nameOf(path)).catch(() => undefined);
    });
  }

  url(path: string) {
    const data = this.files.get(path);
    if (!data) return null;
    let url = this.urls.get(path);
    if (!url) {
      url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/jpeg' }));
      this.urls.set(path, url);
    }
    return url;
  }
}
