// The synchronisation over the network: the PC's HTTPS listener (off by
// default), the pairing by the code, the pinned certificate, the device's
// token (revoked: refused), the versions, and the phone's real client.
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncServer } from '../../backend/core/sync/server';
import { decodePairing, encodePairing } from '../../backend/core/sync/pairing-code';
import { PhoneSync, syncWorkerCall, type SyncWorkerCall } from '../../packages/phone/sync-client';
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

describe('synchronisation over the local network', () => {
  let d: Devices;
  let server: SyncServer | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
    await d?.close();
  });

  const setup = async () => {
    d = await devices();
    server = new SyncServer(d.pc.hub, '0.32.0', () => ['127.0.0.1'], null);
    const worker = <T>(call: SyncWorkerCall) => syncWorkerCall(d.phone, call) as Promise<T>;
    const phone = new PhoneSync(worker, nodePinnedHttp);
    return { server, phone };
  };

  it('off by default: no port; the code works once; the phone pairs and synchronises', async () => {
    const { server, phone } = await setup();
    expect(server.status()).toMatchObject({ enabled: false, listening: false, peers: [] });
    // The PC's own API says the same (the page reads it).
    expect((await d.pc.request('GET', '/api/core/sync')).body).toMatchObject({
      enabled: false,
      listening: false,
    });
    expect(() => server.newPairing()).toThrow(/Active d’abord la synchro/);
    const port = await freePort();
    await server.setEnabled(true, port);
    expect(server.status()).toMatchObject({ enabled: true, listening: true, port });
    const { code } = server.newPairing();
    expect(decodePairing(code)).toMatchObject({ host: '127.0.0.1', port });
    const peer = await phone.pair(code, 'S21');
    expect(peer.device_id).toBe(d.pcEngine.device);
    expect(server.status().peers.map((p) => p.name)).toEqual(['S21']);
    // The same code again: refused (single use).
    await expect(phone.pair(code, 'S21')).rejects.toThrow(/expiré|refusé/);
    // First synchronisation (from the PC's data), then by hand.
    await d.onPc('POST', '/api/modules/todo/tasks', { title: 'Sur le PC' });
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'Essai du téléphone' });
    expect(await phone.needsFirst()).toBe(true);
    const preview = await phone.preview();
    expect(preview.tables.find((t) => t.entity === 'tasks')).toMatchObject({
      onlyHere: 1,
      onlyThere: 1,
    });
    let copied = false;
    await phone.first('replace', async () => {
      copied = true;
    });
    expect(copied).toBe(true);
    expect(d.rows('phone', 'todo')).toEqual(d.rows('pc', 'todo'));
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'Du téléphone' });
    const result = await phone.now();
    expect(result).toMatchObject({ sent: 1, received: 0 });
    expect(d.rows('phone', 'todo')).toEqual(d.rows('pc', 'todo'));
    // The PC kept a backup before the first synchronisation.
    const { readdirSync } = await import('node:fs');
    expect(
      readdirSync(path.join(d.pc.dataDir, 'backups')).some((f) => f.includes('avant-synchro')),
    ).toBe(true);
  });

  it('a certificate other than the pinned one: refused, nothing sent', async () => {
    const { server, phone } = await setup();
    await server.setEnabled(true, await freePort());
    const info = decodePairing(server.newPairing().code);
    const wrong = encodePairing({ ...info, pin: 'ab'.repeat(16) });
    await expect(phone.pair(wrong, 'S21')).rejects.toThrow(/certificat attendu/);
    expect(server.status().peers).toEqual([]);
  });

  it('« Oublier cet appareil »: its token is refused at once', async () => {
    const { server, phone } = await setup();
    await server.setEnabled(true, await freePort());
    await phone.pair(server.newPairing().code, 'S21');
    await phone.first('replace', async () => {});
    server.forget(d.phoneEngine.device);
    await expect(phone.now()).rejects.toThrow(/plus reconnu|oublié/);
  });

  it('versions different: the phone sends nothing, its changes wait', async () => {
    const { server, phone } = await setup();
    await server.setEnabled(true, await freePort());
    await phone.pair(server.newPairing().code, 'S21');
    await phone.first('replace', async () => {});
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'En attente' });
    // The PC moves to a newer schema of the To-do (as after an update).
    d.pc.hub.handle.db
      .prepare(
        "INSERT INTO core__migrations (scope, version, description, applied_at) VALUES ('todo', 99, 'x', 'x')",
      )
      .run();
    await expect(phone.now()).rejects.toThrow(/Mets à jour l’application/);
    expect(d.rows('pc', 'todo').tasks!.filter((t) => t.title === 'En attente')).toHaveLength(0);
    d.pc.hub.handle.db
      .prepare("DELETE FROM core__migrations WHERE scope = 'todo' AND version = 99")
      .run();
    await phone.now();
    expect(d.rows('pc', 'todo').tasks!.filter((t) => t.title === 'En attente')).toHaveLength(1);
  });

  it('PC switched off (no listener): a clear message, nothing lost', async () => {
    const { server, phone } = await setup();
    await server.setEnabled(true, await freePort());
    await phone.pair(server.newPairing().code, 'S21');
    await phone.first('replace', async () => {});
    await server.setEnabled(false);
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'Hors réseau' });
    await expect(phone.now()).rejects.toThrow(/Le PC ne répond pas/);
    await server.setEnabled(true);
    await phone.now();
    expect(d.rows('pc', 'todo').tasks!.some((t) => t.title === 'Hors réseau')).toBe(true);
  });
});
