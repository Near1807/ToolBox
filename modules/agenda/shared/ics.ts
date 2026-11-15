// v0.37.0: reading an iCalendar file (.ics, RFC 5545), locally, nothing
// online. What it handles: folded lines, escapes (\n \, \; \\), several
// values, time zones (TZID through the system's time-zone data, else the
// file's own VTIMEZONE; UTC « Z »; floating times), whole days (VALUE=DATE),
// DTEND or DURATION, repetitions FREQ=DAILY / WEEKLY with INTERVAL, COUNT,
// UNTIL, BYDAY (several days) and WKST, RDATE, EXDATE, RECURRENCE-ID (one
// occurrence changed) and STATUS:CANCELLED. Repetitions are unfolded into
// occurrences, each at the local time of this device. Anything else (a
// monthly rule…) is not guessed: that event is listed in the errors, with
// its line, and nothing is written for it.
import { addDays, daysBetween, weekday } from './time';
import {
  clip,
  type ImportError,
  type ImportItem,
  noteOf,
  type ParsedFile,
  splitTitle,
} from './import-item';

/** The file itself cannot be read: a clear message, nothing is written. */
export class ImportFileError extends Error {}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
  line: number;
}
interface Component {
  name: string;
  props: Prop[];
  children: Component[];
  line: number;
}

/** Folded lines joined again (a line starting with a space or a tab continues the one before). */
function logicalLines(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const raw = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  raw.forEach((l, i) => {
    if ((l.startsWith(' ') || l.startsWith('\t')) && out.length)
      out[out.length - 1]!.text += l.slice(1);
    else if (l.trim()) out.push({ text: l, line: i + 1 });
  });
  return out;
}

function parseLine(text: string, line: number): Prop {
  let i = 0;
  while (i < text.length && text[i] !== ';' && text[i] !== ':') i++;
  const name = text.slice(0, i).toUpperCase();
  const params: Record<string, string> = {};
  while (text[i] === ';') {
    i++;
    const eq = text.indexOf('=', i);
    if (eq < 0) break;
    const key = text.slice(i, eq).toUpperCase();
    i = eq + 1;
    let value: string;
    if (text[i] === '"') {
      const close = text.indexOf('"', i + 1);
      value = text.slice(i + 1, close < 0 ? text.length : close);
      i = close < 0 ? text.length : close + 1;
    } else {
      const start = i;
      while (i < text.length && text[i] !== ';' && text[i] !== ':') i++;
      value = text.slice(start, i);
    }
    params[key] = value;
  }
  if (text[i] !== ':') throw new Error('ligne illisible (« : » manquant)');
  return { name, params, value: text.slice(i + 1), line };
}

function parseComponents(text: string, bad: ImportError[]): Component {
  const lines = logicalLines(text);
  if (!/^BEGIN:VCALENDAR\s*$/i.test(lines[0]?.text ?? ''))
    throw new ImportFileError(
      'Ce fichier n’est pas un calendrier ICS (il doit commencer par « BEGIN:VCALENDAR »).',
    );
  const root: Component = { name: 'ROOT', props: [], children: [], line: 0 };
  const stack: Component[] = [root];
  for (const { text: l, line } of lines) {
    let prop: Prop;
    try {
      prop = parseLine(l, line);
    } catch (err) {
      // One unreadable line is listed and left out; the rest of the file is read.
      bad.push({ line, reason: `${(err as Error).message}, ligne ignorée` });
      continue;
    }
    if (prop.name === 'BEGIN') {
      const c: Component = { name: prop.value.trim().toUpperCase(), props: [], children: [], line };
      stack[stack.length - 1]!.children.push(c);
      stack.push(c);
    } else if (prop.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else stack[stack.length - 1]!.props.push(prop);
  }
  const cal = root.children.find((c) => c.name === 'VCALENDAR');
  if (!cal)
    throw new ImportFileError(
      'Ce fichier n’est pas un calendrier ICS (aucune ligne « BEGIN:VCALENDAR »).',
    );
  return cal;
}

/** TEXT value: \n → new line, \, → , and \; → ; ; any other « \x » → x. */
export function unescapeText(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Values separated by commas that are not escaped. */
function splitValues(value: string): string[] {
  return value
    .split(/(?<!\\),/)
    .map((v) => unescapeText(v).trim())
    .filter(Boolean);
}

// --- Times -------------------------------------------------------------------

/** A date or date-time as written: a wall time in a zone, in UTC, or floating. */
interface Moment {
  day: string;
  /** « HH:MM:SS », null for a whole day. */
  time: string | null;
  utc: boolean;
  /** TZID, null when UTC or floating. */
  tz: string | null;
}

const DATE_VALUE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME_VALUE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

function parseMoment(value: string, tzid: string | undefined, dateOnly: boolean): Moment {
  const v = value.trim();
  const d = DATE_VALUE.exec(v);
  if (d) return { day: `${d[1]}-${d[2]}-${d[3]}`, time: null, utc: false, tz: null };
  const t = DATE_TIME_VALUE.exec(v);
  if (!t || dateOnly) throw new Error(`date illisible : « ${v} »`);
  return {
    day: `${t[1]}-${t[2]}-${t[3]}`,
    time: `${t[4]}:${t[5]}:${t[6]}`,
    utc: t[7] === 'Z',
    tz: t[7] === 'Z' ? null : tzid ? tzid.replace(/^\//, '') : null,
  };
}

const wallMs = (day: string, time: string) => Date.parse(`${day}T${time}Z`);

const pad = (n: number) => String(n).padStart(2, '0');
/** An instant as a local date-time of this device. */
function localOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const formats = new Map<string, Intl.DateTimeFormat | null>();
/** Offset of `tz` at instant `ms`, in minutes (zone − UTC), by the system's data; null if unknown. */
function intlOffset(tz: string, ms: number): number | null {
  let f = formats.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      f = null;
    }
    formats.set(tz, f);
  }
  if (!f) return null;
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** A VTIMEZONE of the file (used when the system does not know its TZID). */
interface Observance {
  start: number;
  offsetFrom: number;
  offsetTo: number;
  month: number | null;
  /** « -1SU », « 2SU »… */
  byDay: string | null;
  time: string;
}

const offsetMinutes = (v: string) => {
  const m = /^([+-])(\d{2})(\d{2})/.exec(v.trim());
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};

function readZones(cal: Component): Map<string, Observance[]> {
  const zones = new Map<string, Observance[]>();
  for (const z of cal.children.filter((c) => c.name === 'VTIMEZONE')) {
    const id = z.props.find((p) => p.name === 'TZID')?.value.trim();
    if (!id) continue;
    const obs: Observance[] = [];
    for (const o of z.children) {
      const get = (n: string) => o.props.find((p) => p.name === n)?.value ?? '';
      try {
        const start = parseMoment(get('DTSTART'), undefined, false);
        const rule = Object.fromEntries(
          get('RRULE')
            .split(';')
            .filter(Boolean)
            .map((x) => x.split('=') as [string, string]),
        );
        obs.push({
          start: wallMs(start.day, start.time ?? '00:00:00'),
          offsetFrom: offsetMinutes(get('TZOFFSETFROM')),
          offsetTo: offsetMinutes(get('TZOFFSETTO')),
          month: rule.BYMONTH ? Number(rule.BYMONTH) : null,
          byDay: rule.BYDAY ?? null,
          time: start.time ?? '00:00:00',
        });
      } catch {
        // An observance that cannot be read is left out.
      }
    }
    if (obs.length) zones.set(id.replace(/^\//, ''), obs);
  }
  return zones;
}

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** The day of « -1SU » (last Sunday) or « 2SU » in a month. */
function nthWeekday(year: number, month: number, byDay: string): string | null {
  const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay);
  if (!m) return null;
  const n = Number(m[1] ?? 1);
  const target = DAY_CODES.indexOf(m[2]!);
  const first = `${year}-${pad(month)}-01`;
  const last = addDays(
    `${month === 12 ? year + 1 : year}-${pad(month === 12 ? 1 : month + 1)}-01`,
    -1,
  );
  if (n > 0) return addDays(first, ((target - weekday(first) + 7) % 7) + 7 * (n - 1));
  return addDays(last, -((weekday(last) - target + 7) % 7) - 7 * (-n - 1));
}

/** Offset at a wall time of a VTIMEZONE: the latest change before it. */
function zoneOffset(obs: Observance[], wall: number): number {
  let best: { at: number; offset: number } | null = null;
  const year = new Date(wall).getUTCFullYear();
  for (const o of obs) {
    const onsets: number[] = [];
    if (o.month && o.byDay) {
      for (const y of [year - 1, year]) {
        const day = nthWeekday(y, o.month, o.byDay);
        if (day) onsets.push(wallMs(day, o.time));
      }
    } else onsets.push(o.start);
    for (const at of onsets)
      if (at >= o.start && at <= wall && (!best || at > best.at)) best = { at, offset: o.offsetTo };
  }
  if (best) return best.offset;
  const first = [...obs].sort((a, b) => a.start - b.start)[0]!;
  return first.offsetFrom;
}

/** Time zones of one file: the system's data first, the file's VTIMEZONE otherwise. */
class Zones {
  constructor(private readonly own: Map<string, Observance[]>) {}
  /** The instant of a wall time of `tz`. */
  toInstant(wall: number, tz: string): number {
    if (intlOffset(tz, wall) !== null) {
      const o1 = intlOffset(tz, wall)!;
      const guess = wall - o1 * 60_000;
      const o2 = intlOffset(tz, guess)!;
      return o2 === o1 ? guess : wall - o2 * 60_000;
    }
    const obs = this.own.get(tz);
    if (!obs) throw new Error(`fuseau horaire inconnu : « ${tz} »`);
    return wall - zoneOffset(obs, wall) * 60_000;
  }
  /** Comparable instant of a moment (a floating time: its wall time). */
  instant(m: Moment): number {
    const wall = wallMs(m.day, m.time ?? '00:00:00');
    if (m.time === null || (!m.utc && !m.tz)) return wall;
    return m.utc ? wall : this.toInstant(wall, m.tz!);
  }
  /** Local date-time (« YYYY-MM-DDTHH:mm ») of a moment with a time. */
  local(m: Moment): string {
    if (!m.utc && !m.tz) return `${m.day}T${m.time!.slice(0, 5)}`;
    return localOf(this.instant(m));
  }
}

// --- Durations and repetitions ------------------------------------------------

function parseDuration(value: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!m) throw new Error(`durée illisible : « ${value} »`);
  const minutes =
    Number(m[2] ?? 0) * 7 * 1440 +
    Number(m[3] ?? 0) * 1440 +
    Number(m[4] ?? 0) * 60 +
    Number(m[5] ?? 0) +
    Math.round(Number(m[6] ?? 0) / 60);
  return m[1] === '-' ? -minutes : minutes;
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY';
  interval: number;
  count: number | null;
  until: Moment | null;
  byDay: number[] | null;
  wkst: number;
}

/** A repetition rule this import understands, or an error naming what it does not. */
function parseRule(value: string, tzid: string | undefined): Rule {
  const parts = new Map(
    value
      .split(';')
      .filter(Boolean)
      .map((p) => {
        const [k, v] = p.split('=');
        return [(k ?? '').toUpperCase(), v ?? ''] as const;
      }),
  );
  const unsupported = () => new Error(`répétition non prise en charge : « RRULE:${value} »`);
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY') throw unsupported();
  for (const k of parts.keys())
    if (!['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'].includes(k)) throw unsupported();
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null;
  if (!(Number.isInteger(interval) && interval >= 1)) throw unsupported();
  if (count !== null && !(Number.isInteger(count) && count >= 1)) throw unsupported();
  let byDay: number[] | null = null;
  if (parts.has('BYDAY')) {
    byDay = parts
      .get('BYDAY')!
      .split(',')
      .map((d) => DAY_CODES.indexOf(d.trim().toUpperCase()));
    if (byDay.some((d) => d < 0)) throw unsupported();
  }
  const wkst = parts.has('WKST') ? DAY_CODES.indexOf(parts.get('WKST')!.toUpperCase()) : 0;
  if (wkst < 0) throw unsupported();
  return {
    freq,
    interval,
    count,
    until: parts.has('UNTIL') ? parseMoment(parts.get('UNTIL')!, tzid, false) : null,
    byDay,
    wkst,
  };
}

/** Occurrences at most per event (a rule without end stops at the horizon). */
export const MAX_OCCURRENCES = 2000;

/**
 * The days of a rule from its first day (counted as the first occurrence,
 * like RFC 5545 says), up to COUNT, UNTIL (`beyond(day)` true), or `horizon`.
 */
function ruleDays(
  first: string,
  rule: Rule,
  beyond: (day: string) => boolean,
  horizon: string,
): { days: string[]; truncated: boolean } {
  const days = [first];
  const done = () => rule.count !== null && days.length >= rule.count;
  if (done()) return { days, truncated: false };
  const endless = rule.count === null && rule.until === null;
  const stop = (day: string) => beyond(day) || (endless && day > horizon);
  if (rule.freq === 'DAILY') {
    for (let k = 1; ; k++) {
      const day = addDays(first, k * rule.interval);
      if (stop(day)) return { days, truncated: false };
      if (rule.byDay && !rule.byDay.includes(weekday(day))) continue;
      days.push(day);
      if (done()) return { days, truncated: false };
      if (days.length >= MAX_OCCURRENCES) return { days, truncated: true };
    }
  }
  const order = (d: number) => (d - rule.wkst + 7) % 7;
  const weekStart = addDays(first, -order(weekday(first)));
  const wanted = [...new Set(rule.byDay ?? [weekday(first)])].sort((a, b) => order(a) - order(b));
  for (let w = 0; ; w += rule.interval) {
    for (const d of wanted) {
      const day = addDays(weekStart, 7 * w + order(d));
      if (day <= first) continue;
      if (stop(day)) return { days, truncated: false };
      days.push(day);
      if (done()) return { days, truncated: false };
      if (days.length >= MAX_OCCURRENCES) return { days, truncated: true };
    }
  }
}

// --- Events --------------------------------------------------------------------

const prop = (c: Component, name: string) => c.props.find((p) => p.name === name);
const text = (c: Component, name: string) => {
  const p = prop(c, name);
  return p ? unescapeText(p.value) : '';
};

export interface IcsOptions {
  /** Last day a rule without end is unfolded to (an import is about the year ahead). */
  horizon: string;
}

/**
 * Reads a whole .ics file: one item per event or occurrence, and the events
 * that could not be read (with their line). Throws ImportFileError when the
 * file itself is not a calendar.
 */
export function parseIcs(input: string, options: IcsOptions): ParsedFile {
  const errors: ImportError[] = [];
  const cal = parseComponents(input, errors);
  const zones = new Zones(readZones(cal));
  const calendarName = unescapeText(prop(cal, 'X-WR-CALNAME')?.value ?? '').trim() || null;
  const items: ImportItem[] = [];
  const events = cal.children.filter((c) => c.name === 'VEVENT');
  if (!events.length)
    throw new ImportFileError('Ce calendrier est vide : il ne contient aucun événement (VEVENT).');

  // Occurrences changed one by one (RECURRENCE-ID), by UID and original instant.
  const overrides = new Map<string, Component>();
  const recurrenceOf = (e: Component) => {
    const r = prop(e, 'RECURRENCE-ID');
    if (!r) return null;
    return parseMoment(r.value, r.params.TZID, r.params.VALUE === 'DATE');
  };
  for (const e of events) {
    const r = recurrenceOf(e);
    const uid = text(e, 'UID').trim();
    if (r && uid) {
      try {
        overrides.set(`${uid}|${zones.instant(r)}`, e);
      } catch (err) {
        errors.push({ line: e.line, reason: (err as Error).message });
      }
    }
  }
  const seen = new Set<string>();
  const masters = new Set<string>();

  const categoriesOf = (e: Component) =>
    e.props.filter((p) => p.name === 'CATEGORIES').flatMap((p) => splitValues(p.value));

  /** One occurrence of `e` starting at `start`, its length from the event. */
  const itemOf = (
    e: Component,
    key: string,
    start: Moment,
    length: { days: number } | { minutes: number },
  ): ImportItem => {
    const summary = text(e, 'SUMMARY').trim();
    const description = text(e, 'DESCRIPTION');
    const location = text(e, 'LOCATION').trim();
    const categories = categoriesOf(e);
    const { title, code } = splitTitle(summary || '(sans titre)');
    const original: Record<string, string> = {};
    for (const name of ['UID', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'CATEGORIES']) {
      const p = e.props.filter((x) => x.name === name);
      if (p.length) original[name] = p.map((x) => unescapeText(x.value)).join(', ');
    }
    let s: string;
    let end: string;
    if ('days' in length) {
      s = start.day;
      end = addDays(start.day, Math.max(1, length.days) - 1);
    } else {
      s = zones.local(start);
      end =
        !start.utc && !start.tz
          ? new Date(wallMs(start.day, start.time!) + length.minutes * 60_000)
              .toISOString()
              .slice(0, 16)
          : localOf(zones.instant(start) + length.minutes * 60_000);
    }
    return {
      key,
      line: e.line,
      title,
      code,
      start: s,
      end,
      allDay: 'days' in length,
      location: location ? clip(location) : null,
      note: noteOf(description, summary),
      rawCategory: categories[0] ?? '',
      original,
    };
  };
  for (const e of events) {
    try {
      const status = text(e, 'STATUS').trim().toUpperCase();
      const isOverride = Boolean(prop(e, 'RECURRENCE-ID'));
      const uidText = text(e, 'UID').trim();
      const dt = prop(e, 'DTSTART');
      if (!dt) throw new Error('début (DTSTART) manquant');
      const start = parseMoment(dt.value, dt.params.TZID, dt.params.VALUE === 'DATE');
      const allDay = start.time === null;
      // Length: DTEND, else DURATION, else one day / one hour (documented).
      let length: { days: number } | { minutes: number };
      const dtEnd = prop(e, 'DTEND');
      const duration = prop(e, 'DURATION');
      if (dtEnd) {
        const end = parseMoment(dtEnd.value, dtEnd.params.TZID, dtEnd.params.VALUE === 'DATE');
        if (allDay) length = { days: daysBetween(start.day, end.day) };
        else {
          const minutes = Math.round((zones.instant(end) - zones.instant(start)) / 60_000);
          length = { minutes };
        }
      } else if (duration) {
        const minutes = parseDuration(duration.value);
        length = allDay ? { days: Math.round(minutes / 1440) } : { minutes };
      } else length = allDay ? { days: 1 } : { minutes: 60 };
      if ('minutes' in length && length.minutes <= 0) throw new Error('la fin est avant le début');
      if ('days' in length && length.days <= 0) throw new Error('la fin est avant le début');
      const uid = uidText || `sans-uid:${text(e, 'SUMMARY').trim()}|${dt.value.trim()}`;

      if (isOverride) {
        // One occurrence changed: keyed by its original day.
        if (status === 'CANCELLED') continue;
        const r = recurrenceOf(e)!;
        const day = r.time === null ? r.day : zones.local(r).slice(0, 10);
        const key = `${uid}#${day.replaceAll('-', '')}`;
        if (seen.has(key)) throw new Error(`occurrence en double (${key})`);
        seen.add(key);
        items.push(itemOf(e, key, start, length));
        continue;
      }
      if (masters.has(uid)) throw new Error(`identifiant (UID) en double : « ${uid} »`);
      masters.add(uid);
      if (status === 'CANCELLED') continue;

      const ruleProp = prop(e, 'RRULE');
      const rdates = e.props
        .filter((p) => p.name === 'RDATE')
        .flatMap((p) =>
          p.value.split(',').map((v) => parseMoment(v, p.params.TZID, p.params.VALUE === 'DATE')),
        );
      if (!ruleProp && !rdates.length) {
        if (seen.has(uid)) throw new Error(`identifiant (UID) en double : « ${uid} »`);
        seen.add(uid);
        items.push(itemOf(e, uid, start, length));
        continue;
      }
      const starts: Moment[] = [];
      if (ruleProp) {
        const rule = parseRule(ruleProp.value, dt.params.TZID);
        const beyond = (day: string) => {
          if (!rule.until) return false;
          if (rule.until.time === null || allDay) return day > rule.until.day;
          return zones.instant({ ...start, day }) > zones.instant(rule.until);
        };
        const { days, truncated } = ruleDays(start.day, rule, beyond, options.horizon);
        if (truncated)
          errors.push({
            line: e.line,
            reason: `répétition arrêtée après ${MAX_OCCURRENCES} occurrences (« ${text(e, 'SUMMARY').trim()} »)`,
          });
        for (const day of days) starts.push({ ...start, day });
      } else starts.push(start);
      starts.push(
        ...rdates.map((r) => (r.time === null && !allDay ? { ...start, day: r.day } : r)),
      );
      const excluded = new Set(
        e.props
          .filter((p) => p.name === 'EXDATE')
          .flatMap((p) =>
            p.value.split(',').map((v) => parseMoment(v, p.params.TZID, p.params.VALUE === 'DATE')),
          )
          .map((x) => (x.time === null ? `d:${x.day}` : `t:${zones.instant(x)}`)),
      );
      for (const s of starts) {
        if (
          excluded.has(`d:${s.day}`) ||
          (s.time !== null && excluded.has(`t:${zones.instant(s)}`))
        )
          continue;
        if (overrides.has(`${uid}|${zones.instant(s)}`)) continue;
        const day = s.time === null ? s.day : zones.local(s).slice(0, 10);
        const key = `${uid}#${day.replaceAll('-', '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(itemOf(e, key, s, length));
      }
    } catch (err) {
      errors.push({ line: e.line, reason: (err as Error).message });
    }
  }
  items.sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
  return { calendarName, items, errors };
}
