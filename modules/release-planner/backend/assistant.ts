// What the voice assistant may do with the release planner (MODULES.md §5.15):
// read the agenda (today, this week, late) and a track's release. Sending to
// YouTube, publishing and moving a scheduled date stay with the user: they are
// declared « sensitive » (never run, the assistant offers to open the page).
import {
  extractName,
  HttpError,
  matchByName,
  type ModuleContext,
  normaliseUtterance,
  NotFoundError,
} from '@hub/sdk/backend';
import type { Track } from '../../music-library/contract';
import type { ItemState } from './status';

export type Period = 'today' | 'week' | 'next-week' | 'next7' | 'late';

/**
 * The period said (standardised command, MODULES.md §5.15): « cette semaine »
 * is the calendar week (Monday → Sunday), « la semaine prochaine » the next
 * one, « les 7 prochains jours » a rolling week; otherwise today.
 */
export function extractPeriod(utterance: string): { period: Period } {
  const said = normaliseUtterance(utterance);
  if (/\bretard\b/.test(said) && !/\bsemaine\b/.test(said)) return { period: 'late' };
  if (/\b(?:7|sept) (?:prochains )?jours\b|\bprochains jours\b/.test(said))
    return { period: 'next7' };
  if (/\bsemaine prochaine\b|\bprochaine semaine\b/.test(said)) return { period: 'next-week' };
  if (/\bsemaine\b/.test(said)) return { period: 'week' };
  return { period: 'today' };
}

const RELEASE_PREFIXES = [
  // « où on est » : how the ear often writes « où en est ».
  /(?:quand sort|quand est-ce que sort|o[uù] (?:en|on) (?:est|sont) (?:la sortie|les sorties)|le point sur la sortie|la sortie|sortie|planning)(?![\p{L}])/iu,
];

/** A period said where a track name is expected: not a track (« les sorties de cette semaine »). */
const PERIOD_WORDS =
  /^(?:(?:de |du |d’|d')?(?:cette|la|ma) semaine|(?:la )?semaine prochaine|aujourd’hui|aujourd'hui|demain|ce mois(?:-ci)?|(?:les )?(?:7|sept) prochains jours)$/i;

/** « où en est la sortie de Aube » → « Aube ». */
export const extractRelease = (utterance: string) => {
  const track = extractName(utterance, RELEASE_PREFIXES);
  return track && !PERIOD_WORDS.test(track) ? { track } : null;
};

/** The fields of a planned element the assistant reads. */
export interface AgendaItem {
  trackId: number;
  trackTitle: string;
  label: string;
  platform: 'youtube' | 'instagram';
  date: string;
  time: string;
  status: ItemState;
  late: boolean;
}

const STATUS: Record<ItemState, string> = {
  planned: 'planifié',
  queued: 'en attente d’envoi',
  uploading: 'en cours d’envoi',
  scheduled: 'programmé sur YouTube',
  'to-schedule': 'envoyé, à programmer dans YouTube Studio',
  published: 'publié',
  failed: 'en échec',
};

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = [
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

function spokenDate(day: string, today: string): string {
  if (day === today) return 'aujourd’hui';
  const date = new Date(`${day}T00:00:00Z`);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date.getTime() === tomorrow.getTime()) return 'demain';
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday of the calendar week of `day` (YYYY-MM-DD). */
export function mondayOf(day: string): string {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

/** The days of a period: [from, to] inclusive. */
export function periodRange(period: Period, today: string): [string, string] {
  switch (period) {
    case 'week':
      return [mondayOf(today), addDays(mondayOf(today), 6)];
    case 'next-week':
      return [addDays(mondayOf(today), 7), addDays(mondayOf(today), 13)];
    case 'next7':
      return [today, addDays(today, 6)];
    default:
      return [today, today];
  }
}

/**
 * The review of some elements, in the order of the days: what already happened
 * (published; planned but not published = late), then what is still to come.
 */
export function review(items: AgendaItem[], today: string) {
  const sorted = [...items].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );
  const done = sorted.filter((i) => i.status === 'published');
  const late = sorted.filter((i) => i.status !== 'published' && (i.late || i.date < today));
  const upcoming = sorted.filter((i) => i.status !== 'published' && !(i.late || i.date < today));
  return { done, late, upcoming };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describe(item: AgendaItem, today: string) {
  const instagram = item.platform === 'instagram';
  return {
    track: item.trackTitle,
    element: item.label,
    platform: instagram ? 'Instagram' : 'YouTube',
    day: spokenDate(item.date, today),
    time: item.time,
    status:
      instagram && item.status !== 'published'
        ? 'à publier toi-même sur Instagram'
        : STATUS[item.status],
    late: item.late,
  };
}

/** « vendredi 23 octobre » (days of the review are spoken without « demain »). */
function dayName(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}`;
}

/** Short spoken review, the full list goes in the data (shown in the history). */
function reviewMessage(
  what: string,
  parts: ReturnType<typeof review>,
  today: string,
): { message: string; detail: string[] } {
  const line = (i: AgendaItem) =>
    `${dayName(i.date)} ${i.time} — ${i.label} de ${i.trackTitle} (${i.platform === 'instagram' ? 'Instagram' : 'YouTube'}) : ${describe(i, today).status}`;
  const detail = [
    ...parts.done.map((i) => `Fait · ${line(i)}`),
    ...parts.late.map((i) => `En retard · ${line(i)}`),
    ...parts.upcoming.map((i) => `À venir · ${line(i)}`),
  ];
  const total = parts.done.length + parts.late.length + parts.upcoming.length;
  if (total === 0) return { message: `Rien de prévu ${what}.`, detail };
  const said: string[] = [];
  if (parts.done.length)
    said.push(
      `${count(parts.done.length, 'élément publié', 'éléments publiés')} (${parts.done
        .slice(0, 3)
        .map(
          (i) =>
            `${i.label} ${i.platform === 'instagram' ? 'Instagram' : 'YouTube'} ${dayName(i.date)}`,
        )
        .join(', ')}${parts.done.length > 3 ? '…' : ''})`,
    );
  if (parts.late.length) said.push(`${count(parts.late.length, 'en retard', 'en retard')}`);
  if (parts.upcoming.length) {
    const youtube = parts.upcoming.filter((i) => i.platform === 'youtube').length;
    const instagram = parts.upcoming.length - youtube;
    const next = parts.upcoming[0]!;
    said.push(
      `à venir : ${[youtube ? `${youtube} sur YouTube` : '', instagram ? `${instagram} à publier sur Instagram` : ''].filter(Boolean).join(' et ')}, le prochain ${spokenDate(next.date, today)} à ${next.time} (${next.label} de ${next.trackTitle})`,
    );
  }
  return {
    message: `${what.charAt(0).toUpperCase()}${what.slice(1)} : ${said.join(' ; ')}.`,
    detail,
  };
}

function sentence(items: ReturnType<typeof describe>[]): string {
  const parts = items.map(
    (i) =>
      `${i.element} de ${i.track} sur ${i.platform} (${i.day} à ${i.time}, ${i.status}${i.late ? ', en retard' : ''})`,
  );
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(' ; ')} et ${parts.at(-1)}`;
}

export function registerAssistantActions(
  ctx: ModuleContext,
  source: {
    items: () => AgendaItem[];
    today: () => string;
    tracks: () => Track[];
    releaseOf: (trackId: number) => { date: string; items: AgendaItem[] } | null;
  },
): void {
  ctx.assistant.define({
    name: 'agenda',
    label:
      'Planning d’une période (aujourd’hui, cette semaine, semaine prochaine, 7 jours, retards)',
    description:
      'Le planning de sortie d’une période. period : « today » (aujourd’hui, et ce qui est en retard), « week » (cette semaine du calendrier, lundi → dimanche : ce qui est publié, en retard, puis à venir), « next-week » (semaine prochaine du calendrier), « next7 » (les 7 prochains jours), « late » (en retard seulement).',
    parameters: {
      period: {
        type: 'string',
        description: 'Quelle période',
        enum: ['today', 'week', 'next-week', 'next7', 'late'],
      },
    },
    examples: [
      'qu’est-ce que je dois publier aujourd’hui',
      'qu’est-ce qui sort aujourd’hui',
      'qu’est-ce que je publie cette semaine',
      'quel est le planning de cette semaine',
      'où en sont les sorties de cette semaine',
      'qu’est-ce qui est fait et qu’est-ce qui reste cette semaine',
      'le point sur la semaine',
      'le planning de la semaine prochaine',
      'qu’est-ce que je publie la semaine prochaine',
      'qu’est-ce qui sort les 7 prochains jours',
      'qu’est-ce qui est en retard dans le planning',
      'quelles publications sont en retard',
    ],
    extract: extractPeriod,
    risk: 'read',
    run: (params) => {
      const today = source.today();
      const period = (String(params.period ?? 'today') as Period) ?? 'today';
      const all = source.items();
      const late = all.filter((i) => i.late && i.date <= today && i.status !== 'published');
      if (period === 'late' || period === 'today') {
        const chosen =
          period === 'late'
            ? late
            : all.filter((i) => i.date === today || (i.late && i.date < today));
        chosen.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        const list = chosen.map((i) => describe(i, today));
        const what = period === 'late' ? 'en retard' : 'aujourd’hui';
        const message =
          list.length === 0
            ? `Rien à publier ${what}${period !== 'late' && late.length ? `, mais ${late.length} élément(s) en retard` : ''}.`
            : `${list.length} élément(s) ${what} : ${sentence(list.slice(0, 6))}${list.length > 6 ? ', etc.' : ''}.`;
        return { message, data: { period, items: list.slice(0, 20), lateCount: late.length } };
      }
      const [from, to] = periodRange(period, today);
      const parts = review(
        all.filter((i) => i.date >= from && i.date <= to),
        today,
      );
      const what =
        period === 'week'
          ? 'cette semaine'
          : period === 'next-week'
            ? 'la semaine prochaine'
            : 'les 7 prochains jours';
      const { message, detail } = reviewMessage(what, parts, today);
      return { message, data: { period, from, to, detail } };
    },
  });

  ctx.assistant.define({
    name: 'release',
    label: 'Où en est la sortie d’un morceau',
    description:
      'Où en est la sortie d’un morceau : date de sortie et état de chaque élément (vidéo, Shorts, Reels, post).',
    parameters: { track: { type: 'string', description: 'Nom du morceau, même approximatif' } },
    required: ['track'],
    examples: [
      'où en est la sortie de Aube',
      'quand sort Aube',
      'la sortie du morceau Aube',
      'le point sur la sortie de Aube',
    ],
    extract: extractRelease,
    risk: 'read',
    run: (params) => {
      const match = matchByName(source.tracks(), String(params.track), (t) => [
        t.title,
        ...(t.nicknames ?? []),
      ]);
      if (match.kind === 'none')
        throw new NotFoundError(
          'track',
          'le morceau',
          String(params.track),
          match.suggestions.map((t) => t.title),
        );
      if (match.kind === 'ambiguous') {
        throw new HttpError(
          409,
          `Plusieurs morceaux correspondent : ${match.items
            .slice(0, 4)
            .map((t) => t.title)
            .join(', ')}. Lequel ?`,
        );
      }
      const track = match.item;
      const release = source.releaseOf(track.id);
      if (!release)
        return {
          message: `${track.title} n’a pas encore de sortie planifiée.`,
          data: { track: track.title, planned: false },
        };
      const today = source.today();
      const parts = review(release.items, today);
      const { message, detail } = reviewMessage(`sortie de ${track.title}`, parts, today);
      return {
        message: `${message} Jour J : ${spokenDate(release.date, today)}.`,
        data: { track: track.title, releaseDate: release.date, detail },
      };
    },
  });

  // Declared so the assistant knows them and says it does not do them.
  ctx.assistant.define({
    name: 'upload',
    description: 'Envoyer une vidéo ou un Short sur YouTube, ou le programmer.',
    risk: 'sensitive',
    page: '',
  });
  ctx.assistant.define({
    name: 'move',
    description: 'Changer la date ou l’heure d’une sortie ou d’un élément programmé.',
    risk: 'sensitive',
    page: '',
  });
  ctx.assistant.define({
    name: 'publish',
    description: 'Publier ou marquer comme publié un élément (YouTube ou Instagram).',
    risk: 'sensitive',
    page: '',
  });
}
