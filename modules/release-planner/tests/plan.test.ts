import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  DEFAULT_TEMPLATE,
  fillTemplate,
  parseTemplate,
  sanitizeMetadata,
  spreadPlan,
} from '../backend/plan';
import { canUpload, planUploads, quotaMessage, UNITS_PER_UPLOAD } from '../backend/quota';
import { canTransition, displayStatus, stateFromYouTube } from '../backend/status';
import {
  addDays,
  isDate,
  isTime,
  nextQuotaReset,
  quotaDay,
  utcToZoned,
  weekday,
  zonedToUtc,
} from '../backend/time';

const BRUSSELS = 'Europe/Brussels';
const ALL = { video: true, post: true, reels: [1, 2, 3, 4] };

describe('plan template', () => {
  it('reads the default template (J … J+14)', () => {
    const { entries, errors } = parseTemplate(DEFAULT_TEMPLATE);
    expect(errors).toEqual([]);
    expect(entries.map((e) => `${e.offset}:${e.kind}${e.position || ''}`)).toEqual([
      '0:youtube',
      '0:insta-post',
      '2:insta-reel1',
      '3:short1',
      '5:insta-reel2',
      '6:short2',
      '9:insta-reel3',
      '10:short3',
      '13:insta-reel4',
      '14:short4',
    ]);
  });

  it('accepts variants and reports mistakes with the line number', () => {
    const { entries, errors } = parseTemplate(
      'j: Vidéo YouTube et Post Instagram\n# commentaire\nJ + 1 : reel 1; short 1\nJ+3 : story\nJ+4 : Reel 7\nJ+5 : reel 1\nlundi : post',
    );
    expect(entries).toHaveLength(4);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain('ligne 4');
    expect(errors[0]).toContain('story');
    expect(errors[1]).toContain('1 à 4');
    expect(errors[2]).toContain('deux fois');
    expect(errors[3]).toContain('format attendu');
    expect(parseTemplate('').errors).toEqual(['Le modèle est vide']);
  });

  it('builds the default plan from J', () => {
    const plan = buildPlan(parseTemplate(DEFAULT_TEMPLATE).entries, '2026-11-06', ALL);
    expect(plan.map((p) => `${p.date} ${p.kind}${p.position || ''}`)).toEqual([
      '2026-11-06 youtube',
      '2026-11-06 insta-post',
      '2026-11-08 insta-reel1',
      '2026-11-09 short1',
      '2026-11-11 insta-reel2',
      '2026-11-12 short2',
      '2026-11-15 insta-reel3',
      '2026-11-16 short3',
      '2026-11-19 insta-reel4',
      '2026-11-20 short4',
    ]);
  });

  it('leaves out what was not generated', () => {
    const plan = buildPlan(parseTemplate(DEFAULT_TEMPLATE).entries, '2026-11-06', {
      video: false,
      post: true,
      reels: [1, 2],
    });
    expect(plan.map((p) => `${p.kind}${p.position || ''}`)).toEqual([
      'insta-post',
      'insta-reel1',
      'short1',
      'insta-reel2',
      'short2',
    ]);
  });
});

describe('anti-congestion', () => {
  const entries = parseTemplate(DEFAULT_TEMPLATE).entries;

  it('changes nothing when the days are free', () => {
    const plan = buildPlan(entries, '2026-11-06', ALL);
    const { items, shifts } = spreadPlan(plan, [], 1);
    expect(shifts).toEqual([]);
    expect(items.map((i) => i.date)).toEqual(plan.map((p) => p.date));
  });

  it('moves a second track overlapping the first, and says so', () => {
    const first = spreadPlan(buildPlan(entries, '2026-11-06', ALL), [], 1).items;
    const occupied = first.map((item) => ({
      platform:
        item.kind === 'youtube' || item.kind === 'short'
          ? ('youtube' as const)
          : ('instagram' as const),
      date: item.date,
    }));
    // Second track two days later: its J+0 hits the Reel 1 day of the first one…
    const second = spreadPlan(buildPlan(entries, '2026-11-08', ALL), occupied, 1);
    const perDay = new Map<string, number>();
    for (const slot of [
      ...occupied,
      ...second.items.map((item) => ({
        platform: item.kind === 'youtube' || item.kind === 'short' ? 'youtube' : 'instagram',
        date: item.date,
      })),
    ]) {
      const key = `${slot.platform}|${slot.date}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBe(1);
    expect(second.shifts.length).toBeGreaterThan(0);
    const post = second.shifts.find((s) => s.kind === 'insta-post');
    expect(post).toEqual({ kind: 'insta-post', position: 0, from: '2026-11-08', to: '2026-11-09' });
    // Order kept per platform: Reel n never before Reel n-1.
    const reels = second.items.filter((i) => i.kind === 'insta-reel').map((i) => i.date);
    expect([...reels].sort()).toEqual(reels);
  });

  it('allows N per day per platform', () => {
    const plan = buildPlan(entries, '2026-11-06', ALL);
    const occupied = [{ platform: 'youtube' as const, date: '2026-11-06' }];
    expect(spreadPlan(plan, occupied, 2).shifts).toEqual([]);
    const tight = spreadPlan(plan, occupied, 1);
    expect(tight.shifts[0]).toMatchObject({
      kind: 'youtube',
      from: '2026-11-06',
      to: '2026-11-07',
    });
  });
});

describe('time zone (Brussels → UTC)', () => {
  it('converts winter and summer times', () => {
    expect(zonedToUtc('2026-01-15', '18:00', BRUSSELS).toISOString()).toBe(
      '2026-01-15T17:00:00.000Z',
    );
    expect(zonedToUtc('2026-07-15', '18:00', BRUSSELS).toISOString()).toBe(
      '2026-07-15T16:00:00.000Z',
    );
  });

  it('handles the spring change (29 March 2026: 02:00 → 03:00)', () => {
    expect(zonedToUtc('2026-03-28', '18:00', BRUSSELS).toISOString()).toBe(
      '2026-03-28T17:00:00.000Z',
    );
    expect(zonedToUtc('2026-03-29', '18:00', BRUSSELS).toISOString()).toBe(
      '2026-03-29T16:00:00.000Z',
    );
    expect(zonedToUtc('2026-03-29', '01:30', BRUSSELS).toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    // 02:30 does not exist that night: moved to 03:30 CEST.
    const gap = zonedToUtc('2026-03-29', '02:30', BRUSSELS);
    expect(gap.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(utcToZoned(gap, BRUSSELS)).toEqual({ date: '2026-03-29', time: '03:30' });
  });

  it('handles the autumn change (25 October 2026: 03:00 → 02:00)', () => {
    expect(zonedToUtc('2026-10-24', '18:00', BRUSSELS).toISOString()).toBe(
      '2026-10-24T16:00:00.000Z',
    );
    expect(zonedToUtc('2026-10-25', '18:00', BRUSSELS).toISOString()).toBe(
      '2026-10-25T17:00:00.000Z',
    );
    // 02:30 happens twice: the first one (summer time).
    expect(zonedToUtc('2026-10-25', '02:30', BRUSSELS).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('round-trips every hour of a year', () => {
    for (let day = 0; day < 366; day += 1) {
      const date = addDays('2026-01-01', day);
      for (const time of ['00:00', '09:15', '18:00', '23:59']) {
        expect(utcToZoned(zonedToUtc(date, time, BRUSSELS), BRUSSELS)).toEqual({ date, time });
      }
    }
  });

  it('validates and computes dates', () => {
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isTime('24:00')).toBe(false);
    expect(isTime('07:05')).toBe(true);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(weekday('2026-10-19')).toBe(0); // Monday
  });

  it('knows the YouTube quota day (midnight in California)', () => {
    // 20 Oct 2026 08:30 in Brussels = 19 Oct 23:30 in California.
    expect(quotaDay(new Date('2026-10-20T06:30:00Z'))).toBe('2026-10-19');
    expect(nextQuotaReset(new Date('2026-10-20T06:30:00Z')).toISOString()).toBe(
      '2026-10-20T07:00:00.000Z',
    );
    // Between the two daylight saving changes (Europe already in winter time, US not yet):
    // the reset is at 08:00 in Brussels instead of 09:00.
    expect(utcToZoned(nextQuotaReset(new Date('2026-10-27T12:00:00Z')), BRUSSELS)).toEqual({
      date: '2026-10-28',
      time: '08:00',
    });
  });
});

describe('quota queue', () => {
  const limits = { uploadsPerDay: 6, unitsPerDay: 10_000 };
  const now = new Date('2026-10-20T10:00:00Z'); // 03:00 in California
  const queue = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      itemId: i + 1,
      scheduledAt: new Date(Date.parse('2026-10-25T16:00:00Z') + i * 86_400_000).toISOString(),
    }));
  const empty = { day: '2026-10-20', uploads: 0, units: 0, exhausted: false };

  it('sends what fits today and spreads the rest over the next days', () => {
    const slots = planUploads(queue(14), empty, limits, now);
    const perDay = slots.reduce<Record<string, number>>(
      (acc, s) => ({ ...acc, [s.day]: (acc[s.day] ?? 0) + 1 }),
      {},
    );
    expect(perDay).toEqual({ '2026-10-20': 6, '2026-10-21': 6, '2026-10-22': 2 });
    expect(slots[6]!.startsAt.toISOString()).toBe('2026-10-21T07:00:00.000Z');
    expect(slots.every((s) => !s.late)).toBe(true);
    const text = quotaMessage(slots, now, (d) => d.toISOString())!;
    expect(text).toContain('8 envoi(s) reporté(s)');
    expect(text).toContain('2026-10-21T07:00:00.000Z');
  });

  it('counts what was already used today, and an exhausted day', () => {
    expect(planUploads(queue(2), { ...empty, uploads: 5 }, limits, now).map((s) => s.day)).toEqual([
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(planUploads(queue(1), { ...empty, exhausted: true }, limits, now)[0]!.day).toBe(
      '2026-10-21',
    );
    expect(
      planUploads(queue(1), { ...empty, units: 10_000 - UNITS_PER_UPLOAD + 1 }, limits, now)[0]!
        .day,
    ).toBe('2026-10-21');
    expect(canUpload({ ...empty, uploads: 6 }, limits)).toBe(false);
    expect(canUpload(empty, limits)).toBe(true);
    expect(quotaMessage(planUploads(queue(2), empty, limits, now), now, String)).toBeNull();
  });

  it('flags uploads that would start after their publication date', () => {
    const urgent = [{ itemId: 1, scheduledAt: '2026-10-20T16:00:00Z' }];
    const slots = planUploads(urgent, { ...empty, exhausted: true }, limits, now);
    expect(slots[0]!.late).toBe(true);
    expect(quotaMessage(slots, now, String)).toContain('après leur date prévue');
  });
});

describe('statuses', () => {
  it('allows only the expected transitions', () => {
    expect(canTransition('planned', 'queued')).toBe(true);
    expect(canTransition('queued', 'uploading')).toBe(true);
    expect(canTransition('uploading', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'published')).toBe(true);
    expect(canTransition('failed', 'queued')).toBe(true);
    expect(canTransition('planned', 'scheduled')).toBe(false);
    expect(canTransition('planned', 'uploading')).toBe(false);
    expect(canTransition('scheduled', 'queued')).toBe(false);
    expect(canTransition('published', 'uploading')).toBe(false);
  });

  it('derives Instagram statuses from the pack and flags what is late', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const past = '2026-11-09T17:00:00Z';
    const future = '2026-11-11T17:00:00Z';
    expect(
      displayStatus({
        kind: 'insta-reel',
        state: 'planned',
        scheduledAt: past,
        instaPublishedAt: null,
        now,
      }),
    ).toEqual({ status: 'planned', late: true });
    expect(
      displayStatus({
        kind: 'insta-reel',
        state: 'planned',
        scheduledAt: past,
        instaPublishedAt: past,
        now,
      }),
    ).toEqual({ status: 'published', late: false });
    expect(
      displayStatus({ kind: 'insta-post', state: 'planned', scheduledAt: future, now }),
    ).toEqual({ status: 'planned', late: false });
    // A scheduled YouTube video goes out by itself: never « late ».
    expect(
      displayStatus({ kind: 'youtube', state: 'scheduled', scheduledAt: past, now }).late,
    ).toBe(false);
    expect(
      displayStatus({ kind: 'short', state: 'to-schedule', scheduledAt: past, now }).late,
    ).toBe(true);
    expect(displayStatus({ kind: 'short', state: 'failed', scheduledAt: past, now }).late).toBe(
      true,
    );
  });

  it('reads the status of a video on YouTube', () => {
    expect(
      stateFromYouTube({ privacyStatus: 'private', publishAt: '2026-11-11T17:00:00Z' }).state,
    ).toBe('scheduled');
    expect(stateFromYouTube({ privacyStatus: 'public' }).state).toBe('published');
    expect(stateFromYouTube({ privacyStatus: 'private' }).state).toBe('to-schedule');
    expect(stateFromYouTube({ privacyStatus: 'private', uploadStatus: 'rejected' })).toMatchObject({
      state: 'failed',
    });
  });
});

describe('metadata', () => {
  it('fills templates and keeps unknown placeholders for later', () => {
    expect(
      fillTemplate('{titre} — {artiste}\n\n\n\n{lien_video}', { titre: 'Drop', artiste: 'Thomas' }),
    ).toBe('Drop — Thomas\n\n{lien_video}');
  });

  it('respects the YouTube limits', () => {
    const clean = sanitizeMetadata({
      title: `<b>${'x'.repeat(120)}</b>`,
      description: `a<b>c ${'é'.repeat(3000)}`,
      tags: ['#lofi', 'lofi', 'chill beats', ...Array.from({ length: 100 }, (_, i) => `tag${i}`)],
    });
    expect(clean.title.length).toBeLessThanOrEqual(100);
    expect(clean.title).not.toMatch(/[<>]/);
    expect(Buffer.byteLength(clean.description)).toBeLessThanOrEqual(5000);
    expect(clean.description.startsWith('abc ')).toBe(true);
    expect(clean.tags.slice(0, 2)).toEqual(['lofi', 'chill beats']);
    const length = clean.tags.reduce(
      (sum, tag, i) => sum + tag.length + (tag.includes(' ') ? 2 : 0) + (i ? 1 : 0),
      0,
    );
    expect(length).toBeLessThanOrEqual(500);
    expect(sanitizeMetadata({ title: '  ', description: '', tags: [] }).title).toBe('Sans titre');
  });
});
