// v0.41.0: the PC's witness and « Réseaux et adresses », end to end (the
// PC's HTTPS listener, the phone's real client): each state and its reason,
// the versions on both sides, a Public network (simulated), a port already
// taken, the history (50 at most, both devices), naming and forgetting with
// « Annuler » (never the pairing nor the data). Opening the page or reading
// the witness starts nothing: no listener, no announcement, no setting.
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { PUBLIC_NETWORK } from '../../backend/core/sync/diagnostics';
import type { NetworkProfile } from '../../backend/core/sync/network';
import { SyncServer } from '../../backend/core/sync/server';
import {
  type AddressInfo,
  type PhoneDiagnostics,
  PhoneSync,
  syncWorkerCall,
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

describe('the PC’s witness and « Réseaux et adresses »', () => {
  let d: Devices;
  let server: SyncServer | null = null;
  afterEach(async () => {
    await server?.stop();
    server = null;
    await d?.close();
  });

  const setup = async (profiles: NetworkProfile[] = []) => {
    d = await devices();
    let reads = 0;
    server = new SyncServer(d.pc.hub, '0.41.0', () => ['127.0.0.1'], null, {
      interfaces: () => [{ alias: 'lo', address: '127.0.0.1' }],
      profiles: async () => {
        reads++;
        return profiles;
      },
    });
    const worker = <T>(call: SyncWorkerCall) => syncWorkerCall(d.phone, call) as Promise<T>;
    const phone = new PhoneSync(worker, nodePinnedHttp);
    return { server, phone, worker, reads: () => reads };
  };
  const paired = async (profiles: NetworkProfile[] = []) => {
    const s = await setup(profiles);
    await s.server.setEnabled(true, await freePort());
    await s.phone.pair(s.server.newPairing().code, 'S21');
    await s.phone.first('replace', async () => {});
    return s;
  };

  it('off, then waiting, then synchronised with the phone’s name; reading changes nothing', async () => {
    const { server, phone } = await setup();
    expect(server.witness()).toMatchObject({ state: 'off', text: 'Synchro arrêtée' });
    // The witness and the page: read only (no listener, no setting).
    const before = server.status();
    server.witness();
    server.networks();
    await server.refreshNetwork();
    expect(server.status()).toEqual(before);
    expect(server.status()).toMatchObject({ enabled: false, listening: false, announced: false });
    await server.setEnabled(true, await freePort());
    expect(server.witness()).toMatchObject({ state: 'waiting', text: 'En attente du téléphone' });
    await phone.pair(server.newPairing().code, 'S21');
    await phone.first('replace', async () => {});
    await phone.now();
    expect(server.witness()).toMatchObject({
      state: 'synced',
      text: 'Synchronisé · à l’instant',
      detail: 'avec S21',
    });
    const n = server.networks();
    expect(n.attempts.slice(0, 2)).toMatchObject([
      { ok: true, where: '127.0.0.1', peer: 'S21' },
      { ok: true, where: '127.0.0.1', peer: 'S21' },
    ]);
    expect(n.known).toEqual([
      expect.objectContaining({ key: 'ip:127.0.0.1', addresses: ['127.0.0.1'], lastFail: null }),
    ]);
    expect(n.known[0]!.firstOk).not.toBeNull();
  });

  it('versions different, both ways: blocked, the right message on both devices; then it passes again', async () => {
    const { server, phone, worker } = await paired();
    // The PC updated first (a newer migration): the phone has to update.
    const insert = (db: { prepare(s: string): { run(): unknown } }) =>
      db
        .prepare(
          "INSERT INTO core__migrations (scope, version, description, applied_at) VALUES ('todo', 99, 'x', 'x')",
        )
        .run();
    insert(d.pc.hub.handle.db as never);
    await expect(phone.now()).rejects.toThrow(/Mets à jour l’application/);
    expect(server.witness()).toMatchObject({
      state: 'blocked',
      text: 'Synchro bloquée',
      detail: expect.stringMatching(/téléphone a une version plus ancienne/),
    });
    const phoneSide = await worker<PhoneDiagnostics>({ op: 'diagnostics' });
    expect(phoneSide.attempts[0]).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Mets à jour l’application/),
    });
    d.pc.hub.handle.db.prepare('DELETE FROM core__migrations WHERE version = 99').run();
    // The phone updated first: the PC has to update.
    insert(d.phoneDb as never);
    await expect(phone.now()).rejects.toThrow(/PC a une version plus ancienne/);
    expect(server.witness().detail).toMatch(/Mets à jour ToolBox sur le PC/);
    d.phoneDb.prepare('DELETE FROM core__migrations WHERE version = 99').run();
    await phone.now();
    expect(server.witness().state).toBe('synced');
  });

  it('a network on the « Public » profile (simulated): blocked, said in plain words; its name kept', async () => {
    const { server, phone } = await paired([
      { alias: 'lo', name: 'ECAM-WiFi', category: 'public' },
    ]);
    await server.refreshNetwork();
    expect(server.witness()).toMatchObject({ state: 'blocked', detail: PUBLIC_NETWORK });
    const n = server.networks();
    expect(n.publicNetwork).toBe(true);
    expect(n.current).toEqual([
      { alias: 'lo', address: '127.0.0.1', name: 'ECAM-WiFi', category: 'public' },
    ]);
    // (Here the exchange passes: the firewall is not simulated.) Its network is known by its name.
    await phone.now();
    expect(server.networks().known.map((k) => k.key)).toContain('net:ECAM-WiFi');
    expect(server.networks().attempts[0]!.where).toBe('ECAM-WiFi');
  });

  it('the port already taken: blocked, « choisis-en un autre »', async () => {
    const { server } = await setup();
    const busy = net.createServer();
    const port = await new Promise<number>((r) =>
      busy.listen(0, '0.0.0.0', () => r((busy.address() as net.AddressInfo).port)),
    );
    try {
      await server.setEnabled(true, port);
      expect(server.witness()).toMatchObject({
        state: 'blocked',
        detail: expect.stringMatching(/déjà utilisé : choisis-en un autre/),
      });
    } finally {
      busy.close();
    }
  });

  it('an unknown device (forgotten on the PC): blocked until it is paired again', async () => {
    const { server, phone } = await paired();
    server.forget(d.phoneEngine.device);
    await expect(phone.now()).rejects.toThrow();
    expect(server.witness()).toMatchObject({
      state: 'blocked',
      detail: expect.stringMatching(/Appareil inconnu ou oublié/),
    });
  });

  it('the history: 50 at most on each device, newest first', async () => {
    const { server, worker } = await setup();
    for (let i = 0; i < 55; i++)
      server.recordAttempt({ ok: i % 3 !== 0, reason: 'x', local: '127.0.0.1', peer: null });
    expect(server.attempts()).toHaveLength(50);
    for (let i = 0; i < 55; i++)
      await worker({ op: 'attempt', ok: false, reason: `essai ${i}`, url: null });
    const phone = await worker<PhoneDiagnostics>({ op: 'diagnostics' });
    expect(phone.attempts).toHaveLength(50);
    expect(phone.attempts[0]).toMatchObject({ reason: 'essai 54', where: 'PC introuvable' });
  });

  it('PC: rename, « Oublier » then « Annuler », by the routes of the page', async () => {
    d = await devices();
    const net0 = {
      key: 'ip:192.168.0.12',
      label: null,
      network: null,
      addresses: ['192.168.0.12'],
      firstOk: '2026-11-10T10:00:00.000Z',
      lastOk: '2026-11-16T10:00:00.000Z',
      lastFail: { at: '2026-11-15T10:00:00.000Z', reason: 'PC introuvable' },
    };
    d.pc.hub.handle.db
      .prepare("INSERT INTO core__meta (key, value) VALUES ('sync.networks', ?)")
      .run(JSON.stringify([net0]));
    const key = encodeURIComponent(net0.key);
    const renamed = await d.pc.request<{ known: { label: string | null }[] }>(
      'PUT',
      `/api/core/sync/networks/${key}`,
      { label: '  Kot  ' },
    );
    expect(renamed.body.known[0]!.label).toBe('Kot');
    const gone = await d.pc.request<{ forgotten: typeof net0; networks: { known: unknown[] } }>(
      'DELETE',
      `/api/core/sync/networks/${key}`,
    );
    expect(gone.body.networks.known).toEqual([]);
    expect(gone.body.forgotten).toEqual({ ...net0, label: 'Kot' });
    const back = await d.pc.request<{ known: unknown[] }>(
      'POST',
      '/api/core/sync/networks/restore',
      {
        entry: gone.body.forgotten,
      },
    );
    expect(back.body.known).toEqual([{ ...net0, label: 'Kot' }]);
    // Reading the page and the witness: nothing started.
    expect((await d.pc.request('GET', '/api/core/sync/networks?refresh=0')).status).toBe(200);
    expect((await d.pc.request('GET', '/api/core/sync/witness')).body).toMatchObject({
      state: 'off',
    });
    expect((await d.pc.request('GET', '/api/core/sync')).body).toMatchObject({
      enabled: false,
      listening: false,
    });
    expect(
      (await d.pc.request('PUT', '/api/core/sync/networks/ip%3A1.2.3.4', { label: 'x' })).status,
    ).toBe(400);
  });

  it('phone: name an address, « Oublier » then « Annuler »; the pairing and the data stay', async () => {
    const { phone, worker } = await paired();
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'Gardée' });
    await phone.now();
    const url = (await worker<PhoneDiagnostics>({ op: 'diagnostics' })).addresses[0]!.url;
    await worker({ op: 'labelAddress', url, label: 'Kot' });
    await phone.now();
    let diag = await worker<PhoneDiagnostics>({ op: 'diagnostics' });
    expect(diag.addresses[0]).toMatchObject({ url, label: 'Kot' });
    expect(diag.addresses[0]!.firstOk).not.toBeNull();
    expect(diag.attempts[0]).toMatchObject({ ok: true, where: 'Kot' });
    const gone = await worker<AddressInfo>({ op: 'forgetAddress', url });
    diag = await worker<PhoneDiagnostics>({ op: 'diagnostics' });
    expect(diag.addresses.map((a) => a.url)).not.toContain(url);
    const state = await worker<{ peer: { device_id: string } | null }>({ op: 'state' });
    expect(state.peer?.device_id).toBe(d.pcEngine.device);
    expect(d.rows('phone', 'todo').tasks!.some((t) => t.title === 'Gardée')).toBe(true);
    await worker({ op: 'restoreAddress', address: gone });
    diag = await worker<PhoneDiagnostics>({ op: 'diagnostics' });
    expect(diag.addresses[0]).toMatchObject({ url, label: 'Kot' });
    // It still synchronises (the address is found again anyway).
    await phone.now();
  });
});
