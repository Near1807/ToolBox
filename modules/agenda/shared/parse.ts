// The Agenda's quick bar, in French (pure, tested in tests/parse.test.ts):
//   « dentiste jeudi 14h 1h »          → event, Thursday 14:00–15:00
//   « réunion staff mardi 20h »         → event, Tuesday 20:00–21:00 (1 h by default)
//   « cours de solfège de 18h à 19h30 lundi » → event, 18:00–19:30
//   « week-end scout 13-15 février »    → event over three days (all day)
//   « examen math 18 janvier »          → event, all day
//   « badminton tous les jeudis 19h 2h » → an entry of the week type
//   « préparer la réunion ~1h avant vendredi » → a task of the To-do (« à caser »)
//   « réviser stats ~2h mercredi 14h » → a task of the To-do planned Wed. 14:00 (v0.35.0)
//   « #cours » anywhere                 → its category
// Rules (written for Thomas in the guide): a « ~duration » makes a task to fit
// in; otherwise an hour makes an event at that time, a date alone an event
// for the whole day, nothing dated a task. The date and the hours come
// after the title. Dates: the To-do's code (@hub/sdk/dates), never a copy.
import {
  formatDuration,
  parseDue,
  formatPlanned,
  parseDuration,
  parseTimeOfDay,
  splitQuickAdd,
  takeDuration,
} from '@hub/sdk/dates';
import { categoryFromTag, DEFAULT_CATEGORY } from './categories';
import { addMinutes, dayLabel, eventWhen, timeOf, WEEKDAYS } from './time';

export type Parsed =
  | {
      kind: 'event';
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      category: string;
    }
  | {
      kind: 'weekly';
      title: string;
      weekday: number;
      time: string;
      durationMin: number;
      category: string;
    }
  | {
      kind: 'task';
      title: string;
      due: string | null;
      durationMin: number | null;
      /** v0.35.0: planned start « YYYY-MM-DDTHH:mm » (an hour in a « ~ » phrase), or null. */
      start: string | null;
    }
  | { kind: 'error'; message: string }
  | { kind: 'empty' };

/** An event at a time with no length given lasts this long. */
export const DEFAULT_EVENT_MIN = 60;

const MONTHS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre',
];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[,.;!?]+$/, '');

/** « 14h », « 14h30 », « 14:30 », « 9h » → minutes of the day (shared with the To-do). */
const timeToken = parseTimeOfDay;

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Words left hanging once the date and times are out (« … à », « … le »). */
const HANGING = /\s+(?:a|à|de|du|le|la|pour|avant|des|dès|d’ici|d'ici|pendant|chaque|tous les)$/i;

function cleanTitle(words: string[]): string {
  let title = words.join(' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) title = title.replace(HANGING, '').trim();
  return title;
}

/** The year of « 13 février » seen from `today`: this one if still to come, else the next. */
function dayOfMonth(day: number, month: number, today: string, year?: number): string | null {
  const text = `${day} ${MONTHS[month]}${year ? ` ${year}` : ''}`;
  return parseDue(text, today);
}

/** « 13-15 février », « du 13 au 15 février », « du 30 janvier au 2 février » → first and last days. */
function takeRange(
  words: string[],
  today: string,
): { from: string; to: string; rest: string[] } | { error: string } | null {
  const keys = words.map(fold);
  const month = (k: string | undefined) => (k ? MONTHS.indexOf(k) : -1);
  const year = (k: string | undefined) => (k && /^\d{4}$/.test(k) ? Number(k) : undefined);
  for (let i = 0; i < keys.length; i++) {
    // « 13-15 février (2027) »
    const m = keys[i]!.match(/^(\d{1,2})[-–](\d{1,2})$/);
    if (m && month(keys[i + 1]) >= 0) {
      const y = year(keys[i + 2]);
      const mo = month(keys[i + 1]);
      const from = dayOfMonth(Number(m[1]), mo, today, y);
      const to = from ? dayOfMonth(Number(m[2]), mo, from, Number(from.slice(0, 4))) : null;
      if (!from || !to) return { error: 'Ces dates n’existent pas.' };
      if (to < from) return { error: 'La fin est avant le début.' };
      return { from, to, rest: [...words.slice(0, i), ...words.slice(i + (y ? 3 : 2))] };
    }
    // « (du) 13 au 15 février », « (du) 30 janvier au 2 février »
    const at = keys[i] === 'du' ? i + 1 : i;
    if (!/^\d{1,2}(er)?$/.test(keys[at] ?? '')) continue;
    const firstMonth = month(keys[at + 1]);
    const au = firstMonth >= 0 ? at + 2 : at + 1;
    if (keys[au] !== 'au' || !/^\d{1,2}(er)?$/.test(keys[au + 1] ?? '')) continue;
    const lastMonth = month(keys[au + 2]);
    if (lastMonth < 0) continue;
    const y = year(keys[au + 3]);
    const from = dayOfMonth(
      parseInt(keys[at]!, 10),
      firstMonth >= 0 ? firstMonth : lastMonth,
      today,
      y,
    );
    const to = from
      ? dayOfMonth(
          parseInt(keys[au + 1]!, 10),
          lastMonth,
          from,
          firstMonth > lastMonth ? undefined : Number(from.slice(0, 4)),
        )
      : null;
    if (!from || !to) return { error: 'Ces dates n’existent pas.' };
    if (to < from) return { error: 'La fin est avant le début.' };
    return { from, to, rest: [...words.slice(0, i), ...words.slice(au + (y ? 4 : 3))] };
  }
  return null;
}

/** « 14h », « de 18h à 19h30 », « 14h-16h », « à 20h » and a length after (« 1h », « 30min »). */
function takeTimes(words: string[]): {
  start: number | null;
  end: number | null;
  durationMin: number | null;
  rest: string[];
} {
  const keys = words.map(fold);
  let start: number | null = null;
  let end: number | null = null;
  let durationMin: number | null = null;
  const drop = new Set<number>();
  for (let i = 0; i < keys.length && start === null; i++) {
    const range = keys[i]!.match(/^(\d{1,2}(?:h|:)\d{0,2})[-–](\d{1,2}(?:h|:)\d{0,2})$/);
    if (range) {
      const a = timeToken(range[1]!);
      const b = timeToken(range[2]!);
      if (a !== null && b !== null) {
        start = a;
        end = b;
        drop.add(i);
        if (keys[i - 1] === 'de' || keys[i - 1] === 'a') drop.add(i - 1);
      }
      continue;
    }
    const t = timeToken(keys[i]!);
    if (t === null) continue;
    start = t;
    drop.add(i);
    if (['a', 'de', 'vers', 'des'].includes(keys[i - 1] ?? '')) drop.add(i - 1);
    // « de 18h à 19h30 », « 18h à 19h »
    if (keys[i + 1] === 'a' && timeToken(keys[i + 2] ?? '') !== null) {
      end = timeToken(keys[i + 2]!);
      drop.add(i + 1).add(i + 2);
    }
  }
  if (start !== null && end === null) {
    // A length after the hour: « 1h », « 30min », « pendant 1h30 ».
    for (let i = 0; i < keys.length; i++) {
      if (drop.has(i)) continue;
      const d = parseDuration(keys[i]!);
      // « 14h 16h » is not 16 hours: a length after an hour is 10 h at most.
      if (d === null || d > 10 * 60) continue;
      const first = [...drop].sort((a, b) => a - b)[0]!;
      if (i < first) continue;
      durationMin = d;
      drop.add(i);
      if (keys[i - 1] === 'pendant') drop.add(i - 1);
      break;
    }
  }
  return { start, end, durationMin, rest: words.filter((_, i) => !drop.has(i)) };
}

/** « tous les jeudis », « chaque mardi » → the weekday (and the words without them). */
function takeWeekly(words: string[]): { weekday: number; rest: string[] } | null {
  const keys = words.map(fold);
  for (let i = 0; i < keys.length; i++) {
    let at = -1;
    if (keys[i] === 'chaque') at = i + 1;
    if (keys[i] === 'tous' && keys[i + 1] === 'les') at = i + 2;
    if (at < 0) continue;
    const day = WEEKDAYS.findIndex((w) => keys[at] === w || keys[at] === `${w}s`);
    if (day < 0) continue;
    return { weekday: day, rest: [...words.slice(0, i), ...words.slice(at + 1)] };
  }
  return null;
}

/** The date at the end of the words (the To-do's rule): « jeudi », « le 18 janvier »… */
function takeDate(words: string[], today: string): { day: string | null; rest: string[] } {
  for (let take = Math.min(6, words.length); take >= 1; take--) {
    const day = parseDue(words.slice(-take).join(' '), today);
    if (day) return { day, rest: words.slice(0, -take) };
  }
  return { day: null, rest: words };
}

/** Reads the bar. `today`: « YYYY-MM-DD ». */
export function parseQuick(input: string, today: string): Parsed {
  let text = input.replace(/\s+/g, ' ').trim();
  if (!text) return { kind: 'empty' };
  let category: string | null = null;
  text = text
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_all, space: string, tag: string) => {
      category ??= categoryFromTag(tag);
      return space;
    })
    .replace(/\s+/g, ' ')
    .trim();

  // « ~1h »: something to fit in, a task of the To-do (its own quick-add rules).
  if (takeDuration(text).durationMin !== null) {
    const split = splitQuickAdd(text, today);
    if (!split.title) return { kind: 'empty' };
    return {
      kind: 'task',
      title: split.title,
      due: split.due,
      durationMin: split.durationMin,
      start: split.start,
    };
  }

  let words = text.split(' ');
  const weekly = takeWeekly(words);
  if (weekly) words = weekly.rest;
  const range = weekly ? null : takeRange(words, today);
  if (range && 'error' in range) return { kind: 'error', message: range.error };
  if (range) words = range.rest;
  const times = range
    ? { start: null, end: null, durationMin: null, rest: words }
    : takeTimes(words);
  words = times.rest;
  const date = weekly || range ? { day: null, rest: words } : takeDate(words, today);
  words = date.rest;
  const title = capitalise(cleanTitle(words));
  if (!title) return { kind: 'error', message: 'Écris d’abord un titre (« dentiste jeudi 14h »).' };
  const cat = category ?? DEFAULT_CATEGORY;

  if (weekly) {
    if (times.start === null)
      return {
        kind: 'error',
        message: 'Pour la semaine type, indique une heure (« tous les mardis 20h »).',
      };
    const length =
      times.end !== null ? times.end - times.start : (times.durationMin ?? DEFAULT_EVENT_MIN);
    if (length <= 0) return { kind: 'error', message: 'La fin est avant le début.' };
    return {
      kind: 'weekly',
      title,
      weekday: weekly.weekday,
      time: timeOf(times.start),
      durationMin: length,
      category: cat,
    };
  }
  if (range)
    return { kind: 'event', title, start: range.from, end: range.to, allDay: true, category: cat };
  if (times.start !== null) {
    const day = date.day ?? today;
    const start = `${day}T${timeOf(times.start)}`;
    let length = times.durationMin ?? DEFAULT_EVENT_MIN;
    if (times.end !== null) {
      length = times.end - times.start;
      if (length <= 0) return { kind: 'error', message: 'La fin est avant le début.' };
    }
    return {
      kind: 'event',
      title,
      start,
      end: addMinutes(start, length),
      allDay: false,
      category: cat,
    };
  }
  if (date.day)
    return { kind: 'event', title, start: date.day, end: date.day, allDay: true, category: cat };
  // Nothing dated: something to fit in (a task without a date).
  return {
    kind: 'task',
    title: cleanTitle(text.split(' ')),
    due: null,
    durationMin: null,
    start: null,
  };
}

/** « Sera ajouté : Dentiste · jeu. 13 nov. 14:00–15:00 » (the preview, before validating). */
export function previewText(parsed: Parsed, today: string): string {
  switch (parsed.kind) {
    case 'event':
      return `Sera ajouté : ${parsed.title} · ${eventWhen(parsed, today)}`;
    case 'weekly':
      return `Sera ajouté à la semaine type : ${parsed.title} · chaque ${WEEKDAYS[parsed.weekday]} ${parsed.time}–${timeOf(
        (Number(parsed.time.slice(0, 2)) * 60 + Number(parsed.time.slice(3)) + parsed.durationMin) %
          (24 * 60),
      )}`;
    case 'task':
      return `Sera ajouté à la To-do${parsed.start ? '' : ' (à caser)'} : ${parsed.title}${parsed.start ? ` · prévu ${formatPlanned(parsed.start, today)}` : ''}${parsed.due ? ` · pour ${dayLabel(parsed.due, today)}` : ''}${parsed.durationMin ? ` · ${formatDuration(parsed.durationMin)}` : ''}`;
    case 'error':
      return parsed.message;
    case 'empty':
      return '';
  }
}
