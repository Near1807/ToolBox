// French dates shared by the modules (@hub/sdk/dates; v0.34.0: moved from the
// To-do to the SDK, used by the To-do and the Agenda — one code, never a copy).
// Due dates in natural French (« demain », « vendredi », « dans 3 jours »,
// « le 12 novembre »…), resolved against a given day, and estimated
// durations (« ~2h »). Pure functions, portable (also on the phone), tested
// in modules/todo/tests/dates.test.ts and duration.test.ts.
// Days are plain calendar days "YYYY-MM-DD" (no time, no time zone).

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
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
const MONTH_LABELS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const MONTH_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
const NUMBERS: Record<string, number> = {
  un: 1,
  une: 1,
  premier: 1,
  '1er': 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  'dix sept': 17,
  'dix huit': 18,
  'dix neuf': 19,
  vingt: 20,
  'vingt et un': 21,
  'vingt deux': 22,
  'vingt trois': 23,
  'vingt quatre': 24,
  'vingt cinq': 25,
  'vingt six': 26,
  'vingt sept': 27,
  'vingt huit': 28,
  'vingt neuf': 29,
  trente: 30,
  'trente et un': 31,
};
const NUMBER_WORDS = Object.keys(NUMBERS).sort((a, b) => b.length - a.length);

// --- Calendar arithmetic on "YYYY-MM-DD" (UTC dates, so no DST surprises) ---

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}
function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
export function addDays(day: string, days: number): string {
  const date = toDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}
/** 0 = Monday … 6 = Sunday. */
function weekdayIndex(day: string): number {
  return (toDate(day).getUTCDay() + 6) % 7;
}
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
function makeDay(year: number, month: number, day: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > lastDayOfMonth(year, month)) return null;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Today in the computer's local time zone, as "YYYY-MM-DD". */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`-]/g, ' ')
    .replace(/[,.;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "3", "trois", "vingt et un", "1er" → number (or null). */
function numberOf(text: string): number | null {
  if (/^\d{1,4}$/.test(text)) return Number(text);
  if (/^\d{1,2}er$/.test(text)) return Number(text.slice(0, -2));
  return NUMBERS[text] ?? null;
}

const NUMBER_PATTERN = `(\\d{1,2}(?:er)?|${NUMBER_WORDS.join('|')})`;
const WEEKDAY_PATTERN = `(${WEEKDAYS.join('|')})`;
const MONTH_PATTERN = `(${MONTHS.join('|')})`;

/** Words around a date that carry no meaning (« pour vendredi », « d'ici demain »). */
const LEAD =
  /^(?:(?:pour|d ici|avant|au plus tard|a rendre|a faire|des|a partir de|prevu|prevue)\s+)?(?:(?:le|la|ce|cette)\s+)?/;
const TRAIL = /\s+(?:matin|midi|soir|apres midi|aprem|au plus tard|dernier delai|max|maximum)$/;

/**
 * Resolves a French due date against `today` ("YYYY-MM-DD"). Returns
 * "YYYY-MM-DD", or null when the text is not a date this parser understands
 * (never guesses).
 */
export function parseDue(input: string, today: string): string | null {
  let text = normalise(input);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    const [y, m, d] = input.trim().split('-').map(Number) as [number, number, number];
    return makeDay(y, m - 1, d);
  }
  const TODAY_WORDS =
    /^(aujourd hui|ce jour|ce soir|ce matin|cet apres midi|tout a l heure|tantot|maintenant)$/;
  if (TODAY_WORDS.test(text)) return today;
  text = text.replace(TRAIL, '');
  if (TODAY_WORDS.test(text)) return today;
  text = text.replace(LEAD, '').trim();
  text = text.replace(TRAIL, '').trim();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const todayIndex = weekdayIndex(today);
  let m: RegExpMatchArray | null;

  if (TODAY_WORDS.test(text)) return today;
  if (/^demain$/.test(text)) return addDays(today, 1);
  if (/^apres demain$/.test(text)) return addDays(today, 2);

  // « vendredi », « vendredi prochain », « prochain vendredi », « vendredi en huit »,
  // « vendredi de la semaine prochaine ».
  if ((m = text.match(new RegExp(`^${WEEKDAY_PATTERN}$`)))) {
    const target = WEEKDAYS.indexOf(m[1]!);
    // « vendredi » said on a Friday means next Friday (today would be « aujourd'hui »).
    return addDays(today, (target - todayIndex + 7) % 7 || 7);
  }
  if (
    (m = text.match(
      new RegExp(
        `^(?:${WEEKDAY_PATTERN} (?:prochain|de la semaine prochaine)|prochain ${WEEKDAY_PATTERN})$`,
      ),
    ))
  ) {
    const target = WEEKDAYS.indexOf((m[1] ?? m[2])!);
    const nextMonday = addDays(today, 7 - todayIndex);
    return addDays(nextMonday, target);
  }
  if ((m = text.match(new RegExp(`^${WEEKDAY_PATTERN} en (huit|quinze)$`)))) {
    const target = WEEKDAYS.indexOf(m[1]!);
    const next = addDays(today, (target - todayIndex + 7) % 7 || 7);
    return addDays(next, m[2] === 'huit' ? 7 : 14);
  }

  // « dans 3 jours », « dans une semaine », « dans quinze jours », « dans 2 mois ».
  if ((m = text.match(new RegExp(`^dans ${NUMBER_PATTERN} (jours?|semaines?|mois)$`)))) {
    const n = numberOf(m[1]!);
    if (n === null) return null;
    if (m[2]!.startsWith('jour')) return addDays(today, n === 15 ? 14 : n === 8 ? 7 : n);
    if (m[2]!.startsWith('semaine')) return addDays(today, n * 7);
    const target = new Date(Date.UTC(year, month + n, 1));
    const day = Math.min(
      Number(today.slice(8, 10)),
      lastDayOfMonth(target.getUTCFullYear(), target.getUTCMonth()),
    );
    return makeDay(target.getUTCFullYear(), target.getUTCMonth(), day);
  }

  // Weeks, week-ends, months.
  if (/^semaine prochaine$/.test(text)) return addDays(today, 7 - todayIndex);
  if (/^(fin de (la )?semaine|semaine)$/.test(text)) {
    return todayIndex <= 4 ? addDays(today, 4 - todayIndex) : today;
  }
  if (/^(week end|weekend)$/.test(text)) {
    return todayIndex <= 5 ? addDays(today, 5 - todayIndex) : today;
  }
  if (/^(week end|weekend) prochain$/.test(text)) return addDays(today, 12 - todayIndex);
  if (/^fin (du|de) mois$/.test(text)) return makeDay(year, month, lastDayOfMonth(year, month));
  if (/^(mois prochain|debut du mois prochain)$/.test(text)) {
    return makeDay(month === 11 ? year + 1 : year, (month + 1) % 12, 1);
  }
  if (/^fin du mois prochain$/.test(text)) {
    const y = month === 11 ? year + 1 : year;
    const mo = (month + 1) % 12;
    return makeDay(y, mo, lastDayOfMonth(y, mo));
  }

  // Numeric dates: 12/11, 12/11/2026, 12-11-26.
  if ((m = text.match(/^(\d{1,2})[/ ](\d{1,2})(?:[/ ](\d{2}|\d{4}))?$/)) && input.includes('/')) {
    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (m[3]) return makeDay(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mo, d);
    const candidate = makeDay(year, mo, d);
    if (!candidate) return null;
    return candidate >= today ? candidate : makeDay(year + 1, mo, d);
  }

  // « (vendredi) 12 (novembre) (2027) », « le premier décembre ».
  m = text.match(
    new RegExp(`^(?:${WEEKDAY_PATTERN} )?${NUMBER_PATTERN}(?: ${MONTH_PATTERN})?(?: (\\d{4}))?$`),
  );
  if (
    m &&
    (m[1] ||
      m[3] ||
      input
        .trim()
        .toLowerCase()
        .match(/^(?:pour |avant |d.ici )?(?:le |la )/))
  ) {
    const d = numberOf(m[2]!);
    if (d === null || d < 1 || d > 31) return null;
    if (m[3]) {
      const mo = MONTHS.indexOf(m[3]);
      if (m[4]) return makeDay(Number(m[4]), mo, d);
      const candidate = makeDay(year, mo, d);
      if (candidate && candidate >= today) return candidate;
      return makeDay(year + 1, mo, d);
    }
    // Day of month only: this month if still to come, otherwise the next one.
    const candidate = makeDay(year, month, d);
    if (candidate && candidate >= today) return candidate;
    return makeDay(month === 11 ? year + 1 : year, (month + 1) % 12, d);
  }
  return null;
}

/** « aujourd'hui », « demain », « vendredi », « ven. 24 oct. », « hier », with the year if needed. */
export function formatDue(due: string, today: string): string {
  const diff = daysBetween(today, due);
  if (diff === 0) return 'aujourd’hui';
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  if (diff > 1 && diff < 7) return WEEKDAYS[weekdayIndex(due)]!;
  return shortDate(due, today);
}

/** "2026-10-23" → « 23/10/2026 » (typed back into a field, understood by parseDue). */
export function slashDate(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/** « ven. 24 oct. » (+ year when not this year). */
export function shortDate(day: string, today: string): string {
  const weekday = WEEKDAYS[weekdayIndex(day)]!.slice(0, 3);
  const monthShort = MONTH_SHORT[Number(day.slice(5, 7)) - 1]!;
  const year = day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`;
  return `${weekday}. ${Number(day.slice(8, 10))} ${monthShort}${year}`;
}

/** For speech: « vendredi 24 octobre » (« aujourd'hui », « demain » when close). */
export function spokenDue(due: string, today: string): string {
  const diff = daysBetween(today, due);
  if (diff === 0) return 'aujourd’hui';
  if (diff === 1) return 'demain';
  const year = due.slice(0, 4) === today.slice(0, 4) ? '' : ` ${due.slice(0, 4)}`;
  const day = Number(due.slice(8, 10));
  return `${WEEKDAYS[weekdayIndex(due)]} ${day === 1 ? '1er' : day} ${MONTH_LABELS[Number(due.slice(5, 7)) - 1]}${year}`;
}

// --- Estimated duration (« ~2h », « ~30min », « ~1h30 ») ----------------------
// Always written with « ~ » first, so it is never taken for a time of day:
// « 14h » is an hour (a meeting at 2 pm), « ~2h » is a duration (about two hours).

/** Minutes at most for an estimate (5 days of work). */
export const MAX_DURATION_MIN = 120 * 60;

/**
 * « 2h », « 2 h », « 1h30 », « 1 h 30 », « 1,5h », « 45min », « 45 min »,
 * « 90 minutes », « 2 heures » (the « ~ » before is optional here) →
 * minutes, or null when it is not a duration.
 */
export function parseDuration(input: string): number | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/^[~≈]\s*/, '')
    .replace(/\s+/g, ' ');
  let m = text.match(
    /^(\d{1,3})(?:[.,](\d))? ?(?:h|heures?)(?: ?(\d{1,2}) ?(?:min|mn|minutes?)?)?$/,
  );
  let minutes: number | null = null;
  if (m) {
    if (m[2] && m[3]) return null;
    minutes = Number(m[1]) * 60 + (m[2] ? Number(m[2]) * 6 : 0) + (m[3] ? Number(m[3]) : 0);
    if (m[3] && Number(m[3]) >= 60) return null;
  } else if ((m = text.match(/^(\d{1,4}) ?(?:min|mn|minutes?)$/))) {
    minutes = Number(m[1]);
  }
  if (minutes === null || minutes <= 0 || minutes > MAX_DURATION_MIN) return null;
  return minutes;
}

/** 120 → « ~2 h », 30 → « ~30 min », 90 → « ~1 h 30 ». */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `~${minutes} min`;
  const rest = minutes % 60;
  return `~${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}

/** « ~2h » / « ~ 1 h 30 » inside a text (with its « ~ »): where, and how long. */
const DURATION_IN_TEXT =
  /(^|\s)[~≈]\s*(\d{1,3}(?:[.,]\d)?\s?(?:h|heures?)(?:\s?\d{1,2}\s?(?:min|mn|minutes?)?)?|\d{1,4}\s?(?:min|mn|minutes?))(?=\s|$)/i;

/** Takes the « ~duration » out of a text: the rest, and the minutes (null when none). */
export function takeDuration(input: string): { text: string; durationMin: number | null } {
  const m = input.match(DURATION_IN_TEXT);
  if (!m) return { text: input, durationMin: null };
  const durationMin = parseDuration(m[2]!);
  if (durationMin === null) return { text: input, durationMin: null };
  const text = `${input.slice(0, m.index!)}${m[1]}${input.slice(m.index! + m[0].length)}`;
  return { text: text.replace(/\s+/g, ' ').trim(), durationMin };
}

/**
 * Quick add: « finir le mix #mix ~2h pour vendredi » → title « finir le mix »,
 * tags [mix], about 2 hours, due = Friday. The date must end the text;
 * nothing is guessed inside the title.
 */
export function splitQuickAdd(
  input: string,
  today: string,
): {
  title: string;
  tags: string[];
  due: string | null;
  dueText: string | null;
  durationMin: number | null;
} {
  const tags: string[] = [];
  let text = input.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_all, space: string, tag: string) => {
    tags.push(tag.toLowerCase());
    return space;
  });
  const taken = takeDuration(text);
  const durationMin = taken.durationMin;
  text = taken.text.replace(/\s+/g, ' ').trim();
  const words = text.split(' ');
  for (let take = Math.min(6, words.length - 1); take >= 1; take--) {
    const tail = words.slice(-take).join(' ');
    const due = parseDue(tail, today);
    if (due) {
      const title = words
        .slice(0, -take)
        .join(' ')
        .replace(/\s+(?:pour|avant|d’ici|d'ici|le)$/i, '');
      if (title.trim())
        return { title: title.trim(), tags: [...new Set(tags)], due, dueText: tail, durationMin };
    }
  }
  return { title: text, tags: [...new Set(tags)], due: null, dueText: null, durationMin };
}
