// Theories: hypotheses in plain French, generated from the Labo, each with the
// data behind it, its sample size and its confidence tier — and a journal that
// follows them over time (confirmée / infirmée / en attente) and suggests small
// experiments to settle them.
import {
  AUDIO_MODE_LABELS,
  EFFECT_LABELS,
  INTENSITY_LABELS,
  TIER_LABELS,
  type Confidence,
  type Tier,
  type VideoKind,
} from '../shared';
import { type GroupStat, type LabResult } from './lab';

const HOUR_PHRASES = ['la nuit', 'le matin', 'l’après-midi', 'le soir'];
import { bootstrapDiff, confidence, mannWhitney, median, MIN_GROUP, spearman } from './stats';

export interface Theory {
  /** Stable identity across evaluations (family + subject). */
  key: string;
  family:
    | 'weekday'
    | 'hour'
    | 'style'
    | 'excerpt'
    | 'rabatteur'
    | 'conversion'
    | 'sections'
    | 'position'
    | 'lifecycle';
  text: string;
  /** What the theory is based on, in one line. */
  detail: string;
  confidence: Confidence;
  /** Sign of the effect (+1: more / better / positive); the text follows it. */
  direction: 1 | -1;
  /** The effect in words: « ×1,4 », « ρ = 0,52 ». */
  effect: string;
  /** A small test to settle it, or null. */
  experiment: string | null;
  /** Another explanation that the data cannot rule out (confounding), or null. */
  caveat?: string | null;
}

export type TheoryStatus = 'pending' | 'confirmed' | 'refuted';

export interface JournalPoint {
  at: string;
  tier: Tier;
  /** Direction of the effect (0: the theory was not produced any more). */
  direction: -1 | 0 | 1;
  effect: string;
  n: number[];
  /** Recomputed afterwards from the data as it was then. */
  retro?: boolean;
}

export interface JournalEntry {
  key: string;
  text: string;
  family: Theory['family'];
  status: TheoryStatus;
  firstSeen: string;
  updatedAt: string;
  maxTier: Tier;
  /** Why the status (one sentence). */
  statusReason: string;
  history: JournalPoint[];
}

const fmt = (value: number, digits = 1) => value.toFixed(digits).replace('.', ',');
const times = (ratio: number) =>
  ratio >= 1 ? `×${fmt(ratio)}` : `−${Math.round((1 - ratio) * 100)} %`;
const kindWord = (kind: VideoKind, plural = true) =>
  kind === 'short' ? (plural ? 'Shorts' : 'Short') : plural ? 'vidéos longues' : 'vidéo longue';
const TIER_RANK: Record<Tier, number> = { intuition: 0, piste: 1, solide: 2 };

/** The group of a family that stands out the most (best tier, then largest effect). */
function standout(groups: GroupStat[]): GroupStat | null {
  const candidates = groups.filter((g) => g.ratio !== null && g.n > 0);
  if (candidates.length === 0) return null;
  // Groups big enough to test first, then the best tier, the smallest p, the largest effect.
  return candidates.sort(
    (a, b) =>
      Number(b.n >= MIN_GROUP) - Number(a.n >= MIN_GROUP) ||
      TIER_RANK[b.confidence.tier] - TIER_RANK[a.confidence.tier] ||
      (a.confidence.p ?? 1) - (b.confidence.p ?? 1) ||
      Math.abs(Math.log(b.ratio!)) - Math.abs(Math.log(a.ratio!)),
  )[0]!;
}

export function generateTheories(lab: LabResult): Theory[] {
  const theories: Theory[] = [];

  // Day and hour of publication.
  for (const { kind, groups } of lab.weekdays) {
    const g = standout(groups);
    if (!g) continue;
    const better = g.ratio! >= 1;
    theories.push({
      key: `weekday:${kind}:${g.key}`,
      family: 'weekday',
      text: `Tes ${kindWord(kind)} publiés le ${g.label} font ${better ? 'plus' : 'moins'} de vues que les autres jours`,
      detail: `Indice à J+7 : médiane ${fmt(g.medianIndex ?? 0, 2)} le ${g.label} (${g.n} ${kindWord(kind, g.n > 1)}), ${times(g.ratio!)} par rapport aux autres jours.`,
      confidence: g.confidence,
      direction: better ? 1 : -1,
      effect: times(g.ratio!),
      experiment: better
        ? `Publie les deux prochains ${kindWord(kind)} un ${g.label} et un autre jour, à la même heure.`
        : `Évite le ${g.label} pour les deux prochains ${kindWord(kind)} et compare.`,
    });
  }
  for (const { kind, groups } of lab.hours) {
    const g = standout(groups);
    if (!g) continue;
    const better = g.ratio! >= 1;
    theories.push({
      key: `hour:${kind}:${g.key}`,
      family: 'hour',
      text: `Tes ${kindWord(kind)} publiés ${HOUR_PHRASES[Number(g.key)]} démarrent ${better ? 'mieux' : 'moins bien'}`,
      detail: `Indice à J+7 : médiane ${fmt(g.medianIndex ?? 0, 2)} (${g.n} ${kindWord(kind, g.n > 1)}), ${times(g.ratio!)} par rapport aux autres heures.`,
      confidence: g.confidence,
      direction: better ? 1 : -1,
      effect: times(g.ratio!),
      experiment: `Publie le prochain ${kindWord(kind, false)} ${better ? HOUR_PHRASES[Number(g.key)] : 'à un autre moment'} et le suivant à ton heure habituelle.`,
    });
  }

  // Styles of the Shorts.
  for (const familyResult of lab.styles) {
    const g = standout(familyResult.groups);
    if (!g || familyResult.groups.length < 2) continue;
    const better = g.ratio! >= 1;
    const subject =
      familyResult.family === 'source'
        ? g.key === 'custom-reel'
          ? 'les Shorts faits de tes vidéos (Reels perso)'
          : 'les Shorts faits du Reel de la cover (pack)'
        : familyResult.family === 'effect'
          ? `les Reels perso en « ${EFFECT_LABELS[g.key] ?? g.key} »`
          : familyResult.family === 'intensity'
            ? `les Reels perso en intensité « ${INTENSITY_LABELS[g.key] ?? g.key} »`
            : `les Reels perso en « ${AUDIO_MODE_LABELS[g.key] ?? g.key} »`;
    theories.push({
      key: `style:${familyResult.family}:${g.key}`,
      family: 'style',
      text: `${subject[0]!.toUpperCase()}${subject.slice(1)} marchent ${better ? 'mieux' : 'moins bien'} que les autres`,
      detail: `${familyResult.title} : indice médian ${fmt(g.medianIndex ?? 0, 2)} à J+7 (${g.n} Short(s)), ${times(g.ratio!)}${g.medianPct !== null ? ` ; ${Math.round(g.medianPct)} % regardé en moyenne` : ''}.`,
      confidence: g.confidence,
      direction: better ? 1 : -1,
      effect: times(g.ratio!),
      experiment: `Pour le prochain morceau, fais deux Shorts identiques sauf ce réglage (${familyResult.title.toLowerCase()}).`,
    });
  }

  // Excerpts.
  const corrTheory = (
    key: string,
    value: { rho: number; confidence: Confidence } | null,
    positive: string,
    negative: string,
    detail: string,
    experiment: string,
  ) => {
    if (!value || !Number.isFinite(value.rho)) return;
    theories.push({
      key,
      family: 'excerpt',
      text: value.rho >= 0 ? positive : negative,
      detail: `${detail} ρ de Spearman = ${fmt(value.rho, 2)} sur ${value.confidence.n[0]} Short(s).`,
      confidence: value.confidence,
      direction: value.rho >= 0 ? 1 : -1,
      effect: `ρ = ${fmt(value.rho, 2)}`,
      experiment,
    });
  };
  corrTheory(
    'excerpt:energy-retention',
    lab.excerpts.energyVsRetention,
    'Les extraits les plus énergiques sont regardés plus longtemps',
    'Les extraits plus calmes sont regardés plus longtemps',
    'Énergie moyenne de l’extrait vs pourcentage regardé.',
    'Sur le prochain pack, choisis un extrait très énergique et un extrait calme du même morceau.',
  );
  corrTheory(
    'excerpt:energy-views',
    lab.excerpts.energyVsViews,
    'Les extraits énergiques font plus de vues',
    'Les extraits calmes font plus de vues',
    'Énergie moyenne de l’extrait vs indice à J+7.',
    'Compare deux Shorts du même morceau : le drop contre un passage calme.',
  );
  corrTheory(
    'excerpt:position-views',
    lab.excerpts.positionVsViews,
    'Les extraits pris tard dans le morceau font plus de vues',
    'Les extraits pris tôt dans le morceau font plus de vues',
    'Position du début de l’extrait dans le morceau vs indice à J+7.',
    'Prends le Short 1 dans le premier tiers du morceau et le Short 2 dans le dernier tiers.',
  );

  // Shorts → long video.
  const { overall, tracks } = lab.rabatteur;
  if (overall.meanR !== null) {
    const positive = overall.meanR > 0;
    const fromShorts = tracks.reduce((total, t) => total + t.fromOwnShorts, 0);
    theories.push({
      key: 'rabatteur:global',
      family: 'rabatteur',
      text: positive
        ? `Quand tes Shorts décollent, la vidéo longue du morceau suit${overall.bestLag ? ` (${overall.bestLag} jour(s) plus tard)` : ''}`
        : 'Les vues de tes Shorts ne se reportent pas sur la vidéo longue',
      detail: `Corrélation moyenne ${fmt(overall.meanR, 2)} entre les variations des vues des Shorts et celles de la vidéo longue, avec décalage, sur ${tracks.length} morceau(x)${fromShorts > 0 ? ` ; ${fromShorts} vue(s) de vidéos longues venues de leurs propres Shorts (suggestions)` : ''}.`,
      confidence: overall.confidence,
      direction: positive ? 1 : -1,
      effect: `r = ${fmt(overall.meanR, 2)}`,
      experiment:
        'Sur le prochain morceau, mets le lien de la vidéo complète en commentaire épinglé du Short 1 seulement, et compare avec le Short 2.',
    });
  }

  // Conversion.
  const conv = lab.conversion.shortsVsLong;
  if (conv && conv.ratio !== null && Number.isFinite(conv.ratio)) {
    const longBetter = conv.ratio >= 1;
    theories.push({
      key: 'conversion:subs',
      family: 'conversion',
      text: longBetter
        ? 'Tes vidéos longues convertissent mieux en abonnés que tes Shorts'
        : 'Tes Shorts convertissent mieux en abonnés que tes vidéos longues',
      detail: `Abonnés nets pour 1 000 vues (médianes) : ${lab.conversion.byKind
        .map((k) => `${kindWord(k.kind)} ${k.subsPer1000 === null ? '—' : fmt(k.subsPer1000)}`)
        .join(', ')}.`,
      confidence: conv.confidence,
      direction: longBetter ? 1 : -1,
      effect: times(longBetter ? conv.ratio : 1 / conv.ratio),
      experiment:
        'Ajoute un appel à s’abonner (texte à l’écran) sur un Short sur deux pendant un mois.',
    });
  }

  // Sections of the music.
  if (lab.sectionTest) {
    const t = lab.sectionTest;
    theories.push({
      key: 'sections:drop-pause',
      family: 'sections',
      text:
        t.better === 'Drop'
          ? 'Les spectateurs décrochent moins pendant les drops que pendant les passages calmes'
          : 'Les spectateurs décrochent plus pendant les drops que pendant les passages calmes',
      detail: `Perte d’audience pour 10 % de vidéo (médianes) : ${lab.sections
        .map((s) => `${s.label} ${fmt(s.lossPer10 * 100)} pt (${s.n})`)
        .join(', ')}.`,
      confidence: t.confidence,
      direction: t.better === 'Drop' ? 1 : -1,
      effect: `${t.better} > ${t.worse}`,
      experiment: 'Fais commencer le prochain Short directement sur le drop, sans montée.',
    });
  }

  // Position of the Short in the release (Short 1 … 4).
  const shorts = lab.videos.filter((v) => v.kind === 'short' && v.index[7] !== null && v.label);
  const positionOf = (label: string) => {
    const match = /Short (\d)$/.exec(label);
    return match ? Number(match[1]) : null;
  };
  const pairs = shorts
    .map((v) => [positionOf(v.label!), v.index[7]] as const)
    .filter((p): p is [number, number] => p[0] !== null);
  if (pairs.length >= 3) {
    const corr = spearman(
      pairs.map((p) => p[0]),
      pairs.map((p) => p[1]),
      71,
    );
    if (Number.isFinite(corr.rho)) {
      theories.push({
        key: 'position:shorts',
        family: 'position',
        text:
          corr.rho < 0
            ? 'Les premiers Shorts d’une sortie marchent mieux que les suivants (lassitude ?)'
            : 'Les derniers Shorts d’une sortie marchent mieux que les premiers (effet d’entraînement ?)',
        detail: `Numéro du Short (1 → 4) vs indice à J+7 : ρ = ${fmt(corr.rho, 2)} sur ${corr.n} Shorts.`,
        confidence: confidence({
          n: [corr.n],
          p: corr.p,
          ci: corr.ci,
          strong: Math.abs(corr.rho) >= 0.3,
        }),
        direction: corr.rho >= 0 ? 1 : -1,
        effect: `ρ = ${fmt(corr.rho, 2)}`,
        experiment:
          'Inverse l’ordre des extraits sur la prochaine sortie (le meilleur en dernier).',
      });
    }
  }

  // Life cycle: half-life of long videos vs Shorts.
  const hl = (kind: VideoKind) =>
    lab.videos.filter((v) => v.kind === kind && v.halfLife !== null).map((v) => v.halfLife!);
  const longHl = hl('video');
  const shortHl = hl('short');
  if (longHl.length && shortHl.length) {
    const test = mannWhitney(longHl, shortHl);
    const boot = bootstrapDiff(longHl, shortHl, { seed: 79 });
    const diff = median(longHl) - median(shortHl);
    theories.push({
      key: 'lifecycle:half-life',
      family: 'lifecycle',
      text:
        diff >= 0
          ? 'Tes vidéos longues vivent plus longtemps que tes Shorts'
          : 'Tes Shorts vivent plus longtemps que tes vidéos longues',
      detail: `Demi-vie médiane : vidéos longues ${fmt(median(longHl), 0)} j (${longHl.length}), Shorts ${fmt(median(shortHl), 0)} j (${shortHl.length}).`,
      confidence: confidence({
        n: [longHl.length, shortHl.length],
        p: test.p,
        ci: boot ? boot.ci95 : null,
        strong: Math.abs(test.r) >= 0.3,
      }),
      direction: diff >= 0 ? 1 : -1,
      effect: `${diff >= 0 ? '+' : ''}${fmt(diff, 0)} j`,
      experiment: null,
    });
  }

  // Confounding: when Short n is (almost) always published the same weekday, the
  // effect of the day and the effect of the number cannot be told apart.
  const shortDays = new Map<number, number[]>();
  for (const v of lab.videos) {
    const position = v.kind === 'short' && v.label ? positionOf(v.label) : null;
    if (position === null) continue;
    shortDays.set(position, [...(shortDays.get(position) ?? []), v.weekday]);
  }
  const tied = [...shortDays.entries()].filter(([, list]) => {
    const counts = new Map<number, number>();
    for (const d of list) counts.set(d, (counts.get(d) ?? 0) + 1);
    return list.length >= 3 && Math.max(...counts.values()) / list.length >= 0.8;
  });
  if (tied.length >= Math.max(2, shortDays.size - 1)) {
    const caveat =
      'Chaque Short n sort presque toujours le même jour (Short 1 le lendemain de la vidéo…) : impossible de séparer l’effet du jour de celui du numéro du Short. Pour trancher, change l’ordre ou les jours sur une sortie.';
    for (const theory of theories) {
      if (
        theory.family === 'position' ||
        (theory.family === 'weekday' && theory.key.startsWith('weekday:short'))
      ) {
        theory.caveat = caveat;
      }
    }
  }

  return theories.sort(
    (a, b) =>
      TIER_RANK[b.confidence.tier] - TIER_RANK[a.confidence.tier] ||
      (a.confidence.p ?? 1) - (b.confidence.p ?? 1),
  );
}

/**
 * Adds an evaluation to the journal: one point per theory per day, statuses
 * recomputed. Confirmed: « Solide » twice in a row, same direction. Refuted:
 * reached « Piste » or more, then the effect turned the other way (or vanished
 * for three evaluations).
 */
export function updateJournal(
  previous: JournalEntry[],
  theories: Theory[],
  at: string,
  retro = false,
): JournalEntry[] {
  const day = at.slice(0, 10);
  const byKey = new Map(previous.map((e) => [e.key, structuredClone(e)]));
  const seen = new Set<string>();
  for (const theory of theories) {
    seen.add(theory.key);
    const point: JournalPoint = {
      at,
      tier: theory.confidence.tier,
      direction: theory.direction,
      effect: theory.effect,
      n: theory.confidence.n,
      ...(retro ? { retro: true } : {}),
    };
    let entry = byKey.get(theory.key);
    if (!entry) {
      entry = {
        key: theory.key,
        text: theory.text,
        family: theory.family,
        status: 'pending',
        firstSeen: at,
        updatedAt: at,
        maxTier: point.tier,
        statusReason: '',
        history: [],
      };
      byKey.set(theory.key, entry);
    }
    const last = entry.history[entry.history.length - 1];
    if (last && last.at.slice(0, 10) === day) entry.history[entry.history.length - 1] = point;
    else entry.history.push(point);
    entry.text = theory.text;
    entry.updatedAt = at;
    if (TIER_RANK[point.tier] > TIER_RANK[entry.maxTier]) entry.maxTier = point.tier;
  }
  for (const entry of byKey.values()) {
    if (seen.has(entry.key)) continue;
    const last = entry.history[entry.history.length - 1];
    if (last && last.at.slice(0, 10) === day) continue;
    entry.history.push({
      at,
      tier: 'intuition',
      direction: 0,
      effect: '—',
      n: [],
      ...(retro ? { retro: true } : {}),
    });
  }
  for (const entry of byKey.values()) {
    const h = entry.history;
    const last = h[h.length - 1];
    const before = h[h.length - 2];
    const strongDirections = h.filter((p) => TIER_RANK[p.tier] >= 1 && p.direction !== 0);
    const firstStrong = strongDirections[0];
    if (
      last &&
      before &&
      last.tier === 'solide' &&
      before.tier === 'solide' &&
      last.direction === before.direction
    ) {
      entry.status = 'confirmed';
      entry.statusReason = `« ${TIER_LABELS.solide} » deux évaluations de suite, dans le même sens.`;
    } else if (
      firstStrong &&
      last &&
      last.direction !== 0 &&
      last.direction !== firstStrong.direction &&
      TIER_RANK[last.tier] >= 1
    ) {
      entry.status = 'refuted';
      entry.statusReason = 'L’effet s’est inversé depuis qu’elle était une piste.';
    } else if (
      firstStrong &&
      h.slice(-3).length === 3 &&
      h.slice(-3).every((p) => p.direction === 0 || p.tier === 'intuition') &&
      entry.status !== 'confirmed'
    ) {
      entry.status = 'refuted';
      entry.statusReason =
        'Elle était une piste, puis l’effet a disparu trois évaluations de suite.';
    } else if (entry.status !== 'confirmed' || last?.tier !== 'solide') {
      entry.status = 'pending';
      entry.statusReason =
        last?.tier === 'solide'
          ? 'Solide une fois : à confirmer à la prochaine évaluation.'
          : 'Pas encore assez de données pour trancher.';
    }
  }
  return [...byKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
