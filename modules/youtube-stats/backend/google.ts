// Read-only client of the YouTube Data API v3 (channel, uploads, videos) and of
// the YouTube Analytics API v2 (reports), on top of ctx.accounts.fetch (bearer
// token, refresh). Errors are classified so the sync can say exactly what to do.

/** Scopes asked for, added to those already granted (the planner's « youtube »). */
export const STATS_SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
];

/** Granted scopes that are enough to read videos (the planner's full scope works too). */
export function hasStatsScopes(scopes: string[]): { analytics: boolean; data: boolean } {
  return {
    analytics: scopes.some(
      (s) => s.endsWith('/yt-analytics.readonly') || s.endsWith('/yt-analytics-monetary.readonly'),
    ),
    data: scopes.some((s) =>
      ['/youtube', '/youtube.readonly', '/youtube.force-ssl'].some((suffix) => s.endsWith(suffix)),
    ),
  };
}

/** Analytics API endpoint (overridable for the tests' fake Google). */
export const analyticsBase = () =>
  process.env.TOOLBOX_YT_ANALYTICS_URL ?? 'https://youtubeanalytics.googleapis.com/v2/reports';

export type GoogleErrorKind = 'quota' | 'scope' | 'disabled' | 'unsupported' | 'other';

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: GoogleErrorKind,
    message: string,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

async function readError(response: Response): Promise<GoogleApiError> {
  let reason: string | null = null;
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as {
      error?: {
        message?: string;
        status?: string;
        errors?: { reason?: string; message?: string }[];
      };
    };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? null;
    message = body.error?.message ?? message;
  } catch {
    // Not JSON.
  }
  const text = `${reason ?? ''} ${message}`.toLowerCase();
  let kind: GoogleErrorKind = 'other';
  if (response.status === 429 || /quota|ratelimit|dailylimit/.test(text)) kind = 'quota';
  else if (
    response.status === 403 &&
    /accessnotconfigured|service_disabled|has not been used|is disabled/.test(text)
  )
    kind = 'disabled';
  else if (response.status === 403 && /insufficient|scope|forbidden/.test(text)) kind = 'scope';
  else if (response.status === 400) kind = 'unsupported';
  const french: Record<GoogleErrorKind, string> = {
    quota: 'Quota Google atteint pour aujourd’hui : nouvel essai à la prochaine synchronisation.',
    scope:
      'L’accès aux statistiques n’est pas autorisé : clique sur « Autoriser les statistiques » (une seule fois).',
    disabled:
      'L’API « YouTube Analytics » n’est pas activée dans ton projet Google Cloud : API et services › Bibliothèque › YouTube Analytics API › Activer.',
    unsupported: `Requête refusée par Google : ${message}`,
    other: `Erreur Google (${response.status}) : ${message}`,
  };
  return new GoogleApiError(response.status, kind, french[kind], reason);
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface AnalyticsQuery {
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  filters?: string;
  sort?: string;
  maxResults?: number;
}

export type ReportRow = Record<string, string | number>;

export class GoogleClient {
  /** Requests made during this client's life (shown after a sync). */
  calls = 0;

  constructor(private readonly fetchFn: Fetch) {}

  async data<T>(path: string, params: Record<string, string>): Promise<T> {
    this.calls++;
    const response = await this.fetchFn(`/youtube/v3/${path}?${new URLSearchParams(params)}`);
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
  }

  /** A report, as rows keyed by column name. */
  async report(query: AnalyticsQuery): Promise<ReportRow[]> {
    this.calls++;
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate: query.startDate,
      endDate: query.endDate,
      metrics: query.metrics.join(','),
    });
    if (query.dimensions?.length) params.set('dimensions', query.dimensions.join(','));
    if (query.filters) params.set('filters', query.filters);
    if (query.sort) params.set('sort', query.sort);
    if (query.maxResults) params.set('maxResults', String(query.maxResults));
    const response = await this.fetchFn(`${analyticsBase()}?${params}`);
    if (!response.ok) throw await readError(response);
    const body = (await response.json()) as {
      columnHeaders?: { name: string }[];
      rows?: (string | number)[][];
    };
    const names = (body.columnHeaders ?? []).map((c) => c.name);
    return (body.rows ?? []).map((row) =>
      Object.fromEntries(row.map((value, i) => [names[i]!, value])),
    );
  }

  /**
   * A report with optional metrics: when Google refuses the query (400), it is
   * sent again without the optional ones. Returns which optional ones worked.
   */
  async reportWithFallback(
    query: AnalyticsQuery,
    optional: string[],
  ): Promise<{ rows: ReportRow[]; optional: boolean }> {
    try {
      return {
        rows: await this.report({ ...query, metrics: [...query.metrics, ...optional] }),
        optional: true,
      };
    } catch (error) {
      if (
        !(error instanceof GoogleApiError) ||
        error.kind !== 'unsupported' ||
        optional.length === 0
      )
        throw error;
      return { rows: await this.report(query), optional: false };
    }
  }
}

/** "PT3M25S" → 205. */
export function parseIsoDuration(value: string | undefined): number {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value ?? '');
  if (!match) return 0;
  const [, d, h, m, s] = match;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}
