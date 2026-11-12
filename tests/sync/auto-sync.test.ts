// The automatic synchronisation of the phone (ADR 0044, v0.33.0): off by
// default; when on, at opening and back on screen, shortly after local
// changes (grouped), and when the PC says « changed » on the live channel.
// Never in the background, never the first synchronisation; versions
// different or device unknown: it stops and says why.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutoSync,
  CHANGE_DELAY,
  PUSH_DELAY,
  type AutoResult,
  type AutoStatus,
  type LiveConnect,
} from '../../packages/phone/auto-sync';
import { SyncFailure } from '../../packages/phone/sync-client';

const ok: AutoResult = { received: 1, sent: 0, conflicts: 0, scopes: ['todo'] };

function rig(o: { fail?: () => Error | null } = {}) {
  let runs = 0;
  const statuses: AutoStatus[] = [];
  const synced: AutoResult[] = [];
  let live: Parameters<LiveConnect>[1] | null = null;
  let opened = 0;
  let closed = 0;
  const auto = new AutoSync({
    run: async () => {
      runs++;
      const error = o.fail?.();
      if (error) throw error;
      return ok;
    },
    target: async () => ({ url: 'https://192.168.1.20:47400', pin: 'ab'.repeat(16), token: 't' }),
    connect: (_target, handlers) => {
      opened++;
      live = handlers;
      return () => {
        closed++;
        live = null;
      };
    },
    onSynced: (r) => synced.push(r),
    onStatus: (s) => statuses.push(s),
  });
  return {
    auto,
    runs: () => runs,
    statuses,
    synced,
    live: () => live,
    opened: () => opened,
    closed: () => closed,
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('automatic synchronisation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('off by default: nothing runs, nothing opens', async () => {
    const r = rig();
    r.auto.localChange();
    r.auto.trigger();
    r.auto.setVisible(false);
    r.auto.setVisible(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.runs()).toBe(0);
    expect(r.opened()).toBe(0);
    expect(r.auto.current).toMatchObject({ enabled: false, state: 'off' });
  });

  it('on: once at once, then grouped after the local changes, live channel opened', async () => {
    const r = rig();
    r.auto.setEnabled(true);
    await flush();
    expect(r.runs()).toBe(1);
    expect(r.opened()).toBe(1);
    expect(r.synced).toEqual([ok]);
    expect(r.auto.current.state).toBe('ok');
    // Three changes in a row: one synchronisation, 3 s after the last.
    r.auto.localChange();
    await vi.advanceTimersByTimeAsync(1000);
    r.auto.localChange();
    await vi.advanceTimersByTimeAsync(1000);
    r.auto.localChange();
    await vi.advanceTimersByTimeAsync(CHANGE_DELAY - 1);
    expect(r.runs()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.runs()).toBe(2);
  });

  it('the PC says « changed »: a synchronisation in about a second', async () => {
    const r = rig();
    r.auto.setEnabled(true);
    await flush();
    r.live()!.onOpen();
    expect(r.auto.current.live).toBe(true);
    r.live()!.onChanged();
    r.live()!.onChanged();
    await vi.advanceTimersByTimeAsync(PUSH_DELAY);
    expect(r.runs()).toBe(2);
  });

  it('off screen: the channel closes, nothing runs; back on screen: one synchronisation', async () => {
    const r = rig();
    r.auto.setEnabled(true);
    await flush();
    r.auto.setVisible(false);
    expect(r.closed()).toBe(1);
    r.auto.localChange();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.runs()).toBe(1);
    r.auto.setVisible(true);
    await flush();
    expect(r.runs()).toBe(2);
    expect(r.opened()).toBe(2);
  });

  it('never the first synchronisation: it stops and says so', async () => {
    const r = rig({
      fail: () => new SyncFailure('Fais d’abord la première synchro (avec son aperçu).', 'first'),
    });
    r.auto.setEnabled(true);
    await flush();
    expect(r.auto.current).toMatchObject({ state: 'first' });
    r.auto.localChange();
    r.auto.setVisible(false);
    r.auto.setVisible(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.runs()).toBe(1);
    expect(r.opened()).toBe(0);
  });

  it('versions different: it stops with the message, until a manual synchronisation works', async () => {
    let fail = true;
    const r = rig({
      fail: () => (fail ? new SyncFailure('Mets à jour l’application.', 'version') : null),
    });
    r.auto.setEnabled(true);
    await flush();
    expect(r.auto.current).toMatchObject({
      state: 'version',
      message: 'Mets à jour l’application.',
    });
    r.auto.localChange();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.runs()).toBe(1);
    fail = false;
    r.auto.resumeAfterManual();
    await flush();
    expect(r.auto.current.state).toBe('ok');
  });

  it('PC not found: « PC introuvable », tried again later while on screen', async () => {
    let fail = true;
    const r = rig({
      fail: () => (fail ? new SyncFailure('Le PC ne répond pas…', 'offline') : null),
    });
    r.auto.setEnabled(true);
    await flush();
    expect(r.auto.current.state).toBe('offline');
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.runs()).toBe(2);
    expect(r.auto.current.state).toBe('ok');
  });

  it('the device forgotten on the PC (channel refused 401): it stops', async () => {
    const r = rig();
    r.auto.setEnabled(true);
    await flush();
    r.live()!.onClosed(4401);
    expect(r.auto.current.state).toBe('auth');
    r.auto.localChange();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.runs()).toBe(1);
  });

  it('turned off: everything stops at once', async () => {
    const r = rig();
    r.auto.setEnabled(true);
    await flush();
    r.auto.setEnabled(false);
    expect(r.closed()).toBe(1);
    r.auto.localChange();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.runs()).toBe(1);
    expect(r.auto.current).toMatchObject({ enabled: false, state: 'off' });
  });
});
