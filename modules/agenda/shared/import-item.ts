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
  rem: 'Remarque',
};

/** A line of a description, cleaned (« \ » left by some exports, spaces). */
const cleanLine = (line: string) => line.replace(/\\/g, ' ').replace(/\s+/g, ' ').trim();
/** Two texts that say the same thing (spaces, « \ » and the exam type aside). */
const sameText = (a: string, b: string) => {
  const k = (s: string) =>
    s
      .replace(EXAM, '')
      .replace(/[\s\\]+/g, '')
      .toLowerCase();
  return k(a) === k(b);
};
const KEY_VALUE = /^([\p{L}]{1,12})\s*:\s*(.*)$/u;

/**
 * The title, code and note of an event of a school timetable (v0.38.0):
 * - a course: SUMMARY is a code (« ®-RE4L-L2-4MEO-4MIN »), its name is the
 *   « Act: » line of the description → title « Computer Network Lab », code
 *   « RE4L-L2-4MEO-4MIN » (the « ® » in front left out), shown with the
 *   « TH2C · Thermo » style only;
 * - without « Act: »: as before (« TH2C:Thermo » → « Thermo », code « TH2C »);
 * - an exam: [ECRIT] / [ORAL] in the description (or the summary) →
 *   « Thermo · Écrit » / « · Oral ».
 * The note: the other lines (« Groupe : … · Enseignants : … · Remarque : … »),
 * without the « Act: » line used as title, without a line that only repeats
 * the summary (and its exam type), without a « clé: » with no value.
 */
export function describeEvent(
  summary: string,
  description: string,
): { title: string; code: string | null; note: string | null } {
  const lines = description.split('\n').map(cleanLine).filter(Boolean);
  const act = lines
    .map((l) => /^act\s*:\s*(.+)$/i.exec(l)?.[1]?.trim() ?? '')
    .find((v) => v !== '');
  const examMatch = EXAM.exec(description) ?? EXAM.exec(summary);
  const exam = examMatch ? (examMatch[1]!.toUpperCase() === 'ORAL' ? 'Oral' : 'Écrit') : '';
  let title: string;
  let code: string | null;
  if (act) {
    title = act.replace(EXAM, ' ').replace(/\s+/g, ' ').trim();
    // « TH2C:Thermo » keeps its code « TH2C »; a bare code (« ®-RE4L-… ») is the code.
    const c =
      splitTitle(summary.replace(EXAM, ' ')).code ??
      cleanLine(summary)
        .replace(/^®\s*[-–]?\s*/, '')
        .trim();
    code = c && !sameText(c, title) ? c : null;
  } else {
    const split = splitTitle(summary.replace(EXAM, ' '));
    title = split.title;
    code = split.code;
  }
  const parts = lines
    .filter((l) => !sameText(l, summary))
    .flatMap((l) => {
      const kv = KEY_VALUE.exec(l);
      if (!kv) return [l];
      const key = kv[1]!.toLowerCase();
      const value = kv[2]!.trim();
      if (!value) return [];
      if (key === 'act' && act) return [];
      return [`${KEY_LABELS[key] ?? kv[1]!} : ${value}`];
    });
  return {
    title: clip(exam ? `${title} · ${exam}` : title),
    code,
    note: parts.length ? clip(parts.join(' · ')) : null,
  };
}

/** The note alone (see describeEvent). */
export const noteOf = (description: string, summary: string) =>
  describeEvent(summary, description).note;
