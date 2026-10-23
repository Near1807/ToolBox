// Demo channel: a realistic simulated music channel (9 releases over a year,
// each a long video + 4 Shorts, some Reels perso), generated on the fly from a
// fixed seed and never stored. Some effects are planted on purpose (Tuesday
// Shorts, the « Rythme » effect, energetic excerpts, Shorts that bring views
// to the long video) so the Labo and the Théories have something to find;
// the rest is noise. Shown as « DONNÉES DE DÉMO » everywhere.
import type {
  BreakdownRow,
  ChannelDay,
  DayRow,
  RetentionPoint,
  Snapshot,
  StatTrack,
  StatVideo,
  VideoOrigin,
} from '../shared';
import type { Dataset } from './dataset';
import { youtubeDay } from './dataset';
import { segmentEnergy } from './music';
import { addDay, dayDiff, rng } from './stats';

const TITLES = [
  'Midnight Drive',
  'Aube',
  'Néons',
  'Pluie d’été',
  'Kaléidoscope',
  'Basse Marée',
  'Orbite',
  'Velours',
  'Dernier Métro',
];

/** Energy envelope with sections: intro, montée, drop, pause, montée, drop, outro. */
function demoPeaks(random: () => number, bars = 400): number[] {
  const shape = (x: number) => {
    if (x < 0.1) return 0.2 + x;
    if (x < 0.22) return 0.3 + (x - 0.1) * 4;
    if (x < 0.42) return 0.95;
    if (x < 0.52) return 0.3;
    if (x < 0.6) return 0.35 + (x - 0.52) * 7;
    if (x < 0.85) return 1;
    return Math.max(0.1, 1 - (x - 0.85) * 5.5);
  };
  return Array.from({ length: bars }, (_, i) =>
    Math.max(0.02, shape(i / bars) * (0.85 + random() * 0.3)),
  );
}

const ISO = (day: string, hour: number, minute = 0) =>
  // Brussels local time in winter ≈ UTC+1, summer UTC+2: close enough for a demo.
  new Date(
    Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`) -
      3_600_000,
  ).toISOString();

function lognormal(random: () => number, medianValue: number, sigma: number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return medianValue * Math.exp(sigma * z);
}

/** Monday on or before a day. */
function mondayOf(day: string): string {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDay(day, -weekday);
}

export function demoDataset(today = new Date()): Dataset {
  const random = rng(20261023);
  const lastDay = addDay(today.toISOString().slice(0, 10), -3);
  const tracks: StatTrack[] = TITLES.map((title, i) => ({
    id: 9001 + i,
    title,
    artist: 'Thomas',
    durationSec: Math.round(150 + random() * 90),
    coverUrl: null,
    peaks: demoPeaks(random),
  }));
  const videos: StatVideo[] = [];
  const days: DayRow[] = [];
  const breakdowns: BreakdownRow[] = [];
  const retention: Record<string, RetentionPoint[]> = {};
  let counter = 0;
  const newId = () => `demo${String(++counter).padStart(7, '0')}`;

  // The last release is about ten days old: the recent weeks are lively.
  const firstRelease = mondayOf(addDay(lastDay, -8 * 42 - 10));
  const effects = ['rhythm', 'calm', 'cine', 'camera', 'raw'];
  const intensities = ['light', 'medium', 'max'];
  const audioModes = ['track', 'video', 'synced'];

  const addVideo = (input: {
    title: string;
    publishedAt: string;
    kind: 'video' | 'short';
    durationSec: number;
    origin: VideoOrigin;
    /** Expected lifetime views. */
    total: number;
    decay: number;
    tail: number;
    pct: number;
    subsRate: number;
    energy: number[] | null;
    feeder?: { series: Map<string, number>; rate: number };
    spikeAt?: number;
  }): { id: string; series: Map<string, number> } => {
    const id = newId();
    const publishDay = youtubeDay(input.publishedAt);
    const age = dayDiff(publishDay, lastDay);
    const series = new Map<string, number>();
    let totalViews = 0;
    let likes = 0;
    let comments = 0;
    const isLong = input.kind === 'video';
    const ctr = isLong ? 0.035 + random() * 0.05 : null;
    for (let d = 0; d <= age; d++) {
      const day = addDay(publishDay, d);
      const shape = d === 0 ? 0.28 : 0.72 * input.decay * Math.exp(-input.decay * (d - 1));
      let views = input.total * (shape + input.tail) * (0.75 + random() * 0.5);
      if (input.feeder)
        views += (input.feeder.series.get(addDay(day, -1)) ?? 0) * input.feeder.rate;
      if (input.spikeAt === d) views *= 9;
      views = Math.max(0, Math.round(views));
      series.set(day, views);
      totalViews += views;
      const pct = Math.max(5, input.pct + (random() - 0.5) * 8);
      const dayLikes = Math.round(views * (isLong ? 0.06 : 0.04) * (0.7 + random() * 0.6));
      const dayComments = Math.round(views * 0.004 * random() * 2);
      likes += dayLikes;
      comments += dayComments;
      const gained = Math.round(views * input.subsRate * (0.5 + random()));
      days.push({
        videoId: id,
        day,
        views,
        engagedViews: Math.round(views * (isLong ? 0.92 : 0.7)),
        minutes: (views * (pct / 100) * input.durationSec) / 60,
        avgViewDuration: (pct / 100) * input.durationSec,
        avgViewPct: views > 0 ? pct : null,
        likes: dayLikes,
        comments: dayComments,
        shares: Math.round(views * 0.006 * random() * 2),
        subsGained: gained,
        subsLost: Math.round(gained * 0.2 * random()),
        impressions: ctr ? Math.round(views / ctr) : null,
        ctr: ctr ? ctr * 100 : null,
      });
    }
    videos.push({
      id,
      title: input.title,
      publishedAt: input.publishedAt,
      durationSec: input.durationSec,
      kind: input.kind,
      kindSource: 'api',
      thumbnailUrl: null,
      privacy: 'public',
      origin: input.origin,
      totalViews: totalViews + Math.round(totalViews * 0.01),
      totalLikes: likes,
      totalComments: comments,
      impressions: null,
      ctr: null,
    });
    // Retention: losses slower where the music is energetic, a re-watch bump on drops.
    const points: RetentionPoint[] = [];
    let watch = 1;
    for (let i = 1; i <= 100; i++) {
      const energy = input.energy?.[i - 1] ?? 0.6;
      const base = isLong ? (i <= 5 ? 0.06 : 0.008) : i <= 5 ? 0.04 : 0.004;
      const loss = base * (1.6 - energy) * (input.pct / (isLong ? 40 : 75)) ** -0.5;
      watch = Math.max(0.02, watch - loss + (energy > 0.93 && random() < 0.15 ? 0.012 : 0));
      points.push({
        ratio: i / 100,
        watch,
        relative: Math.min(1, Math.max(0, 0.5 + (input.pct - (isLong ? 40 : 75)) / 60)),
      });
    }
    retention[id] = points;
    // Lifetime breakdowns.
    const split = (kind: BreakdownRow['kind'], shares: [string, number][]) => {
      const totalShare = shares.reduce((t, [, s]) => t + s, 0);
      for (const [key, share] of shares) {
        breakdowns.push({
          videoId: id,
          kind,
          key,
          views: Math.round((totalViews * share) / totalShare),
          minutes: null,
          pct: null,
        });
      }
    };
    split(
      'traffic',
      isLong
        ? [
            ['RELATED_VIDEO', 34],
            ['YT_SEARCH', 14],
            ['SUBSCRIBER', 12],
            ['EXT_URL', 10],
            ['NO_LINK_OTHER', 8],
            ['YT_CHANNEL', 8],
            ['SHORTS', 7],
            ['PLAYLIST', 4],
            ['NOTIFICATION', 3],
          ]
        : [
            ['SHORTS', 81],
            ['NO_LINK_OTHER', 7],
            ['RELATED_VIDEO', 5],
            ['SUBSCRIBER', 4],
            ['YT_SEARCH', 2],
            ['SOUND_PAGE', 1],
          ],
    );
    split('country', [
      ['BE', 38],
      ['FR', 29],
      ['CA', 8],
      ['CH', 6],
      ['US', 5],
      ['MA', 3],
      ['DE', 3],
      ['NL', 2],
    ]);
    split(
      'device',
      isLong
        ? [
            ['MOBILE', 58],
            ['DESKTOP', 27],
            ['TV', 11],
            ['TABLET', 4],
          ]
        : [
            ['MOBILE', 91],
            ['DESKTOP', 6],
            ['TABLET', 3],
          ],
    );
    split(
      'playback',
      isLong
        ? [
            ['WATCH', 74],
            ['BROWSE', 14],
            ['EMBEDDED', 8],
            ['CHANNEL', 4],
          ]
        : [
            ['SHORTS', 93],
            ['WATCH', 4],
            ['CHANNEL', 3],
          ],
    );
    // Demographics only above the privacy threshold (YouTube hides small audiences).
    if (totalViews >= 500) {
      const ages: [string, number][] = [
        ['age13-17', 6],
        ['age18-24', 31],
        ['age25-34', 34],
        ['age35-44', 17],
        ['age45-54', 8],
        ['age55-64', 3],
        ['age65-', 1],
      ];
      for (const [ageGroup, share] of ages) {
        breakdowns.push({
          videoId: id,
          kind: 'age_gender',
          key: `${ageGroup}|male`,
          views: 0,
          minutes: null,
          pct: share * 0.64,
        });
        breakdowns.push({
          videoId: id,
          kind: 'age_gender',
          key: `${ageGroup}|female`,
          views: 0,
          minutes: null,
          pct: share * 0.34,
        });
        breakdowns.push({
          videoId: id,
          kind: 'age_gender',
          key: `${ageGroup}|user_specified`,
          views: 0,
          minutes: null,
          pct: share * 0.02,
        });
      }
    }
    return { id, series };
  };

  tracks.forEach((track, t) => {
    const release = addDay(firstRelease, t * 42);
    if (dayDiff(release, lastDay) < 2) return;
    const shortIds: { id: string; series: Map<string, number> }[] = [];
    const shortsSeries = new Map<string, number>();
    const shortCount = t < 5 ? 4 : 4;
    for (let n = 1; n <= shortCount; n++) {
      const perso = t >= 4 && n >= 3;
      const position = perso ? 100 + (n - 2) : n;
      // Tuesday to Friday, sometimes at noon, sometimes on Saturday.
      const dayOffset = n === 4 && t % 3 === 0 ? 5 : n;
      const day = addDay(release, dayOffset);
      if (dayDiff(day, lastDay) < 0) continue;
      const hour = (t + n) % 4 === 0 ? 12 : 18;
      const excerptDuration = 28;
      const excerptStart = Math.round(
        Math.min(
          track.durationSec! - excerptDuration,
          track.durationSec! * [0.05, 0.27, 0.6, 0.48][n - 1]! + random() * 6,
        ),
      );
      const energy = segmentEnergy(
        track.peaks!,
        track.durationSec!,
        excerptStart,
        excerptDuration,
        100,
      );
      const meanEnergy = energy.reduce((a, b) => a + b, 0) / energy.length;
      const effect = perso ? effects[(t + n) % effects.length]! : null;
      const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
      let total = lognormal(random, 520, 0.45) * (0.6 + meanEnergy * 0.8);
      if (weekday === 1) total *= 2.2; // Tuesday Shorts do better (planted).
      if (effect === 'rhythm') total *= 1.35;
      const pct = 62 + meanEnergy * 25 + (effect === 'rhythm' ? 9 : 0) + (random() - 0.5) * 10;
      const label = perso ? `Short perso ${n - 2}` : `Short ${n}`;
      const short = addVideo({
        title: `${track.title} — Thomas (${n}/${shortCount}) #shorts`,
        publishedAt: ISO(day, hour),
        kind: 'short',
        durationSec: excerptDuration,
        origin: {
          link: 'planner',
          trackId: track.id,
          label,
          source: perso ? 'custom-reel' : 'cover-reel',
          position,
          excerptStart,
          excerptDuration,
          effect,
          intensity: perso ? intensities[(t + n) % 3]! : null,
          audioMode: perso ? audioModes[(t * 2 + n) % 3]! : null,
        },
        total,
        decay: 0.55,
        tail: 0.0015,
        pct,
        subsRate: 0.0025,
        energy,
      });
      shortIds.push(short);
      for (const [d, v] of short.series) shortsSeries.set(d, (shortsSeries.get(d) ?? 0) + v);
    }
    const long = addVideo({
      title: `Thomas — ${track.title} (clip officiel)`,
      publishedAt: ISO(release, 18),
      kind: 'video',
      durationSec: track.durationSec!,
      origin: {
        link: 'planner',
        trackId: track.id,
        label: 'Vidéo YouTube',
        source: 'video',
        position: 0,
        excerptStart: null,
        excerptDuration: null,
        effect: null,
        intensity: null,
        audioMode: null,
      },
      total: lognormal(random, 380, 0.4),
      decay: 0.16,
      tail: t === 1 ? 0.03 : 0.0025, // « Aube » keeps living (evergreen).
      pct: 34 + random() * 12,
      subsRate: 0.012,
      energy: segmentEnergy(track.peaks!, track.durationSec!, 0, track.durationSec!, 100),
      feeder: { series: shortsSeries, rate: 0.06 }, // Shorts bring viewers the next day (planted).
      spikeAt: t === 3 ? 63 : undefined,
    });
    // The long video's suggestions coming from its own Shorts.
    const longViews = [...long.series.values()].reduce((a, b) => a + b, 0);
    for (const s of shortIds) {
      breakdowns.push({
        videoId: long.id,
        kind: 'related',
        key: s.id,
        views: Math.round(longViews * 0.025),
        minutes: null,
        pct: null,
      });
    }
  });

  // A video published outside ToolBox (not linked: shows the manual linking).
  const teaserDay = addDay(lastDay, -120);
  addVideo({
    title: 'Session live au studio (extrait)',
    publishedAt: ISO(teaserDay, 20),
    kind: 'video',
    durationSec: 412,
    origin: {
      link: null,
      trackId: null,
      label: null,
      source: null,
      position: null,
      excerptStart: null,
      excerptDuration: null,
      effect: null,
      intensity: null,
      audioMode: null,
    },
    total: 240,
    decay: 0.2,
    tail: 0.002,
    pct: 28,
    subsRate: 0.008,
    energy: null,
  });

  // Channel days and snapshots from the videos.
  const channelMap = new Map<string, ChannelDay>();
  for (const row of days) {
    const entry = channelMap.get(row.day) ?? {
      day: row.day,
      views: 0,
      minutes: 0,
      subsGained: 0,
      subsLost: 0,
      likes: 0,
      comments: 0,
      shares: 0,
    };
    entry.views += row.views;
    entry.minutes += row.minutes;
    entry.subsGained += row.subsGained;
    entry.subsLost += row.subsLost;
    entry.likes += row.likes;
    entry.comments += row.comments;
    entry.shares += row.shares;
    channelMap.set(row.day, entry);
  }
  const channelDays = [...channelMap.values()].sort((a, b) => a.day.localeCompare(b.day));
  const snapshots: Snapshot[] = [];
  let subscribers = 37;
  let totalViews = 0;
  for (const day of channelDays) {
    subscribers += day.subsGained - day.subsLost;
    totalViews += day.views;
    snapshots.push({
      day: day.day,
      subscribers,
      views: totalViews,
      videos: videos.filter((v) => youtubeDay(v.publishedAt) <= day.day).length,
    });
  }
  // Channel-wide breakdowns (sum of the videos').
  const channelBreakdowns = new Map<string, BreakdownRow>();
  for (const b of breakdowns) {
    if (b.kind === 'related' || b.kind === 'age_gender') continue;
    const key = `${b.kind}|${b.key}`;
    const entry = channelBreakdowns.get(key) ?? { ...b, videoId: '', views: 0 };
    entry.views += b.views;
    channelBreakdowns.set(key, entry);
  }
  return {
    mode: 'demo',
    lastDay,
    channel: { id: 'UCdemo', title: 'Thomas (chaîne de démo)' },
    timeZone: 'Europe/Brussels',
    videos,
    days,
    channelDays,
    snapshots,
    breakdowns: [...breakdowns, ...channelBreakdowns.values()],
    retention,
    tracks,
    reach: 'csv',
  };
}
