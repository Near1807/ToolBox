// Types and texts shared by the backend and the frontend of youtube-stats
// (this module only: other modules never import it).

export type VideoKind = 'video' | 'short';

/** Where a YouTube video comes from in ToolBox, when known. */
export interface VideoOrigin {
  /** planner: the release planner uploaded it · manual: linked by the user. */
  link: 'planner' | 'manual' | null;
  trackId: number | null;
  /** « Vidéo YouTube », « Short 2 », « Short perso 1 »… */
  label: string | null;
  /** cover-reel: a Reel of the Instagram pack · custom-reel: a Reel perso. */
  source: 'video' | 'cover-reel' | 'custom-reel' | null;
  /** Short n (1..4), 100 + n for a Short perso; 0 for the long video. */
  position: number | null;
  /** Excerpt of the track (Shorts), in seconds. */
  excerptStart: number | null;
  excerptDuration: number | null;
  effect: string | null;
  intensity: string | null;
  audioMode: string | null;
}

export interface StatVideo {
  id: string;
  title: string;
  /** UTC instant. */
  publishedAt: string;
  durationSec: number;
  kind: VideoKind;
  /** api: creatorContentType · duration: guessed (≤ 3 min). */
  kindSource: 'api' | 'duration';
  thumbnailUrl: string | null;
  privacy: string | null;
  origin: VideoOrigin;
  /** Lifetime counters from the Data API (live, unlike Analytics). */
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  /** From a YouTube Studio CSV export (or the API when available), lifetime. */
  impressions: number | null;
  ctr: number | null;
}

/** One day of one video (Analytics API, YouTube day in Pacific time). */
export interface DayRow {
  videoId: string;
  day: string;
  views: number;
  engagedViews: number | null;
  minutes: number;
  avgViewDuration: number | null;
  avgViewPct: number | null;
  likes: number;
  comments: number;
  shares: number;
  subsGained: number;
  subsLost: number;
  impressions: number | null;
  ctr: number | null;
}

export interface ChannelDay {
  day: string;
  views: number;
  minutes: number;
  subsGained: number;
  subsLost: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface Snapshot {
  day: string;
  subscribers: number;
  views: number;
  videos: number;
}

export type BreakdownKind =
  'traffic' | 'country' | 'device' | 'playback' | 'age_gender' | 'content_type' | 'related';

export interface BreakdownRow {
  /** '' for the whole channel. */
  videoId: string;
  kind: BreakdownKind;
  key: string;
  views: number;
  minutes: number | null;
  /** age_gender: viewerPercentage. */
  pct: number | null;
}

export interface RetentionPoint {
  /** 0.01 … 1 (elapsedVideoTimeRatio). */
  ratio: number;
  /** Share of the views still watching (can exceed 1: re-watched). */
  watch: number;
  /** 0 … 1, vs YouTube videos of a similar length (0.5 = median). */
  relative: number | null;
}

export interface StatTrack {
  id: number;
  title: string;
  artist: string;
  durationSec: number | null;
  coverUrl: string | null;
  /** Energy envelope of the whole track (0..1), when computed. */
  peaks: number[] | null;
}

// ---------------------------------------------------------------------------
// Confidence of a theory or a comparison
// ---------------------------------------------------------------------------

export type Tier = 'intuition' | 'piste' | 'solide';

export const TIER_LABELS: Record<Tier, string> = {
  intuition: 'Intuition',
  piste: 'Piste',
  solide: 'Solide',
};

export const TIER_HELP: Record<Tier, string> = {
  intuition:
    'Trop peu de données ou écart compatible avec le hasard : pour le fun, ne rien décider dessus.',
  piste: 'Une tendance se dessine (p < 0,2), à confirmer avec plus de vidéos.',
  solide:
    'Écart net (p < 0,05 après correction des tests multiples, intervalle de confiance qui exclut 0, au moins 8 vidéos de chaque côté).',
};

export interface Confidence {
  tier: Tier;
  /** One sentence: why this tier. */
  reason: string;
  /** Sizes of the compared groups (one value for a correlation). */
  n: number[];
  /** Two-sided p-value of the test, after correction when there are several. */
  p: number | null;
  /** 95 % interval of the effect (bootstrap), in the effect's unit. */
  ci: [number, number] | null;
}

// ---------------------------------------------------------------------------
// Metrics: what they measure (shown on hover everywhere)
// ---------------------------------------------------------------------------

export interface MetricInfo {
  label: string;
  help: string;
  unit?: string;
}

export const METRICS: Record<string, MetricInfo> = {
  views: {
    label: 'Vues',
    help: 'Nombre de lectures comptées par YouTube (une vue de Short compte dès le début de la lecture).',
  },
  engagedViews: {
    label: 'Vues engagées',
    help: 'Lectures qui ont dépassé les toutes premières secondes (métrique récente de YouTube, utile pour les Shorts).',
  },
  minutes: {
    label: 'Durée de visionnage',
    help: 'Temps total passé à regarder, toutes vues confondues.',
    unit: 'min',
  },
  avgViewDuration: {
    label: 'Durée moyenne de visionnage',
    help: 'Temps moyen regardé par vue.',
    unit: 's',
  },
  avgViewPct: {
    label: 'Pourcentage moyen regardé',
    help: 'Part moyenne de la vidéo regardée par vue. Peut dépasser 100 % sur un Short qui tourne en boucle.',
    unit: '%',
  },
  likes: { label: 'J’aime', help: 'J’aime ajoutés (moins ceux retirés) sur la période.' },
  comments: { label: 'Commentaires', help: 'Commentaires publiés sur la période.' },
  shares: { label: 'Partages', help: 'Clics sur « Partager » sur la période.' },
  subsGained: {
    label: 'Abonnés gagnés',
    help: 'Abonnements faits depuis cette vidéo (ou la chaîne) sur la période.',
  },
  subsLost: { label: 'Abonnés perdus', help: 'Désabonnements attribués à la période.' },
  subsNet: { label: 'Abonnés nets', help: 'Gagnés moins perdus.' },
  subscribers: {
    label: 'Abonnés',
    help: 'Total d’abonnés de la chaîne (instantané quotidien de l’API Data, arrondi par YouTube au-delà de 1 000).',
  },
  impressions: {
    label: 'Impressions',
    help: 'Nombre de fois où la miniature a été montrée (au moins à moitié visible 1 s). Vient de l’export CSV de YouTube Studio, ou de l’API quand elle le fournit.',
  },
  ctr: {
    label: 'Taux de clics des impressions',
    help: 'Part des impressions qui ont mené à une vue. Vient de l’export CSV de YouTube Studio, ou de l’API quand elle le fournit.',
    unit: '%',
  },
  watch: {
    label: 'Audience restante',
    help: 'Part des vues encore présentes à ce moment de la vidéo (au-dessus de 100 % : passage revu ou Short qui reboucle).',
  },
  relative: {
    label: 'Rétention relative',
    help: 'Comparaison avec les vidéos YouTube de durée semblable : 0,5 = dans la moyenne, au-dessus = mieux.',
  },
  relativeIndex: {
    label: 'Indice « comme d’habitude »',
    help: 'Vues de la vidéo divisées par TA médiane au même âge (même type : Short ou vidéo longue). 1 = comme d’habitude, 2 = deux fois mieux.',
  },
  halfLife: {
    label: 'Demi-vie',
    help: 'Nombre de jours après la publication pour atteindre la moitié des vues actuelles. Courte : vidéo « feu de paille » ; longue : vidéo qui dure.',
    unit: 'j',
  },
  subsPer1000: {
    label: 'Abonnés pour 1 000 vues',
    help: 'Abonnés nets gagnés pour 1 000 vues : la capacité à convertir des spectateurs en abonnés.',
  },
  likeRate: { label: 'J’aime / vues', help: 'J’aime pour 100 vues.', unit: '%' },
  shareRate: { label: 'Partages / vues', help: 'Partages pour 1 000 vues.', unit: '‰' },
};

export const TRAFFIC_LABELS: Record<string, string> = {
  SHORTS: 'Fil des Shorts',
  YT_SEARCH: 'Recherche YouTube',
  RELATED_VIDEO: 'Vidéos suggérées',
  SUBSCRIBER: 'Abonnements / accueil',
  YT_CHANNEL: 'Pages de la chaîne',
  YT_OTHER_PAGE: 'Autres pages YouTube',
  EXT_URL: 'Sites externes',
  NO_LINK_OTHER: 'Accès direct ou inconnu',
  NO_LINK_EMBEDDED: 'Lecteur intégré',
  NOTIFICATION: 'Notifications',
  PLAYLIST: 'Playlists',
  YT_PLAYLIST_PAGE: 'Pages de playlist',
  END_SCREEN: 'Écrans de fin',
  ANNOTATION: 'Fiches et annotations',
  CAMPAIGN_CARD: 'Fiches de campagne',
  ADVERTISING: 'Publicité',
  HASHTAGS: 'Pages de hashtags',
  SOUND_PAGE: 'Pages de son (Shorts)',
  VIDEO_REMIXES: 'Remix (Shorts)',
  LIVE_REDIRECT: 'Redirection de live',
  PRODUCT_PAGE: 'Pages produit',
  IMMERSIVE_LIVE: 'Live immersif',
};

export const DEVICE_LABELS: Record<string, string> = {
  MOBILE: 'Téléphone',
  DESKTOP: 'Ordinateur',
  TABLET: 'Tablette',
  TV: 'Télévision',
  GAME_CONSOLE: 'Console',
  UNKNOWN_PLATFORM: 'Inconnu',
};

export const PLAYBACK_LABELS: Record<string, string> = {
  WATCH: 'Page YouTube',
  SHORTS: 'Fil des Shorts',
  EMBEDDED: 'Lecteur intégré',
  BROWSE: 'Accueil / navigation',
  CHANNEL: 'Page de la chaîne',
  SEARCH: 'Résultats de recherche',
  YT_OTHER: 'Autre page YouTube',
  EXTERNAL_APP: 'Application externe',
  MOBILE: 'Mobile (ancien)',
};

export const CONTENT_TYPE_LABELS: Record<string, string> = {
  SHORTS: 'Shorts',
  VIDEO_ON_DEMAND: 'Vidéos longues',
  LIVE_STREAM: 'Lives',
  STORY: 'Stories',
};

export const EFFECT_LABELS: Record<string, string> = {
  raw: 'Brut',
  calm: 'Calme',
  rhythm: 'Rythme',
  cine: 'Ciné',
  camera: 'Caméra embarquée',
};

export const INTENSITY_LABELS: Record<string, string> = {
  light: 'Léger',
  medium: 'Moyen',
  max: 'À fond',
};

export const AUDIO_MODE_LABELS: Record<string, string> = {
  track: 'Son du morceau',
  video: 'Son de la vidéo',
  synced: 'Morceau synchronisé',
};

export const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
