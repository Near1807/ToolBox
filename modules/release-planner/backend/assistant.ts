// What the voice assistant may do with the release planner (MODULES.md §5.15):
// read the agenda (today, this week, late) and a track's release. Sending to
// YouTube, publishing and moving a scheduled date stay with the user: they are
// declared « sensitive » (never run, the assistant offers to open the page).
import {
  extractName,
  HttpError,
  matchByName,
  normaliseUtterance,
  type ModuleContext,
} from '@hub/sdk/backend';
import type { Track } from '../../music-library/contract';
import type { ItemState } from './status';

/** « en retard », « cette semaine », otherwise today (standardised command, MODULES.md §5.15). */
export function extractPeriod(utterance: string): { period: 'today' | 'week' | 'late' } {
  const said = normaliseUtterance(utterance);
  if (/\bretard\b/.test(said)) return { period: 'late' };
  if (/\bsemaine\b|\b7 jours\b|\bsept jours\b|\bprochains jours\b/.test(said))
    return { period: 'week' };
  return { period: 'today' };
}

const RELEASE_PREFIXES = [
  /(?:quand sort|quand est-ce que sort|où en est la sortie|ou en est la sortie|la sortie|sortie|planning)(?![\p{L}])/iu,
];

/** « où en est la sortie de Aube » → « Aube ». */
export const extractRelease = (utterance: string) => {
  const track = extractName(utterance, RELEASE_PREFIXES);
  return track ? { track } : null;
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
    description:
      'Ce qu’il faut publier : period « today » (aujourd’hui, et ce qui est en retard), « week » (7 prochains jours), « late » (en retard seulement). Dit pour chaque élément (vidéo, Short, Reel, post) la plateforme, l’heure et l’état (programmé sur YouTube, à publier soi-même sur Instagram…).',
    parameters: {
      period: { type: 'string', description: 'Quelle période', enum: ['today', 'week', 'late'] },
    },
    examples: [
      'qu’est-ce que je dois publier aujourd’hui',
      'qu’est-ce qui sort aujourd’hui',
      'qu’est-ce que je publie cette semaine',
      'le planning de la semaine',
      'qu’est-ce qui est en retard dans le planning',
      'quelles publications sont en retard',
    ],
    extract: extractPeriod,
    risk: 'read',
    run: (params) => {
      const today = source.today();
      const period = String(params.period ?? 'today');
      const all = source.items();
      const late = all.filter((i) => i.late && i.date <= today);
      const chosen =
        period === 'late'
          ? late
          : period === 'week'
            ? all.filter((i) => i.date >= today && i.date <= addDays(today, 7))
            : all.filter((i) => i.date === today || (i.late && i.date < today));
      chosen.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
      const list = chosen.map((i) => describe(i, today));
      const what =
        { today: 'aujourd’hui', week: 'dans les 7 prochains jours', late: 'en retard' }[period] ??
        'aujourd’hui';
      const message =
        list.length === 0
          ? `Rien à publier ${what}${period !== 'late' && late.length ? `, mais ${late.length} élément(s) en retard` : ''}.`
          : `${list.length} élément(s) ${what} : ${sentence(list.slice(0, 6))}${list.length > 6 ? ', etc.' : ''}.`;
      return { message, data: { items: list.slice(0, 20), lateCount: late.length } };
    },
  });

  ctx.assistant.define({
    name: 'release',
    description:
      'Où en est la sortie d’un morceau : date de sortie et état de chaque élément (vidéo, Shorts, Reels, post).',
    parameters: { track: { type: 'string', description: 'Nom du morceau, même approximatif' } },
    required: ['track'],
    examples: ['où en est la sortie de Aube', 'quand sort Aube', 'la sortie du morceau Aube'],
    extract: extractRelease,
    risk: 'read',
    run: (params) => {
      const match = matchByName(source.tracks(), String(params.track), (t) => t.title);
      if (match.kind === 'none')
        throw new HttpError(404, `Aucun morceau ne s’appelle « ${String(params.track)} ».`);
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
      const list = release.items.map((i) => describe(i, today));
      const published = list.filter((i) => i.status === 'publié').length;
      return {
        message: `Sortie de ${track.title} : ${spokenDate(release.date, today)}. ${published} élément(s) publié(s) sur ${list.length}.`,
        data: { track: track.title, releaseDate: release.date, items: list },
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
