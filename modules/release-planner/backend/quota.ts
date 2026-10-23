// YouTube quota. Every project has a daily allowance, reset at midnight
// Pacific time. In October 2026 YouTube is moving uploads to a quota bucket of
// their own (they used to cost 1,600 of the 10,000 daily units, i.e. 6 uploads
// a day); the exact limits are shown in Google Cloud > APIs > Quotas. The app
// therefore counts uploads and other calls separately, with prudent defaults
// the user can raise (settings), and treats a "quota exceeded" answer as the
// end of the day whatever its own count says. See the module README.
import { nextQuotaReset, quotaDay } from './time';

/** Units of the calls other than uploads (developers.google.com/youtube/v3/determine_quota_cost). */
export const UNIT_COST = {
  list: 1,
  update: 50,
  thumbnail: 50,
  playlistInsert: 50,
  delete: 50,
} as const;

/** Units kept for what follows an upload (thumbnail + playlist). */
export const UNITS_PER_UPLOAD = UNIT_COST.thumbnail + UNIT_COST.playlistInsert;

export interface QuotaLimits {
  uploadsPerDay: number;
  unitsPerDay: number;
}

export interface QuotaUsage {
  /** Quota day (YYYY-MM-DD, Pacific time). */
  day: string;
  uploads: number;
  /** Every unit spent this day: the Planning's and the other modules' (same Google project). */
  units: number;
  /** The Planning's own units (follow-ups of the uploads, updates, lists). */
  ownUnits?: number;
  /** Units of the other modules, by module id. */
  others?: Record<string, number>;
  /** YouTube answered "quota exceeded" this day. */
  exhausted: boolean;
  /** Who got that answer first. */
  exhaustedBy?: string | null;
}

const MODULE_NAMES: Record<string, string> = {
  'release-planner': 'le Planning',
  'youtube-stats': 'Stats YouTube',
};

/** « Aujourd’hui : 3 envoi(s) du Planning et 300 unités, 12 unités pour Stats YouTube. » */
export function quotaOrigin(usage: QuotaUsage): string {
  const parts = [
    `${usage.uploads} envoi(s) du Planning et ${usage.ownUnits ?? usage.units} unité(s) pour leurs suites`,
    ...Object.entries(usage.others ?? {})
      .filter(([, units]) => units > 0)
      .map(([module, units]) => `${units} unité(s) pour ${MODULE_NAMES[module] ?? module}`),
  ];
  const by = usage.exhaustedBy
    ? ` Quota épuisé lors d’un appel de ${MODULE_NAMES[usage.exhaustedBy] ?? usage.exhaustedBy}.`
    : '';
  return `Consommation du jour : ${parts.join(', ')}.${by}`;
}

export function canUpload(usage: QuotaUsage, limits: QuotaLimits): boolean {
  return (
    !usage.exhausted &&
    usage.uploads < limits.uploadsPerDay &&
    usage.units + UNITS_PER_UPLOAD <= limits.unitsPerDay
  );
}

export interface UploadSlot {
  itemId: number;
  /** Quota day of the upload. */
  day: string;
  /** When the upload can start (now, or a coming quota reset). */
  startsAt: Date;
  /** The upload would start after the planned publication: it will go out late. */
  late: boolean;
}

/**
 * Spreads the waiting uploads over the quota days: earliest publication
 * first, as many per day as the quota allows, the rest on the next days.
 */
export function planUploads(
  queue: { itemId: number; scheduledAt: string }[],
  usage: QuotaUsage,
  limits: QuotaLimits,
  now: Date,
): UploadSlot[] {
  const perDay = Math.max(
    1,
    Math.min(limits.uploadsPerDay, Math.floor(limits.unitsPerDay / Math.max(1, UNITS_PER_UPLOAD))),
  );
  const today = quotaDay(now);
  let day = today;
  let startsAt = now;
  let left =
    usage.day === today && usage.exhausted
      ? 0
      : Math.max(
          0,
          Math.min(
            limits.uploadsPerDay - (usage.day === today ? usage.uploads : 0),
            Math.floor(
              (limits.unitsPerDay - (usage.day === today ? usage.units : 0)) / UNITS_PER_UPLOAD,
            ),
          ),
        );
  return [...queue]
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0))
    .map((entry) => {
      while (left <= 0) {
        startsAt = nextQuotaReset(startsAt);
        day = quotaDay(startsAt);
        left = perDay;
      }
      left--;
      return {
        itemId: entry.itemId,
        day,
        startsAt,
        late: startsAt.getTime() > Date.parse(entry.scheduledAt),
      };
    });
}

/** Message for the user about uploads moved to later quota days, or null. */
export function quotaMessage(
  slots: UploadSlot[],
  now: Date,
  format: (instant: Date) => string,
): string | null {
  const deferred = slots.filter((slot) => slot.startsAt.getTime() > now.getTime());
  if (deferred.length === 0) return null;
  const late = deferred.filter((slot) => slot.late).length;
  return (
    `Quota YouTube du jour atteint : ${deferred.length} envoi(s) reporté(s), le premier le ${format(deferred[0]!.startsAt)} ` +
    '(le quota se réinitialise chaque jour à minuit, heure de Californie).' +
    (late > 0
      ? ` Attention : ${late} élément(s) partiront après leur date prévue et seront publiés dès l’envoi.`
      : '')
  );
}
