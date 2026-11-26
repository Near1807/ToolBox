// v0.45.0: a folder's colour — Thomas's choice from the Agenda's category
// palette (« p:<id> », « #rrggbb »), else a theme token chosen from its
// family (the root folder's name), so a family keeps one colour. Pure.
import { colorValue } from '@hub/sdk/palette';

const SERIES = 8;

/** A theme token for a name (the same name: the same token). */
export function familyToken(name: string): string {
  let h = 0;
  for (const c of name.normalize('NFD').toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--series-${(h % SERIES) + 1})`;
}

/** The CSS value of a folder's colour: its own, else its family's token. */
export const folderCss = (color: string | null, familyName: string) =>
  colorValue(color, familyToken(familyName));
