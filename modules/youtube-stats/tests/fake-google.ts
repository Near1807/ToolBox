// A small fake of Google for the youtube-stats tests: OAuth (PKCE, refresh,
// granted scopes), YouTube Data API v3 (channels, playlistItems, videos) and
// YouTube Analytics API v2 (reports by day, retention, breakdowns), with
// switches for quota, expired authorization and unsupported metrics.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeVideo {
  id: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  shorts: boolean;
  /** Views per day (YYYY-MM-DD). */
  daily: Record<string, number>;
}

export class FakeGoogle {
  base = '';
  private server: Server;
  private validToken: string | null = null;
  private counter = 0;
  private challenges = new Map<string, { challenge: string; scope: string }>();
  private grantedScope = '';
  readonly log: string[] = [];
  readonly reports: URLSearchParams[] = [];
  videos: FakeVideo[] = [];
  subscribers = 120;

  quotaExceeded = false;
  refreshInvalid = false;
  /** Google refuses the impressions metrics in the Analytics API. */
  reachUnsupported = true;

  constructor() {
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', () => resolve()));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get provider() {
    return {
      authUrl: `${this.base}/o/oauth2/v2/auth`,
      tokenUrl: `${this.base}/token`,
      revokeUrl: `${this.base}/revoke`,
      apiBase: this.base,
    };
  }

  async consent(authUrl: string): Promise<number> {
    const url = new URL(authUrl);
    const code = `code-${++this.counter}`;
    this.challenges.set(code, {
      challenge: url.searchParams.get('code_challenge') ?? '',
      scope: url.searchParams.get('scope') ?? '',
    });
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('state', url.searchParams.get('state')!);
    redirect.searchParams.set('code', code);
    return (await fetch(redirect)).status;
  }

  expireToken(): void {
    this.validToken = null;
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private error(res: ServerResponse, status: number, reason: string, message = reason) {
    this.json(res, status, { error: { code: status, message, errors: [{ reason, message }] } });
  }

  private async body(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.base);
    this.log.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/token') {
      const params = new URLSearchParams(await this.body(req));
      if (params.get('grant_type') === 'authorization_code') {
        const pending = this.challenges.get(params.get('code') ?? '');
        const expected = createHash('sha256')
          .update(params.get('code_verifier') ?? '')
          .digest('base64url');
        if (!pending || pending.challenge !== expected)
          return this.json(res, 400, { error: 'invalid_grant' });
        this.grantedScope = pending.scope;
        this.validToken = `access-${++this.counter}`;
        return this.json(res, 200, {
          access_token: this.validToken,
          expires_in: 3600,
          refresh_token: 'refresh-1',
          scope: this.grantedScope,
        });
      }
      if (this.refreshInvalid)
        return this.json(res, 400, { error: 'invalid_grant', error_description: 'revoked' });
      this.validToken = `access-${++this.counter}`;
      return this.json(res, 200, { access_token: this.validToken, expires_in: 3600 });
    }
    if (url.pathname === '/revoke') return this.json(res, 200, {});
    if (!this.validToken || req.headers.authorization !== `Bearer ${this.validToken}`) {
      return this.error(res, 401, 'authError', 'Invalid Credentials');
    }
    if (this.quotaExceeded)
      return this.error(
        res,
        403,
        'quotaExceeded',
        'The request cannot be completed because you have exceeded your quota.',
      );

    if (url.pathname === '/youtube/v3/channels') {
      return this.json(res, 200, {
        items: [
          {
            id: 'UCfake',
            snippet: { title: 'Thomas' },
            statistics: {
              subscriberCount: String(this.subscribers),
              viewCount: String(
                this.videos.reduce(
                  (t, v) => t + Object.values(v.daily).reduce((a, b) => a + b, 0),
                  0,
                ),
              ),
              videoCount: String(this.videos.length),
            },
            contentDetails: { relatedPlaylists: { uploads: 'UUfake' } },
          },
        ],
      });
    }
    if (url.pathname === '/youtube/v3/playlistItems') {
      return this.json(res, 200, {
        items: this.videos.map((v) => ({ contentDetails: { videoId: v.id } })),
      });
    }
    if (url.pathname === '/youtube/v3/videos') {
      const ids = (url.searchParams.get('id') ?? '').split(',');
      return this.json(res, 200, {
        items: this.videos
          .filter((v) => ids.includes(v.id))
          .map((v) => ({
            id: v.id,
            snippet: {
              title: v.title,
              publishedAt: v.publishedAt,
              thumbnails: { medium: { url: `https://i.ytimg.com/${v.id}.jpg` } },
            },
            contentDetails: {
              duration: `PT${Math.floor(v.durationSec / 60)}M${v.durationSec % 60}S`,
            },
            statistics: {
              viewCount: String(Object.values(v.daily).reduce((a, b) => a + b, 0)),
              likeCount: '3',
              commentCount: '1',
            },
            status: { privacyStatus: 'public' },
          })),
      });
    }
    if (url.pathname === '/v2/reports') return this.report(url.searchParams, res);
    return this.error(res, 404, 'notFound');
  }

  private report(params: URLSearchParams, res: ServerResponse) {
    this.reports.push(params);
    if (!this.grantedScope.includes('yt-analytics.readonly')) {
      return this.error(
        res,
        403,
        'insufficientPermissions',
        'Request had insufficient authentication scopes.',
      );
    }
    const metrics = (params.get('metrics') ?? '').split(',');
    const dimensions = (params.get('dimensions') ?? '').split(',').filter(Boolean);
    if (this.reachUnsupported && metrics.some((m) => m.startsWith('videoThumbnail'))) {
      return this.error(
        res,
        400,
        'badRequest',
        'Unknown identifier (videoThumbnailImpressions) given in field parameters.metrics.',
      );
    }
    const filters = params.get('filters') ?? '';
    const videoId = /video==([\w-]+)/.exec(filters)?.[1];
    const videos = videoId ? this.videos.filter((v) => v.id === videoId) : this.videos;
    const start = params.get('startDate')!;
    const end = params.get('endDate')!;
    const headers = [...dimensions, ...metrics].map((name) => ({ name }));
    const metricValue = (name: string, views: number) => {
      switch (name) {
        case 'views':
          return views;
        case 'engagedViews':
          return Math.round(views * 0.8);
        case 'estimatedMinutesWatched':
          return views * 0.5;
        case 'averageViewDuration':
          return 30;
        case 'averageViewPercentage':
          return 61.5;
        case 'subscribersGained':
          return Math.round(views / 50);
        case 'subscribersLost':
          return 0;
        case 'likes':
          return Math.round(views / 20);
        case 'videoThumbnailImpressions':
          return views * 20;
        case 'videoThumbnailImpressionsClickRate':
          return 5;
        default:
          return 0;
      }
    };
    let rows: (string | number)[][] = [];
    if (dimensions[0] === 'day') {
      const days = new Map<string, number>();
      for (const v of videos) {
        for (const [day, views] of Object.entries(v.daily)) {
          if (day >= start && day <= end) days.set(day, (days.get(day) ?? 0) + views);
        }
      }
      rows = [...days.entries()]
        .sort()
        .map(([day, views]) => [day, ...metrics.map((m) => metricValue(m, views))]);
    } else if (dimensions[0] === 'elapsedVideoTimeRatio') {
      rows = Array.from({ length: 100 }, (_, i) => [(i + 1) / 100, 1 - i * 0.006, 0.55]);
    } else if (dimensions[0] === 'creatorContentType') {
      const types = new Map<string, number>();
      for (const v of videos)
        types.set(
          v.shorts ? 'SHORTS' : 'VIDEO_ON_DEMAND',
          (types.get(v.shorts ? 'SHORTS' : 'VIDEO_ON_DEMAND') ?? 0) + 10,
        );
      rows = [...types.entries()];
    } else if (dimensions[0] === 'ageGroup') {
      rows = [
        ['age18-24', 'male', 60],
        ['age25-34', 'female', 40],
      ];
    } else if (dimensions[0] === 'insightTrafficSourceDetail') {
      rows = [['other-video', 4]];
    } else if (dimensions.length) {
      const keys: Record<string, string[]> = {
        insightTrafficSourceType: ['SHORTS', 'YT_SEARCH'],
        country: ['BE', 'FR'],
        deviceType: ['MOBILE', 'DESKTOP'],
        insightPlaybackLocationType: ['WATCH', 'SHORTS'],
      };
      rows = (keys[dimensions[0]!] ?? []).map((k, i) => [
        k,
        ...metrics.map((m) => (m === 'views' ? 10 - i * 4 : 3)),
      ]);
    }
    return this.json(res, 200, {
      kind: 'youtubeAnalytics#resultTable',
      columnHeaders: headers,
      rows,
    });
  }
}
