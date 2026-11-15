// v0.37.0: what an imported calendar gives, whatever its format (ICS, CSV,
// Excel): one item per event or per occurrence of a repeated event (the
// repetitions are unfolded at import), with its origin key (stable from one
// export to the next: what makes a re-import update instead of duplicate)
// and its original text (never lost: kept in the event).

/** An event read in a file, ready to compare with the Agenda. */
export interface ImportItem {
  /** Origin key: the UID (an occurrence: « UID#AAAAMMJJ »), or the file's identifier, or titre|début. */
  key: string;
  /** Line of the file where it is described (for the messages). */
  line: number;
  /** Title without its code (« Thermo », exam type kept: « Thermo · Écrit »). */
  title: string;
  /** Code before the title, when the file gives one (« TH2C »): title « TH2C · Thermo » on request. */
  code: string | null;
  /** « YYYY-MM-DD » (all day) or « YYYY-MM-DDTHH:mm » (local time of this device). */
  start: string;
  /** All day: the last day, inclusive. At a time: the end. */
  end: string;
  allDay: boolean;
  location: string | null;
  note: string | null;
  /** The file's own category value (« H », « X »), '' when none: mapped to an Agenda category. */
  rawCategory: string;
  /** The original text of the event, field by field, as it was in the file. */
  original: Record<string, string>;
}

/** A line of the file that could not be read: shown in « Erreurs », nothing written for it. */
export interface ImportError {
  line: number;
  reason: string;
}

export interface ParsedFile {
  /** Name of the calendar in the file (X-WR-CALNAME), or null. */
  calendarName: string | null;
  items: ImportItem[];
  errors: ImportError[];
}

/** Title styles: « Thermo » or « TH2C · Thermo ». */
export type TitleStyle = 'short' | 'code';

export const titleOf = (item: Pick<ImportItem, 'title' | 'code'>, style: TitleStyle) =>
  style === 'code' && item.code ? `${item.code} · ${item.title}` : item.title;

/** Texts are kept to this length in the event (the original is kept whole). */
export const MAX_FIELD = 200;

export const clip = (text: string, max = MAX_FIELD) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const EXAM = /\[\s*(ECRIT|ÉCRIT|ORAL)\s*\]/i;

/**
 * « TH2C:Thermo » → code « TH2C », title « Thermo »; « TH2C:Thermo[ECRIT] » →
 * « Thermo · Écrit » (the exam type stays visible). A prefix is a code only
 * when it looks like one (capitals, digits), so « Réunion: budget » stays whole.
 */
export function splitTitle(summary: string): { title: string; code: string | null } {
  let text = summary.replace(/\s+/g, ' ').trim();
  let exam = '';
  const m = EXAM.exec(text);
  if (m) {
    exam = m[1]!.toUpperCase() === 'ORAL' ? 'Oral' : 'Écrit';
    text = text.replace(EXAM, ' ').replace(/\s+/g, ' ').trim();
  }
  let code: string | null = null;
  const c = /^([A-Z0-9][A-Z0-9_.-]{0,15})\s*:\s*(.+)$/.exec(text);
  if (c) {
    code = c[1]!;
    text = c[2]!.trim();
  }
  if (!text) text = code ?? summary.trim();
  return { title: clip(exam ? `${text} · ${exam}` : text), code };
}

const KEY_LABELS: Record<string, string> = {
  act: 'Activité',
  ens: 'Enseignants',
  prof: 'Enseignants',
  groupe: 'Groupe',
  grp: 'Groupe',
};

/**
 * The note from a description: « Act:Non Relational Database\nGroupe:4MIN-7a\nEns:BRN »
 * → « Activité : Non Relational Database · Groupe : 4MIN-7a · Enseignants : BRN ».
 * A line that only repeats the summary is left out.
 */
export function noteOf(description: string, summary: string): string | null {
  const same = (a: string) => a.replace(/[\s\\]+/g, '') === summary.replace(/[\s\\]+/g, '');
  const parts = description
    .split('\n')
    .map((line) => line.replace(/\\/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line && !same(line))
    .map((line) => {
      const kv = /^([\p{L}]{1,12})\s*:\s*(.+)$/u.exec(line);
      if (!kv) return line;
      const label = KEY_LABELS[kv[1]!.toLowerCase()] ?? kv[1]!;
      return `${label} : ${kv[2]}`;
    });
  return parts.length ? clip(parts.join(' · ')) : null;
}
