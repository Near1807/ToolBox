// What the Worker asks of the page (packages/phone/transport.ts, HostCall):
// what only Android can do, through the Capacitor plugins.
// « Enregistrer sous » (ctx.files.saveAs, e.g. the Markdown exports, the
// Agenda's image): the file is written in the app's cache, then given to
// Android's share sheet; the user chooses where it goes (WhatsApp, Drive,
// mail, Fichiers…). Cancelling the sheet is « Annulé », like closing the
// dialog on the PC. v0.44.0: the cached copy is deleted after (share-file.ts).
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { bytesToBase64 } from '@hub/sdk/core';
import type { HostCall } from '../../../packages/phone/transport';
import { type ShareDeps, shareFile, sweepExports } from './share-file';

/** Runs `then` once the page is shown again after being hidden (Thomas came back), or after `ms`. */
function whenBack(then: () => void, ms: number) {
  let wasHidden = document.visibilityState === 'hidden';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    document.removeEventListener('visibilitychange', onChange);
    window.clearTimeout(timer);
    then();
  };
  const onChange = () => {
    if (document.visibilityState === 'hidden') wasHidden = true;
    else if (wasHidden) finish();
  };
  document.addEventListener('visibilitychange', onChange);
  const timer = window.setTimeout(finish, ms);
}

const deps: ShareDeps = {
  write: async (path, data) => {
    await Filesystem.writeFile({
      path,
      directory: Directory.Cache,
      recursive: true,
      ...('text' in data ? { data: data.text, encoding: Encoding.UTF8 } : { data: data.base64 }),
    });
  },
  uri: async (path) => (await Filesystem.getUri({ path, directory: Directory.Cache })).uri,
  share: async (o) => {
    await Share.share({ title: o.title, dialogTitle: o.title, files: o.files });
  },
  remove: (path) => Filesystem.deleteFile({ path, directory: Directory.Cache }),
  list: async (folder) =>
    (await Filesystem.readdir({ path: folder, directory: Directory.Cache })).files.map(
      (f) => f.name,
    ),
  later: whenBack,
  toBase64: bytesToBase64,
};

/** At the app's start: what a closed app left in the cache (shared files). */
export function sweepSharedFiles(): void {
  void sweepExports(deps);
}

export function pageHost(call: HostCall): Promise<unknown> {
  switch (call.kind) {
    case 'saveAs':
      return shareFile(deps, call);
  }
}
