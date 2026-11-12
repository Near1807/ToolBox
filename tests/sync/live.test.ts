// The live channel of the automatic synchronisation (ADR 0044, v0.33.0):
// wss://<PC>/sync/live on the same listener (same pinned certificate, same
// device token). The PC says « changed » when its data move; a change made
// on the PC reaches the phone in about a second, with the real client and
// the real automatic synchronisation.
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncServer } from '../../backend/core/sync/server';
import { AutoSync, type AutoStatus } from '../../packages/phone/auto-sync';
import {
  PhoneSync,
  syncWorkerCall,
  type SyncState,
  type SyncWorkerCall,
} from '../../packages/phone/sync-client';
import { devices, type Devices } from './harness';
import { nodeLiveConnect, nodePinnedHttp } from './pinned-http';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('trop long');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('live channel and automatic synchronisation (real network)', () => {
  let d: Devices;
  let server: SyncServer | null = null;
  let auto: AutoSync | null = null;
  afterEach(async () => {
    auto?.setEnabled(false);
    auto = null;
    await server?.stop();
    server = null;
    await d?.close();
  });

  const setup = async (first = true) => {
    d = await devices();
    server = new SyncServer(d.pc.hub, '0.33.0', () => ['127.0.0.1'], null);
    const worker = <T>(call: SyncWorkerCall) => syncWorkerCall(d.phone, call) as Promise<T>;
    const phone = new PhoneSync(worker, nodePinnedHttp, null);
    await server.setEnabled(true, await freePort());
    await phone.pair(server.newPairing().code, 'S21');
    if (first) await phone.first('replace', async () => {});
    const target = async () => {
      const state = await worker<SyncState>({ op: 'state' });
      const token = await worker<string | null>({ op: 'token' });
      return state.peer && token ? { url: state.peer.url, pin: state.peer.pin, token } : null;
    };
    return { phone, worker, target };
  };

  it('a change on the PC reaches the phone in about a second, on its own', async () => {
    const { phone, target } = await setup();
    const statuses: AutoStatus[] = [];
    const scopes: string[][] = [];
    auto = new AutoSync({
      run: async () => {
        const r = await phone.now();
        return { received: r.received, sent: r.sent, conflicts: r.conflicts, scopes: r.scopes };
      },
      target,
      connect: nodeLiveConnect,
      onSynced: (r) => scopes.push(r.scopes),
      onStatus: (s) => statuses.push(s),
    });
    auto.setEnabled(true);
    await until(() => auto!.current.live);
    expect(server!.status().live).toBe(1);
    const t0 = Date.now();
    await d.onPc('POST', '/api/modules/todo/tasks', { title: 'Depuis le PC' });
    await until(() => d.rows('phone', 'todo').tasks!.some((t) => t.title === 'Depuis le PC'));
    const took = Date.now() - t0;
    expect(took).toBeLessThan(2500); // Measured here: about 0.7 s (watched every 0.5 s, then the exchange).
    // The synchronisation ends (pictures after the data), the screens of the To-do are told.
    await until(() => scopes.length === 2);
    expect(scopes.at(-1)).toContain('todo');
    // The phone's own change goes up (grouped) and is not pushed back to it.
    const before = statuses.filter((s) => s.state === 'syncing').length;
    await d.onPhone('POST', '/api/modules/todo/tasks', { title: 'Depuis le téléphone' });
    auto.localChange();
    await until(
      () => d.rows('pc', 'todo').tasks!.some((t) => t.title === 'Depuis le téléphone'),
      5000,
    );
    await new Promise((r) => setTimeout(r, 1200));
    expect(statuses.filter((s) => s.state === 'syncing').length - before).toBe(1);
  });

  it('refused without a valid token, before the first synchronisation, and once forgotten', async () => {
    const { target } = await setup(false);
    const t = (await target())!;
    const codes: number[] = [];
    const tryLive = (token: string) =>
      new Promise<void>((resolve) => {
        nodeLiveConnect(
          { ...t, token },
          {
            onOpen: () => resolve(),
            onChanged: () => {},
            onClosed: (code) => {
              codes.push(code);
              resolve();
            },
          },
        );
      });
    await tryLive('faux');
    expect(codes).toEqual([401]);
    // Paired but the first synchronisation not done: refused too.
    await tryLive(t.token);
    expect(codes).toEqual([401, 409]);
    // A wrong certificate: nothing sent (the pin is checked first).
    await new Promise<void>((resolve) =>
      nodeLiveConnect(
        { ...t, pin: 'ab'.repeat(16) },
        { onOpen: () => {}, onChanged: () => {}, onClosed: () => resolve() },
      ),
    );
    expect(server!.status().live).toBe(0);
  });

  it('« Oublier cet appareil » closes its channel at once', async () => {
    const { target } = await setup();
    let closedWith: number | null = null;
    let open = false;
    nodeLiveConnect((await target())!, {
      onOpen: () => (open = true),
      onChanged: () => {},
      onClosed: (code) => (closedWith = code),
    });
    await until(() => open);
    server!.forget(d.phoneEngine.device);
    await until(() => closedWith !== null);
    expect(closedWith).toBe(4401);
  });

  it('turned off on the PC: no channel, no announcement, no port', async () => {
    await setup();
    await server!.setEnabled(false);
    expect(server!.status()).toMatchObject({ listening: false, live: 0, announced: false });
  });
});
