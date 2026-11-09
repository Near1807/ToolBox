// The phone finds its PC again on any network (ADR 0044, v0.33.0): the
// addresses it already knows (and those the PC sends), the local network
// (mDNS, only a hint: the pinned certificate decides), and « Nouvelle adresse
// du PC » (the code of « QR de l'adresse », no token): no new pairing, no new
// first synchronisation. The PC announces itself only while it listens.
import https from 'node:https';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import selfsigned from 'selfsigned';
import { SyncServer } from '../../backend/core/sync/server';
import { decodeAddress, encodeAddress } from '../../backend/core/sync/pairing-code';
import type { Announcer } from '../../backend/core/sync/announce';
import {
  PhoneSync,
  syncWorkerCall,
  type Discover,
  type KnownAddress,
  type SyncState,
  type SyncWorkerCall,
} from '../../packages/phone/sync-client';
import { devices, type Devices } from './harness';
import { nodePinnedHttp } from './pinned-http';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

/** Another device on the network with its own certificate (not the PC). */
async function impostor(): Promise<{ url: string; close: () => Promise<void> }> {
  const made = await selfsigned.generate([{ name: 'commonName', value: 'Autre' }], {
    keyType: 'ec',
    algorithm: 'sha256',
  });
  let hits = 0;
  const server = https.createServer({ key: made.private, cert: made.cert }, (_req, res) => {
    hits++;
    res.end('{}');
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `https://127.0.0.1:${port}`,
    close: () => {
      expect(hits).toBe(0); // Nothing was ever sent to it.
      return new Promise((r) => server.close(() => r()));
    },
  };
}

describe('the phone finds its PC on any network', () => {
  let d: Devices;
  let server: SyncServer | null = null;
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await server?.stop();
    server = null;
    for (const c of cleanups.splice(0)) await c();
    await d?.close();
  });

  const setup = async (o: { addresses?: () => string[]; discover?: Discover } = {}) => {
    d = await devices();
    const announced: { port: number; id: string }[] = [];
    const stopped: number[] = [];
    const announcer: Announcer = ({ port, id }) => {
      announced.push({ port, id });
      return async () => {
        stopped.push(port);
      };
    };
    server = new SyncServer(d.pc.hub, '0.33.0', o.addresses ?? (() => ['127.0.0.1']), announcer);
    const worker = <T>(call: SyncWorkerCall) => syncWorkerCall(d.phone, call) as Promise<T>;
    const phone = new PhoneSync(worker, nodePinnedHttp, o.discover ?? null);
    const port = await freePort();
    await server.setEnabled(true, port);
    await phone.pair(server.newPairing().code, 'S21');
    await phone.first('replace', async () => {});
    const state = () => worker<SyncState>({ op: 'state' });
    const known = () => worker<KnownAddress[]>({ op: 'addresses' });
    /** The phone's current address becomes one where nothing answers (the old Wi-Fi). */
    const moveAway = async () => {
      const dead = `https://127.0.0.1:${await freePort()}`;
      d.phoneDb.prepare("UPDATE core__sync_peers SET url = ? WHERE role = 'pc'").run(dead);
      return dead;
    };
    return { server, phone, port, announced, stopped, state, known, moveAway };
  };

  it('keeps the addresses the PC sends, and uses one when the current one is dead', async () => {
    // The PC is on two networks (127.0.0.2 stands for the other Wi-Fi).
    const { phone, port, state, known, moveAway } = await setup({
      addresses: () => ['127.0.0.1', '127.0.0.2'],
    });
    expect((await known()).map((a) => a.url).sort()).toEqual([
      `https://127.0.0.1:${port}`,
      `https://127.0.0.2:${port}`,
    ]);
    const token = d.phoneDb
      .prepare("SELECT token FROM core__sync_peers WHERE role = 'pc'")
      .get() as { token: string };
    const dead = await moveAway();
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'Au kot' });
    // Nothing to do: the next synchronisation finds the PC at a known address.
    const result = await phone.now();
    expect(result).toMatchObject({ sent: 1 });
    expect(d.rows('pc', 'todo').tasks!.some((t) => t.title === 'Au kot')).toBe(true);
    const after = await state();
    expect(after.peer!.url).not.toBe(dead);
    expect(after.peer!.url).toMatch(new RegExp(`:${port}$`));
    // Same token, first synchronisation kept: no new pairing.
    expect(d.phoneDb.prepare("SELECT token FROM core__sync_peers WHERE role = 'pc'").get()).toEqual(
      token,
    );
    expect(after.peer!.first_sync_at).not.toBeNull();
  });

  it('nothing answers: a clear message (where it tried, what to do), nothing lost', async () => {
    const { phone, moveAway } = await setup();
    d.phoneDb.prepare('DELETE FROM core__sync_addresses').run();
    const dead = await moveAway();
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'En attente' });
    const error = await phone.now().catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Le PC ne répond pas \(essayé : 127\.0\.0\.1\)/);
    expect((error as Error).message).toMatch(/même Wi-Fi/);
    expect((error as Error).message).toMatch(/Nouvelle adresse du PC/);
    expect((error as Error).message).toMatch(/Rien n’est perdu/);
    expect(dead).toMatch(/^https:/);
    expect(d.rows('pc', 'todo').tasks!.some((t) => t.title === 'En attente')).toBe(false);
  });

  it('found on the network (mDNS): used only when the certificate is the pinned one', async () => {
    const other = await impostor();
    cleanups.push(other.close);
    let asked: string | null = null;
    let pcUrl = '';
    const { phone, state, port, moveAway } = await setup({
      discover: async (id) => {
        asked = id;
        return [other.url, pcUrl];
      },
    });
    pcUrl = `https://127.0.0.1:${port}`;
    d.phoneDb.prepare('DELETE FROM core__sync_addresses').run();
    await moveAway();
    await phone.now();
    expect(asked).toBe(d.pcEngine.device);
    expect((await state()).peer!.url).toBe(pcUrl);
  });

  it('found on the network but with another certificate: refused, nothing sent', async () => {
    const other = await impostor();
    cleanups.push(other.close);
    const { phone, state, moveAway } = await setup({ discover: async () => [other.url] });
    d.phoneDb.prepare('DELETE FROM core__sync_addresses').run();
    const dead = await moveAway();
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'Pas pour lui' });
    await expect(phone.now()).rejects.toThrow(/un autre appareil répond, pas ton PC/);
    expect((await state()).peer!.url).toBe(dead);
  });

  it('« Nouvelle adresse du PC »: no new pairing nor first synchronisation; another PC refused', async () => {
    const { server, phone, state, moveAway } = await setup();
    d.phoneDb.prepare('DELETE FROM core__sync_addresses').run();
    await moveAway();
    const { code } = server.addressCode();
    const info = decodeAddress(code);
    // Another PC's code (another fingerprint): refused before anything is sent.
    await expect(
      phone.newAddress(encodeAddress({ ...info, pin: 'cd'.repeat(16) })),
    ).rejects.toThrow(/autre PC/);
    // A pairing code is not an address code (and the reverse).
    await expect(phone.newAddress(server.newPairing().code)).rejects.toThrow(/code d’appairage/);
    await expect(phone.pair(code, 'S21')).rejects.toThrow(/QR de l’adresse/);
    const before = await state();
    const url = await phone.newAddress(code);
    expect(url).toBe(`https://${info.host}:${info.port}`);
    const after = await state();
    expect(after.peer!.url).toBe(url);
    expect(after.peer!.first_sync_at).toBe(before.peer!.first_sync_at);
    expect(after.peer!.device_id).toBe(before.peer!.device_id);
    // The PC still knows this phone (same token, no new pairing).
    expect(server.status().peers).toHaveLength(1);
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'Après le QR' });
    expect(await phone.now()).toMatchObject({ sent: 1 });
  });

  it('the address code holds no token; the PC announces itself only while listening', async () => {
    const { server, port, announced, stopped } = await setup();
    const { code } = server.addressCode();
    expect(code).toMatch(/^TBXA-/);
    expect(Object.keys(decodeAddress(code)).sort()).toEqual(['host', 'pin', 'port']);
    expect(announced).toEqual([{ port, id: d.pcEngine.device }]);
    expect(server.status()).toMatchObject({ announced: true, announceError: null });
    await server.setEnabled(false);
    expect(stopped).toEqual([port]);
    expect(server.status()).toMatchObject({ announced: false, listening: false });
    expect(() => server.addressCode()).toThrow(/Active d’abord la synchro/);
  });

  it('turned off by default: nothing announced', async () => {
    d = await devices();
    let calls = 0;
    server = new SyncServer(
      d.pc.hub,
      '0.33.0',
      () => ['127.0.0.1'],
      () => {
        calls++;
        return async () => {};
      },
    );
    await server.start();
    expect(calls).toBe(0);
    expect(server.status()).toMatchObject({ enabled: false, announced: false });
  });
});
