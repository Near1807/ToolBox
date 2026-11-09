// The PC's side of the synchronisation (ADR 0044): an HTTPS listener on the
// local network, OFF by default; it listens only once Thomas has turned the
// synchronisation on (Réglages › Synchro avec le téléphone, with a
// confirmation). Without it the PC opens no port, as before.
// - Certificate: self-signed (ECDSA P-256), made once and kept (its private
//   key encrypted by the system when it can be); the phone pins it by its
//   fingerprint, read in the QR code.
// - Pairing: a single-use token (10 minutes, 5 tries), exchanged for a
//   lasting token per device; only its SHA-256 is kept on the PC.
//   « Oublier cet appareil » revokes it at once.
// - Every exchange: the device's token, then the versions (the PC is the
//   master), then the engine. Before the first synchronisation, a backup of
//   the base (like before a migration).
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import selfsigned from 'selfsigned';
import type { Hub } from '../hub';
import { createAutomaticBackup } from '../backups';
import { SyncError } from './engine';
import { encodeAddress, encodePairing, pinOf } from './pairing-code';
import { mdnsAnnouncer, type Announcer } from './announce';
import { SyncFiles, type FileChunk, type FileRef } from './files';
import {
  serveExchange,
  serveFirst,
  versionMessage,
  VersionMismatch,
  type ExchangeRequest,
  type FirstRequest,
} from './protocol';

export const DEFAULT_SYNC_PORT = 47400;
const PAIRING_MINUTES = 10;
const PAIRING_TRIES = 5;

export interface PeerInfo {
  device_id: string;
  name: string;
  created_at: string;
  first_sync_at: string | null;
  last_sync_at: string | null;
}

export interface SyncStatus {
  enabled: boolean;
  listening: boolean;
  port: number;
  addresses: string[];
  fingerprint: string | null;
  device: string;
  peers: PeerInfo[];
  /** The last exchange refused for the versions (a sentence for the PC), or null. */
  refusal: string | null;
  conflicts: number;
  error: string | null;
  /** Announced on the local network (mDNS), so the phone finds the PC on any Wi-Fi. */
  announced: boolean;
  /** Why the announcement failed (the rest works without it), or null. */
  announceError: string | null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The PC's IPv4 addresses on a local network (private ranges), best first. */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? [])
      if (
        a.family === 'IPv4' &&
        !a.internal &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
      )
        out.push(a.address);
  return out.sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));
}

export class SyncServer {
  private app: FastifyInstance | null = null;
  private pairing: { token: string; expires: number; tries: number } | null = null;
  private refusal: string | null = null;
  private error: string | null = null;
  /** Stops the mDNS announcement (null: nothing announced). */
  private unannounce: (() => Promise<void>) | null = null;
  private announceError: string | null = null;
  private filesCache: SyncFiles | null = null;

  constructor(
    private readonly hub: Hub,
    private readonly appVersion: string,
    /** The PC's local addresses (the tests give 127.0.0.1). */
    private readonly addresses: () => string[] = localAddresses,
    /** The announcement on the local network (mDNS; the tests give their own). */
    private readonly announcer: Announcer | null = mdnsAnnouncer,
  ) {}

  /** Whether the PC is announced on the local network right now (mDNS). */
  get announced(): boolean {
    return this.unannounce !== null;
  }

  private meta(key: string): string | null {
    const row = this.hub.handle.db
      .prepare('SELECT value FROM core__meta WHERE key = ?')
      .get(`sync.${key}`) as { value: string } | undefined;
    return row?.value ?? null;
  }
  private setMeta(key: string, value: string | null) {
    if (value === null)
      this.hub.handle.db.prepare('DELETE FROM core__meta WHERE key = ?').run(`sync.${key}`);
    else
      this.hub.handle.db
        .prepare(
          'INSERT INTO core__meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        )
        .run(`sync.${key}`, value);
  }

  get enabled(): boolean {
    return this.meta('listen') === '1';
  }
  get port(): number {
    return Number(this.meta('port') ?? DEFAULT_SYNC_PORT);
  }
  get listening(): boolean {
    return this.app !== null;
  }

  /** The certificate (made once, then kept). */
  private async certificate(): Promise<{ cert: string; key: string }> {
    const cert = this.meta('cert');
    const stored = this.meta('key');
    if (cert && stored) {
      const key = stored.startsWith('enc:')
        ? this.hub.host.decryptString(Buffer.from(stored.slice(4), 'base64'))
        : stored;
      return { cert, key };
    }
    const notAfter = new Date();
    notAfter.setFullYear(notAfter.getFullYear() + 20);
    const made = await selfsigned.generate([{ name: 'commonName', value: 'ToolBox PC' }], {
      keyType: 'ec',
      algorithm: 'sha256',
      notAfterDate: notAfter,
    });
    this.setMeta('cert', made.cert);
    this.setMeta(
      'key',
      this.hub.host.isEncryptionAvailable()
        ? `enc:${this.hub.host.encryptString(made.private).toString('base64')}`
        : made.private,
    );
    return { cert: made.cert, key: made.private };
  }

  fingerprint(): string | null {
    const cert = this.meta('cert');
    return cert ? new X509Certificate(cert).fingerprint256 : null;
  }

  status(): SyncStatus {
    return {
      enabled: this.enabled,
      listening: this.listening,
      port: this.port,
      addresses: this.addresses(),
      fingerprint: this.fingerprint(),
      device: this.hub.sync.device,
      peers: this.hub.handle.db
        .prepare(
          "SELECT device_id, name, created_at, first_sync_at, last_sync_at FROM core__sync_peers WHERE revoked_at IS NULL AND role = 'phone' ORDER BY created_at",
        )
        .all() as PeerInfo[],
      refusal: this.refusal,
      conflicts: this.hub.sync.conflicts().length,
      error: this.error,
      announced: this.announced,
      announceError: this.announceError,
    };
  }

  /** Turns the listener on (after Thomas's confirmation) or off. */
  async setEnabled(on: boolean, port?: number): Promise<SyncStatus> {
    if (port !== undefined) {
      if (!(Number.isInteger(port) && port >= 1024 && port <= 65535))
        throw new SyncError('Port invalide (1024 à 65535)');
      this.setMeta('port', String(port));
    }
    this.setMeta('listen', on ? '1' : null);
    await this.stop();
    if (on) await this.start();
    return this.status();
  }

  /** At start-up: listens only if the synchronisation was turned on. */
  async start(): Promise<void> {
    if (!this.enabled || this.app) return;
    this.error = null;
    const { cert, key } = await this.certificate();
    const app = Fastify({
      logger: false,
      https: { key, cert },
      bodyLimit: 64 * 1024 * 1024,
      forceCloseConnections: true,
    });
    this.routes(app);
    try {
      await app.listen({ host: '0.0.0.0', port: this.port });
      this.app = app;
      this.hub.logger.info(`Synchro : écoute sur le réseau local, port ${this.port}`);
      this.announce();
    } catch (error) {
      this.error =
        (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? `Le port ${this.port} est déjà utilisé : choisis-en un autre.`
          : `L’écoute n’a pas pu démarrer : ${(error as Error).message}`;
      await app.close().catch(() => undefined);
    }
  }

  /** Announces the PC on the local network (only while listening). Never blocks the listener. */
  private announce() {
    if (!this.announcer || this.unannounce) return;
    this.announceError = null;
    try {
      this.unannounce = this.announcer({
        port: this.port,
        id: this.hub.sync.device,
        onError: (error) => {
          this.announceError = `Annonce sur le réseau impossible : ${error.message}`;
          this.hub.logger.warn(`Synchro : ${this.announceError}`);
        },
      });
    } catch (error) {
      this.announceError = `Annonce sur le réseau impossible : ${(error as Error).message}`;
      this.hub.logger.warn(`Synchro : ${this.announceError}`);
    }
  }

  async stop(): Promise<void> {
    const app = this.app;
    this.app = null;
    this.pairing = null;
    const unannounce = this.unannounce;
    this.unannounce = null;
    if (unannounce) await unannounce().catch(() => undefined);
    if (app) await app.close();
  }

  /** The PC's addresses for the phone (https://ip:port), best first. */
  urls(): string[] {
    return this.addresses().map((a) => `https://${a}:${this.port}`);
  }

  /**
   * « QR de l'adresse » : the address on the network the PC is on now, its
   * port and its certificate's fingerprint, WITHOUT any token. For a phone
   * already paired, on another Wi-Fi: no new pairing, no new first sync.
   */
  addressCode(address?: string): { code: string; address: string } {
    if (!this.listening)
      throw new SyncError('Active d’abord la synchro (l’écoute du réseau local).');
    const addresses = this.addresses();
    const host = address && addresses.includes(address) ? address : addresses[0];
    if (!host)
      throw new SyncError(
        'Aucun réseau local trouvé : le PC est-il connecté au Wi-Fi ou au câble ?',
      );
    return {
      code: encodeAddress({ host, port: this.port, pin: pinOf(this.fingerprint()!) }),
      address: host,
    };
  }

  /** A new single-use code for « Appairer un téléphone » (the address chosen among the PC's). */
  newPairing(address?: string): { code: string; expiresAt: string; address: string } {
    if (!this.listening)
      throw new SyncError('Active d’abord la synchro (l’écoute du réseau local).');
    const addresses = this.addresses();
    const host = address && addresses.includes(address) ? address : addresses[0];
    if (!host)
      throw new SyncError(
        'Aucun réseau local trouvé : le PC est-il connecté au Wi-Fi ou au câble ?',
      );
    const token = randomBytes(10).toString('hex');
    const expires = Date.now() + PAIRING_MINUTES * 60_000;
    this.pairing = { token, expires, tries: 0 };
    const fingerprint = this.fingerprint()!;
    return {
      code: encodePairing({ host, port: this.port, token, pin: pinOf(fingerprint) }),
      expiresAt: new Date(expires).toISOString(),
      address: host,
    };
  }

  /** « Oublier cet appareil » : its token stops working at once. */
  forget(deviceId: string) {
    this.hub.handle.db
      .prepare('UPDATE core__sync_peers SET revoked_at = ?, token_hash = NULL WHERE device_id = ?')
      .run(new Date().toISOString(), deviceId);
  }

  private peerOf(authorization: string | undefined): string | null {
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    if (!token) return null;
    const row = this.hub.handle.db
      .prepare(
        "SELECT device_id FROM core__sync_peers WHERE token_hash = ? AND revoked_at IS NULL AND role = 'phone'",
      )
      .get(sha256(token)) as { device_id: string } | undefined;
    return row?.device_id ?? null;
  }

  private routes(app: FastifyInstance) {
    const engine = () => this.hub.sync;
    app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
      if (error instanceof VersionMismatch) {
        this.refusal = versionMessage(error.verdict, 'pc');
        return reply
          .code(409)
          .send({ error: versionMessage(error.verdict, 'phone'), verdict: error.verdict });
      }
      if (error instanceof SyncError) return reply.code(400).send({ error: error.message });
      this.hub.logger.error('Synchro : erreur', error);
      return reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({
        error:
          error.statusCode && error.statusCode < 500
            ? error.message
            : `Erreur du PC : ${error.message}`,
      });
    });
    const auth = (request: { headers: Record<string, unknown> }) => {
      const peer = this.peerOf(request.headers.authorization as string | undefined);
      if (!peer) {
        const e = new Error('Appareil inconnu ou oublié : appaire-le de nouveau.') as Error & {
          statusCode: number;
        };
        e.statusCode = 401;
        throw e;
      }
      return peer;
    };
    const touch = (peer: string, first = false) =>
      this.hub.handle.db
        .prepare(
          `UPDATE core__sync_peers SET last_sync_at = ?${first ? ', first_sync_at = COALESCE(first_sync_at, ?)' : ''} WHERE device_id = ?`,
        )
        .run(
          ...(first
            ? [new Date().toISOString(), new Date().toISOString()]
            : [new Date().toISOString()]),
          peer,
        );

    app.post<{ Body: { code?: string; device?: string; name?: string } }>(
      '/sync/pair',
      async (request, reply) => {
        const p = this.pairing;
        const body = request.body ?? {};
        if (!p || Date.now() > p.expires)
          return reply
            .code(401)
            .send({ error: 'Code d’appairage expiré : affiche-en un nouveau sur le PC.' });
        if (body.code !== p.token) {
          p.tries++;
          if (p.tries >= PAIRING_TRIES) this.pairing = null;
          return reply.code(401).send({ error: 'Code d’appairage refusé.' });
        }
        const device = String(body.device ?? '');
        if (!/^[0-9a-f-]{36}$/.test(device))
          return reply.code(400).send({ error: 'Appareil invalide' });
        this.pairing = null; // Single use.
        const token = randomBytes(32).toString('base64url');
        this.hub.handle.db
          .prepare(
            `INSERT INTO core__sync_peers (device_id, name, role, token_hash, created_at) VALUES (?, ?, 'phone', ?, ?)
           ON CONFLICT (device_id) DO UPDATE SET name = excluded.name, token_hash = excluded.token_hash,
             revoked_at = NULL, created_at = excluded.created_at, first_sync_at = NULL`,
          )
          .run(
            device,
            String(body.name ?? 'Téléphone').slice(0, 60),
            sha256(token),
            new Date().toISOString(),
          );
        this.hub.logger.info(`Synchro : téléphone appairé (${String(body.name ?? device)})`);
        return {
          token,
          pc: engine().device,
          name: 'PC',
          addresses: this.urls(),
          versions: engine().versions(),
          app: this.appVersion,
        };
      },
    );

    app.post<{ Body: { versions?: Record<string, number> } }>('/sync/hello', async (request) => {
      const peer = auth(request);
      const row = this.hub.handle.db
        .prepare('SELECT first_sync_at FROM core__sync_peers WHERE device_id = ?')
        .get(peer) as { first_sync_at: string | null };
      return {
        pc: engine().device,
        versions: engine().versions(),
        app: this.appVersion,
        firstDone: Boolean(row.first_sync_at),
        // The PC's addresses on the network it is on now: the phone keeps them
        // (home, other Wi-Fi…) to find the PC again elsewhere.
        addresses: this.urls(),
      };
    });

    app.post<{ Body: FirstRequest }>('/sync/first', async (request) => {
      const peer = auth(request);
      const body = request.body;
      if (body.mode !== 'preview') {
        // The PC's base is saved first (« Sauvegarde des deux bases avant »).
        const file = createAutomaticBackup(
          this.hub.handle.db as never,
          this.hub.backupsDir,
          'avant-synchro',
          'module',
        );
        this.hub.logger.info(
          `Synchro : sauvegarde avant la première synchro (${path.basename(file)})`,
        );
      }
      const result = serveFirst(engine(), peer, body);
      if (body.mode !== 'preview') touch(peer, true);
      this.refusal = null;
      return result;
    });

    // The files named by the rows (recipe pictures): after the data, by pieces.
    const files = () => (this.filesCache ??= new SyncFiles(engine()));
    const firstDone = (peer: string) => {
      const row = this.hub.handle.db
        .prepare('SELECT first_sync_at FROM core__sync_peers WHERE device_id = ?')
        .get(peer) as { first_sync_at: string | null };
      if (!row.first_sync_at)
        throw new SyncError('Fais d’abord la première synchro (avec son aperçu).');
    };
    app.post('/sync/files/missing', async (request) => {
      firstDone(auth(request));
      return { files: files().missing() };
    });
    app.post<{ Body: { ref: FileRef; offset: number } }>('/sync/files/get', async (request) => {
      firstDone(auth(request));
      try {
        return files().read(request.body.ref, request.body.offset);
      } catch (error) {
        throw new SyncError((error as Error).message);
      }
    });
    app.post<{ Body: { ref: FileRef; chunk: FileChunk } }>('/sync/files/put', async (request) => {
      firstDone(auth(request));
      try {
        return { done: await files().receive(request.body.ref, request.body.chunk) };
      } catch (error) {
        throw new SyncError((error as Error).message);
      }
    });

    app.post<{ Body: ExchangeRequest }>('/sync/exchange', async (request) => {
      const peer = auth(request);
      const row = this.hub.handle.db
        .prepare('SELECT first_sync_at FROM core__sync_peers WHERE device_id = ?')
        .get(peer) as { first_sync_at: string | null };
      if (!row.first_sync_at)
        throw new SyncError('Fais d’abord la première synchro (avec son aperçu).');
      const result = serveExchange(engine(), peer, request.body);
      touch(peer);
      this.refusal = null;
      return result;
    });
  }
}
