// The phone's pinned HTTPS call, for the tests (on the phone it is the app's
// native plugin, same rule): the PC's certificate is read, its SHA-256 must
// start with the pin from the QR code, then the request is made trusting
// THAT certificate only. A wrong certificate: nothing is sent.
import { createHash } from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import WebSocket from 'ws';
import type { LiveConnect } from '../../packages/phone/auto-sync';
import type { PinnedHttp } from '../../packages/phone/sync-client';

export const nodePinnedHttp: PinnedHttp = async ({ url, body, pin, token }) => {
  const u = new URL(url);
  const port = Number(u.port);
  const der = await new Promise<Buffer>((resolve, reject) => {
    const socket = tls.connect({ host: u.hostname, port, rejectUnauthorized: false }, () => {
      const raw = socket.getPeerCertificate().raw;
      socket.end();
      resolve(raw);
    });
    socket.on('error', reject);
  });
  if (createHash('sha256').update(der).digest('hex').slice(0, 32) !== pin)
    throw new Error('certificat refusé (empreinte différente)');
  const ca = `-----BEGIN CERTIFICATE-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END CERTIFICATE-----\n`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: u.hostname,
        port,
        path: u.pathname,
        method: 'POST',
        ca,
        checkServerIdentity: () => undefined, // The certificate itself is pinned (no host name on a LAN).
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
};

/** The live channel as the app's LiveChannel plugin opens it: same pin, same token. */
export const nodeLiveConnect: LiveConnect = (target, handlers) => {
  let socket: WebSocket | null = null;
  let closed = false;
  const done = (code: number) => {
    if (closed) return;
    closed = true;
    handlers.onClosed(code);
  };
  void (async () => {
    const u = new URL(target.url);
    let der: Buffer;
    try {
      der = await new Promise<Buffer>((resolve, reject) => {
        const s = tls.connect(
          { host: u.hostname, port: Number(u.port), rejectUnauthorized: false },
          () => {
            const raw = s.getPeerCertificate().raw;
            s.end();
            resolve(raw);
          },
        );
        s.on('error', reject);
      });
    } catch {
      return done(0);
    }
    if (createHash('sha256').update(der).digest('hex').slice(0, 32) !== target.pin) return done(0);
    if (closed) return;
    const ca = `-----BEGIN CERTIFICATE-----\n${der
      .toString('base64')
      .match(/.{1,64}/g)!
      .join('\n')}\n-----END CERTIFICATE-----\n`;
    socket = new WebSocket(`wss://${u.host}/sync/live`, {
      ca,
      // The certificate itself is pinned (no host name on a LAN); tls wants « undefined » here.
      checkServerIdentity: (() => undefined) as never,
      headers: { authorization: `Bearer ${target.token}` },
    });
    socket.on('open', () => handlers.onOpen());
    socket.on('message', (data) => {
      if ((JSON.parse(String(data)) as { type?: string }).type === 'changed') handlers.onChanged();
    });
    socket.on('unexpected-response', (_req, res) => done(res.statusCode ?? 0));
    socket.on('close', (code) => done(code));
    socket.on('error', () => done(0));
  })();
  return () => {
    closed = true;
    socket?.terminate();
  };
};
