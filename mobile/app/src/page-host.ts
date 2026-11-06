// What the Worker asks of the page (packages/phone/transport.ts, HostCall):
// what only Android can do, through the Capacitor plugins.
// « Enregistrer sous » (ctx.files.saveAs, e.g. the Markdown exports): the
// file is written in the app's cache, then given to Android's share sheet;
// the user chooses where it goes (Drive, mail, Fichiers…). Cancelling the
// sheet is « Annulé », like closing the dialog on the PC.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { bytesToBase64 } from '@hub/sdk/core';
import type { HostCall } from '../../../packages/phone/transport';

const EXPORTS = 'exports';

/** A file name Android accepts (no folder separators, nothing invisible). */
export function safeFileName(name: string): string {
  const clean = [...name]
    .map((c) => (c.charCodeAt(0) < 32 ? '-' : c))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'export';
}

/** The share sheet was closed without choosing (Capacitor's message). */
const cancelled = (error: unknown) =>
  /cancel/i.test(error instanceof Error ? error.message : String(error));

async function saveAs(call: Extract<HostCall, { kind: 'saveAs' }>): Promise<string | null> {
  const name = safeFileName(call.defaultName);
  const path = `${EXPORTS}/${name}`;
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    recursive: true,
    ...(typeof call.data === 'string'
      ? { data: call.data, encoding: Encoding.UTF8 }
      : { data: bytesToBase64(call.data) }),
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: call.title, dialogTitle: call.title, files: [uri] });
  } catch (error) {
    if (cancelled(error)) return null;
    throw error;
  }
  return name;
}

export function pageHost(call: HostCall): Promise<unknown> {
  switch (call.kind) {
    case 'saveAs':
      return saveAs(call);
  }
}
