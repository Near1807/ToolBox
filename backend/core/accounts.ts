// Connected accounts (ctx.accounts): OAuth 2.0 for installed apps — the system
// browser opens the provider's consent page, which redirects to a one-shot
// loopback server on 127.0.0.1 (PKCE S256, random state). Tokens are stored
// encrypted (safeStorage through the HostAdapter) in core__accounts. The core
// knows OAuth providers, never what a module does with them (YouTube…).
// See docs/decisions/0018-comptes-oauth.md.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AccountError,
  type AccountStatus,
  type ModuleAccounts,
  type ModuleLogger,
  type ModuleManifest,
} from '../../packages/sdk/backend';
import type { SettingField } from '../../packages/sdk/manifest';
import type { DatabaseHandle } from './database';
import type { HostAdapter } from './host';
import type { SettingsStore } from './settings';

export interface OAuthProvider {
  id: string;
  label: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  /** Base of the provider's APIs: ctx.accounts.fetch resolves "/path" against it. */
  apiBase: string;
}

/** Providers known to the core. Endpoints can be overridden (tests, mock servers). */
export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    id: 'google',
    label: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    apiBase: 'https://www.googleapis.com',
  },
};

/** Settings scope holding the OAuth client of each provider (entered by the user). */
export const ACCOUNTS_SCOPE = 'accounts';

export function accountSettingsFields(): SettingField[] {
  return [
    {
      key: 'googleClientId',
      type: 'string',
      label: 'Google — ID client OAuth',
      description:
        'Identifiant du client OAuth de type « Application de bureau » créé dans Google Cloud (voir l’aide du Planning de sortie). Se termine par .apps.googleusercontent.com.',
      placeholder: '123456789-abc.apps.googleusercontent.com',
    },
    {
      key: 'googleClientSecret',
      type: 'secret',
      label: 'Google — code secret du client',
      description: 'Fourni avec l’ID client. Enregistré chiffré, jamais réaffiché.',
    },
  ];
}

/** How long the user has to answer in the browser. */
const CONNECT_TIMEOUT_MS = 5 * 60_000;
/** Access tokens are refreshed a little before they expire. */
const EXPIRY_MARGIN_MS = 60_000;

interface AccountRow {
  provider: string;
  scopes: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  status: 'connected' | 'reauth-required';
  error: string | null;
  connected_at: string;
  updated_at: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

const base64url = (buffer: Buffer) => buffer.toString('base64url');

/** PKCE pair (RFC 7636): random verifier, SHA-256 challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>ToolBox</title>
<style>body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1115;color:#e6e8ec;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:460px;text-align:center}h1{font-size:1.3rem}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

interface PendingFlow {
  server: Server;
  cancel: (reason: AccountError) => void;
}

export class AccountManager {
  private readonly providers: Record<string, OAuthProvider>;
  private readonly pending = new Map<string, PendingFlow>();
  /** One refresh at a time per provider (parallel uploads share it). */
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly handle: DatabaseHandle,
    private readonly host: HostAdapter,
    private readonly settings: SettingsStore,
    private readonly logger: ModuleLogger,
    overrides: Record<string, Partial<OAuthProvider>> = {},
  ) {
    this.providers = Object.fromEntries(
      Object.entries(OAUTH_PROVIDERS).map(([id, provider]) => [
        id,
        { ...provider, ...overrides[id] },
      ]),
    );
  }

  private provider(id: string): OAuthProvider {
    const provider = this.providers[id];
    if (!provider)
      throw new AccountError('not-configured', `Fournisseur de compte inconnu « ${id} »`);
    return provider;
  }

  private client(provider: OAuthProvider): { id: string; secret: string | null } | null {
    const id = this.settings.get(ACCOUNTS_SCOPE, `${provider.id}ClientId`);
    if (typeof id !== 'string' || id.trim() === '') return null;
    let secret: string | null;
    try {
      const value = this.settings.get(ACCOUNTS_SCOPE, `${provider.id}ClientSecret`);
      secret = typeof value === 'string' && value !== '' ? value : null;
    } catch {
      secret = null; // Undecryptable (other Windows account): treated as missing.
    }
    return { id: id.trim(), secret };
  }

  private requireClient(provider: OAuthProvider): { id: string; secret: string | null } {
    const client = this.client(provider);
    if (!client) {
      throw new AccountError(
        'not-configured',
        `Compte ${provider.label} non configuré : renseigne l’ID client OAuth dans Réglages > Comptes connectés`,
      );
    }
    return client;
  }

  private row(provider: string): AccountRow | undefined {
    return this.handle.db
      .prepare('SELECT * FROM core__accounts WHERE provider = ?')
      .get(provider) as AccountRow | undefined;
  }

  private encrypt(text: string): string {
    if (!this.host.isEncryptionAvailable()) {
      throw new AccountError(
        'encryption',
        'Chiffrement indisponible : impossible d’enregistrer les jetons du compte',
      );
    }
    return this.host.encryptString(text).toString('base64');
  }

  private decrypt(value: string): string {
    return this.host.decryptString(Buffer.from(value, 'base64'));
  }

  status(providerId: string): AccountStatus {
    const provider = this.provider(providerId);
    const row = this.row(providerId);
    return {
      provider: provider.id,
      label: provider.label,
      configured: this.client(provider) !== null,
      connected: row !== undefined,
      needsReconnect: row?.status === 'reauth-required',
      scopes: row ? (JSON.parse(row.scopes) as string[]) : [],
      connectedAt: row?.connected_at ?? null,
      error: row?.error ?? null,
      connecting: this.pending.has(providerId),
    };
  }

  describe(): AccountStatus[] {
    return Object.keys(this.providers).map((id) => this.status(id));
  }

  /**
   * Opens the consent page in the browser and waits for the answer (5 min).
   * Scopes already granted are kept (incremental authorization).
   */
  async connect(providerId: string, scopes: string[]): Promise<AccountStatus> {
    const provider = this.provider(providerId);
    const client = this.requireClient(provider);
    if (!this.host.isEncryptionAvailable()) this.encrypt(''); // throws the clear message
    this.pending.get(providerId)?.cancel(new AccountError('cancelled', 'Connexion relancée'));

    const granted = this.status(providerId).scopes;
    const wanted = [...new Set([...granted, ...scopes])];
    const { verifier, challenge } = createPkce();
    const state = base64url(randomBytes(24));

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          finish(
            new AccountError('cancelled', 'Pas de réponse dans le navigateur (5 min) : réessaie'),
          ),
        CONNECT_TIMEOUT_MS,
      );
      const finish = (error: AccountError | null, value?: string) => {
        clearTimeout(timer);
        this.pending.delete(providerId);
        server.close();
        server.closeAllConnections?.();
        if (error) reject(error);
        else resolve(value!);
      };
      this.pending.set(providerId, { server, cancel: (reason) => finish(reason) });

      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', redirectUri);
        if (url.pathname !== '/') {
          response.writeHead(404).end();
          return;
        }
        const reply = (status: number, title: string, text: string) => {
          response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
          response.end(PAGE(title, text));
        };
        if (url.searchParams.get('state') !== state) {
          reply(
            400,
            'Connexion refusée',
            'Réponse inattendue : relance la connexion depuis ToolBox.',
          );
          return;
        }
        const error = url.searchParams.get('error');
        const value = url.searchParams.get('code');
        if (error || !value) {
          reply(200, 'Connexion annulée', 'Tu peux fermer cet onglet et revenir à ToolBox.');
          finish(
            new AccountError(
              'denied',
              error === 'access_denied'
                ? 'Autorisation refusée dans le navigateur'
                : `Connexion refusée par ${provider.label} : ${error ?? 'pas de code'}`,
            ),
          );
          return;
        }
        reply(200, 'Compte connecté ✓', 'Tu peux fermer cet onglet et revenir à ToolBox.');
        finish(null, value);
      });

      const authUrl = new URL(provider.authUrl);
      authUrl.search = new URLSearchParams({
        client_id: client.id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: wanted.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      }).toString();
      this.host.openExternal(authUrl.toString()).catch((error: unknown) => {
        finish(new AccountError('network', `Navigateur impossible à ouvrir : ${String(error)}`));
      });
    });

    const tokens = await this.tokenRequest(provider, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: client.id,
      ...(client.secret ? { client_secret: client.secret } : {}),
    });
    if (!tokens.access_token) {
      throw new AccountError('denied', `${provider.label} n’a pas renvoyé de jeton d’accès`);
    }
    const refresh = tokens.refresh_token ?? this.storedRefreshToken(providerId);
    if (!refresh) {
      throw new AccountError(
        'denied',
        `${provider.label} n’a pas renvoyé de jeton de longue durée : retire l’accès de ToolBox dans ton compte Google puis reconnecte-toi`,
      );
    }
    const now = new Date().toISOString();
    const grantedScopes = tokens.scope ? tokens.scope.split(' ').filter(Boolean) : wanted;
    this.handle.db
      .prepare(
        `INSERT INTO core__accounts (provider, scopes, refresh_token, access_token, access_expires_at,
           status, error, connected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'connected', NULL, ?, ?)
         ON CONFLICT (provider) DO UPDATE SET scopes = excluded.scopes,
           refresh_token = excluded.refresh_token, access_token = excluded.access_token,
           access_expires_at = excluded.access_expires_at, status = 'connected', error = NULL,
           connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
      )
      .run(
        providerId,
        JSON.stringify(grantedScopes),
        this.encrypt(refresh),
        this.encrypt(tokens.access_token),
        new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
        now,
        now,
      );
    this.logger.info(`Compte ${provider.label} connecté (${grantedScopes.length} autorisation(s))`);
    return this.status(providerId);
  }

  private storedRefreshToken(providerId: string): string | null {
    const row = this.row(providerId);
    return row ? this.decrypt(row.refresh_token) : null;
  }

  private async tokenRequest(
    provider: OAuthProvider,
    params: Record<string, string>,
  ): Promise<TokenResponse> {
    let response: Response;
    try {
      response = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
    } catch (error) {
      throw new AccountError('network', `${provider.label} injoignable : ${String(error)}`);
    }
    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || body.error) {
      const reason = body.error_description ?? body.error ?? `HTTP ${response.status}`;
      if (body.error === 'invalid_grant') {
        throw new AccountError(
          'reauth-required',
          `Autorisation ${provider.label} expirée ou révoquée : reconnecte le compte (${reason})`,
        );
      }
      if (body.error === 'invalid_client' || body.error === 'unauthorized_client') {
        throw new AccountError(
          'not-configured',
          `ID client ou code secret ${provider.label} refusé : vérifie Réglages > Comptes connectés (${reason})`,
        );
      }
      throw new AccountError(
        'network',
        `Échec de l’échange de jeton ${provider.label} : ${reason}`,
      );
    }
    return body;
  }

  /** A valid access token, refreshed when needed. */
  async accessToken(providerId: string, options: { forceRefresh?: boolean } = {}): Promise<string> {
    const provider = this.provider(providerId);
    const row = this.row(providerId);
    if (!row) {
      throw new AccountError(
        'not-connected',
        `Aucun compte ${provider.label} connecté : connecte-le d’abord`,
      );
    }
    if (row.status === 'reauth-required') {
      throw new AccountError(
        'reauth-required',
        row.error ?? `Le compte ${provider.label} doit être reconnecté`,
      );
    }
    const valid =
      row.access_token &&
      row.access_expires_at &&
      new Date(row.access_expires_at).getTime() - EXPIRY_MARGIN_MS > Date.now();
    if (valid && !options.forceRefresh) return this.decrypt(row.access_token!);

    const running = this.refreshing.get(providerId);
    if (running) return running;
    const refresh = this.refresh(provider, row).finally(() => this.refreshing.delete(providerId));
    this.refreshing.set(providerId, refresh);
    return refresh;
  }

  private async refresh(provider: OAuthProvider, row: AccountRow): Promise<string> {
    const client = this.requireClient(provider);
    try {
      const tokens = await this.tokenRequest(provider, {
        grant_type: 'refresh_token',
        refresh_token: this.decrypt(row.refresh_token),
        client_id: client.id,
        ...(client.secret ? { client_secret: client.secret } : {}),
      });
      if (!tokens.access_token) throw new AccountError('network', 'Jeton d’accès absent');
      this.handle.db
        .prepare(
          `UPDATE core__accounts SET access_token = ?, access_expires_at = ?, updated_at = ?
           WHERE provider = ?`,
        )
        .run(
          this.encrypt(tokens.access_token),
          new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
          new Date().toISOString(),
          provider.id,
        );
      return tokens.access_token;
    } catch (error) {
      if (error instanceof AccountError && error.code === 'reauth-required') {
        this.handle.db
          .prepare(
            `UPDATE core__accounts SET status = 'reauth-required', error = ?, access_token = NULL,
             updated_at = ? WHERE provider = ?`,
          )
          .run(error.message, new Date().toISOString(), provider.id);
        this.logger.warn(error.message);
      }
      throw error;
    }
  }

  /**
   * fetch() with the account's bearer token. "/path" is resolved against the
   * provider's API base. On 401 the token is refreshed and the request sent
   * once more (the body must be a string or a Buffer, not a stream).
   */
  async fetch(providerId: string, url: string, init: RequestInit = {}): Promise<Response> {
    const provider = this.provider(providerId);
    const target = url.startsWith('/') ? `${provider.apiBase}${url}` : url;
    const send = async (token: string) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      return fetch(target, { ...init, headers });
    };
    const response = await send(await this.accessToken(providerId));
    if (response.status !== 401) return response;
    await response.body?.cancel();
    return send(await this.accessToken(providerId, { forceRefresh: true }));
  }

  /** Revokes the tokens at the provider (best effort) and forgets the account. */
  async disconnect(providerId: string): Promise<void> {
    const provider = this.provider(providerId);
    this.pending.get(providerId)?.cancel(new AccountError('cancelled', 'Connexion annulée'));
    const refresh = (() => {
      try {
        return this.storedRefreshToken(providerId);
      } catch {
        return null;
      }
    })();
    if (refresh) {
      try {
        await fetch(provider.revokeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refresh }).toString(),
        });
      } catch (error) {
        this.logger.warn(
          `Révocation ${provider.label} impossible (compte oublié quand même)`,
          error,
        );
      }
    }
    this.handle.db.prepare('DELETE FROM core__accounts WHERE provider = ?').run(providerId);
    this.logger.info(`Compte ${provider.label} déconnecté`);
  }

  /** Cancels a pending browser flow (shutdown). */
  stop(): void {
    for (const flow of this.pending.values()) {
      flow.cancel(new AccountError('cancelled', 'Arrêt de ToolBox'));
    }
  }

  /** ctx.accounts of a module: only the providers declared in permissions.accounts. */
  forModule(manifest: ModuleManifest): ModuleAccounts {
    const declared = new Set(manifest.permissions?.accounts ?? []);
    const check = (provider: string) => {
      if (!declared.has(provider)) {
        throw new AccountError(
          'not-configured',
          `Compte « ${provider} » non déclaré dans permissions.accounts de module.json`,
        );
      }
      return provider;
    };
    return {
      available: true,
      status: (provider) => this.status(check(provider)),
      connect: (provider, scopes) => this.connect(check(provider), scopes),
      disconnect: (provider) => this.disconnect(check(provider)),
      accessToken: (provider) => this.accessToken(check(provider)),
      fetch: (provider, url, init) => this.fetch(check(provider), url, init),
    };
  }
}
