// A small fake of Google's OAuth and YouTube Data API v3 servers for the
// tests: PKCE token exchange, refresh, resumable uploads (308, Range, status
// query), videos.list/update/delete, thumbnails, playlists, channels — with
// switches to inject failures (quota, expired token, network cut, 5xx).
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockVideo {
  id: string;
  snippet: Record<string, unknown>;
  status: { privacyStatus: string; publishAt?: string; uploadStatus: string };
  bytes: number;
}

interface Session {
  id: string;
  total: number;
  received: number;
  resource: { snippet: Record<string, unknown>; status: Record<string, unknown> };
  done: MockVideo | null;
}

export class MockGoogle {
  base = '';
  private server: Server;
  private tokenCounter = 0;
  private validToken: string | null = null;
  private challenges = new Map<string, string>();
  readonly sessions = new Map<string, Session>();
  readonly videos = new Map<string, MockVideo>();
  readonly playlistItems: { playlistId: string; videoId: string }[] = [];
  readonly thumbnails: string[] = [];
  readonly log: string[] = [];

  // Failure switches.
  quotaExceeded = false;
  refreshInvalid = false;
  thumbnailsForbidden = false;
  /** Videos stay private, publishAt dropped (project restricted to private). */
  restrictToPrivate = false;
  /** Cuts the connection once after this many bytes of a session were received. */
  cutAfterBytes: number | null = null;
  /** Answers 503 to the next N chunk uploads. */
  fail503 = 0;

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

  /** Endpoints for createTestHub({ accountProviders: { google: … } }). */
  get provider() {
    return {
      authUrl: `${this.base}/o/oauth2/v2/auth`,
      tokenUrl: `${this.base}/token`,
      revokeUrl: `${this.base}/revoke`,
      apiBase: this.base,
    };
  }

  /** Acts as the browser: the user accepts on the consent page, Google redirects. */
  async consent(authUrl: string, approve = true): Promise<number> {
    const url = new URL(authUrl);
    const code = `code-${Date.now()}`;
    this.challenges.set(code, url.searchParams.get('code_challenge') ?? '');
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('state', url.searchParams.get('state')!);
    if (approve) redirect.searchParams.set('code', code);
    else redirect.searchParams.set('error', 'access_denied');
    const response = await fetch(redirect);
    return response.status;
  }

  /** The current access token stops working (expired). */
  expireToken(): void {
    this.validToken = null;
  }

  /** A valid access token (tests calling the API client directly). */
  issueToken(): string {
    this.validToken = `access-${++this.tokenCounter}`;
    return this.validToken;
  }

  private async readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  private json(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  private error(res: ServerResponse, status: number, reason: string, message = reason) {
    this.json(res, status, { error: { code: status, message, errors: [{ reason, message }] } });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.base);
    this.log.push(`${req.method} ${url.pathname}`);

    if (url.pathname === '/token') {
      const params = new URLSearchParams((await this.readBody(req)).toString());
      if (
        params.get('client_id') !== 'client-id' ||
        params.get('client_secret') !== 'client-secret'
      ) {
        return this.json(res, 401, { error: 'invalid_client' });
      }
      if (params.get('grant_type') === 'authorization_code') {
        const challenge = this.challenges.get(params.get('code') ?? '');
        const verifier = params.get('code_verifier') ?? '';
        const expected = createHash('sha256').update(verifier).digest('base64url');
        if (!challenge || challenge !== expected)
          return this.json(res, 400, { error: 'invalid_grant', error_description: 'PKCE' });
        return this.json(res, 200, {
          access_token: this.issueToken(),
          expires_in: 3600,
          refresh_token: 'refresh-1',
          scope: 'https://www.googleapis.com/auth/youtube',
        });
      }
      if (params.get('grant_type') === 'refresh_token') {
        if (this.refreshInvalid || params.get('refresh_token') !== 'refresh-1') {
          return this.json(res, 400, {
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          });
        }
        return this.json(res, 200, { access_token: this.issueToken(), expires_in: 3600 });
      }
      return this.json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/revoke') {
      await this.readBody(req);
      return this.json(res, 200, {});
    }

    // Everything else needs the bearer token.
    if (req.headers.authorization !== `Bearer ${this.validToken}` || !this.validToken) {
      await this.readBody(req);
      return this.error(res, 401, 'authError', 'Invalid Credentials');
    }

    if (req.method === 'POST' && url.pathname === '/upload/youtube/v3/videos') {
      const resource = JSON.parse((await this.readBody(req)).toString()) as Session['resource'];
      if (this.quotaExceeded)
        return this.error(
          res,
          403,
          'quotaExceeded',
          'The request cannot be completed because you have exceeded your quota.',
        );
      const id = `s${this.sessions.size + 1}`;
      this.sessions.set(id, {
        id,
        total: Number(req.headers['x-upload-content-length']),
        received: 0,
        resource,
        done: null,
      });
      res.writeHead(200, { location: `${this.base}/upload-session/${id}` });
      return void res.end();
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/upload-session/')) {
      const session = this.sessions.get(url.pathname.split('/').pop()!);
      if (!session) return this.error(res, 404, 'notFound');
      const range = String(req.headers['content-range'] ?? '');
      const status = (done: boolean) => {
        if (done && session.done) return this.json(res, 201, session.done);
        res.writeHead(
          308,
          session.received > 0 ? { range: `bytes=0-${session.received - 1}` } : {},
        );
        res.end();
      };
      if (range.startsWith('bytes */')) {
        await this.readBody(req);
        return status(session.received >= session.total);
      }
      const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
      if (!match) return this.error(res, 400, 'badRange');
      if (this.fail503 > 0) {
        this.fail503--;
        await this.readBody(req);
        return this.error(res, 503, 'backendError');
      }
      const start = Number(match[1]);
      if (start !== session.received) {
        await this.readBody(req);
        return status(false);
      }
      if (this.cutAfterBytes !== null) {
        // Keeps part of the chunk, then the "network" drops.
        const keep = this.cutAfterBytes - session.received;
        if (keep > 0 && keep < Number(match[2]) - start + 1) {
          this.cutAfterBytes = null;
          const body = await this.readBody(req);
          session.received += Math.min(keep, body.length);
          req.socket.destroy();
          return;
        }
      }
      const body = await this.readBody(req);
      session.received += body.length;
      if (session.received >= session.total) {
        const id = `vid${this.videos.size + 1}`;
        const wanted = session.resource.status as { privacyStatus: string; publishAt?: string };
        const video: MockVideo = {
          id,
          snippet: session.resource.snippet,
          status: {
            privacyStatus: wanted.privacyStatus,
            ...(wanted.publishAt && !this.restrictToPrivate ? { publishAt: wanted.publishAt } : {}),
            uploadStatus: 'uploaded',
          },
          bytes: session.received,
        };
        if (this.restrictToPrivate) video.status.privacyStatus = 'private';
        this.videos.set(id, video);
        session.done = video;
        return this.json(res, 201, video);
      }
      return status(false);
    }

    if (url.pathname === '/youtube/v3/videos') {
      if (req.method === 'GET') {
        const ids = (url.searchParams.get('id') ?? '').split(',');
        return this.json(res, 200, {
          items: ids.flatMap((id) => {
            const video = this.videos.get(id);
            return video ? [{ id, status: video.status }] : [];
          }),
        });
      }
      if (req.method === 'PUT') {
        const update = JSON.parse((await this.readBody(req)).toString()) as {
          id: string;
          status: { privacyStatus: string; publishAt?: string; selfDeclaredMadeForKids?: boolean };
        };
        const video = this.videos.get(update.id);
        if (!video) return this.error(res, 404, 'videoNotFound');
        if (update.status.publishAt && update.status.privacyStatus !== 'private') {
          return this.error(res, 400, 'invalidPublishAt');
        }
        if (update.status.selfDeclaredMadeForKids !== false)
          return this.error(res, 400, 'missingMadeForKids');
        video.status = { ...update.status, uploadStatus: video.status.uploadStatus };
        return this.json(res, 200, { id: video.id, status: video.status });
      }
      if (req.method === 'DELETE') {
        this.videos.delete(url.searchParams.get('id') ?? '');
        res.writeHead(204);
        return void res.end();
      }
    }

    if (req.method === 'POST' && url.pathname === '/upload/youtube/v3/thumbnails/set') {
      await this.readBody(req);
      if (this.thumbnailsForbidden) {
        return this.error(
          res,
          403,
          'forbidden',
          'The user does not have permissions to upload and set custom video thumbnails.',
        );
      }
      this.thumbnails.push(url.searchParams.get('videoId') ?? '');
      return this.json(res, 200, { items: [] });
    }

    if (url.pathname === '/youtube/v3/playlists') {
      return this.json(res, 200, {
        items: [
          { id: 'PLother', snippet: { title: 'Autre' } },
          { id: 'PLsons', snippet: { title: 'GrosKaillou – Sons' } },
        ],
      });
    }
    if (req.method === 'POST' && url.pathname === '/youtube/v3/playlistItems') {
      const item = JSON.parse((await this.readBody(req)).toString()) as {
        snippet: { playlistId: string; resourceId: { videoId: string } };
      };
      this.playlistItems.push({
        playlistId: item.snippet.playlistId,
        videoId: item.snippet.resourceId.videoId,
      });
      return this.json(res, 200, { id: 'pli1' });
    }
    if (url.pathname === '/youtube/v3/channels') {
      return this.json(res, 200, { items: [{ id: 'UC1', snippet: { title: 'GrosKaillou' } }] });
    }
    this.error(res, 404, 'notFound');
  }
}
