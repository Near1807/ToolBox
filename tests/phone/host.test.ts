// The phone host: what it does not provide throws an explicit error (never a
// silent fake success); the assistant is without effect; a module whose
// register() fails is isolated, like on the PC.
import { describe, expect, it } from 'vitest';
import { PhoneHub, UnavailableOnPhoneError } from '../../packages/phone/host';
import { openWasmDatabase } from '@hub/sdk/testing';

const manifest = (id: string) => ({
  id,
  name: id,
  description: 'test',
  version: '1.0.0',
  section: 'Outils',
  icon: 'bug',
});

describe('phone host', () => {
  it('a capability not provided throws « non disponible sur le téléphone »', async () => {
    const seen: string[] = [];
    let ctx: Record<string, Record<string, (...a: unknown[]) => unknown>> = {};
    const hub = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [
        { manifest: manifest('probe'), backend: { register: (c) => void (ctx = c as never) } },
      ],
      log: () => {},
    });
    for (const [part, member] of [
      ['files', 'readFile'],
      ['files', 'dataDir'],
      ['images', 'normalise'],
      ['notifications', 'notify'],
      ['ui', 'setOverlay'],
      ['ui', 'open'],
      ['jobs', 'define'],
      ['outputs', 'register'],
      ['events', 'emit'],
    ] as const) {
      try {
        void ctx[part]![member];
        seen.push(`${part}.${member}: no error`);
      } catch (error) {
        expect(error).toBeInstanceOf(UnavailableOnPhoneError);
        seen.push((error as Error).message);
      }
    }
    expect(seen).toEqual([
      '« ctx.files.readFile » n’est pas disponible sur le téléphone.',
      '« ctx.files.dataDir » n’est pas disponible sur le téléphone.',
      '« ctx.images.normalise » n’est pas disponible sur le téléphone.',
      // Without effect (the Timer's notifications are scheduled by the page; no floating window).
      'notifications.notify: no error',
      'ui.setOverlay: no error',
      '« ctx.ui.open » n’est pas disponible sur le téléphone.',
      '« ctx.jobs.define » n’est pas disponible sur le téléphone.',
      '« ctx.outputs.register » n’est pas disponible sur le téléphone.',
      '« ctx.events.emit » n’est pas disponible sur le téléphone.',
    ]);
    expect(() => (ctx.db as never as { backup: (r: string) => void }).backup('x')).toThrow(
      UnavailableOnPhoneError,
    );
    // The assistant: define() is accepted and does nothing; anything else is refused.
    expect(() => ctx.assistant!.define!({ name: 'a' })).not.toThrow();
    expect(() => ctx.assistant!.run).toThrow(UnavailableOnPhoneError);
    expect(() => ctx.notifications!.notify!({ title: 't', body: 'b' })).not.toThrow();
    expect(() => ctx.ui!.setOverlay!(true)).not.toThrow();
    await hub.close();
  });

  it('a module whose register() fails is isolated; the others load', async () => {
    const hub = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [
        {
          manifest: manifest('uses-files'),
          backend: { register: (ctx) => void ctx.files.dataPath('x') },
        },
        {
          manifest: manifest('fine'),
          backend: { register: (ctx) => ctx.routes.get('/ok', () => ({ ok: true })) },
        },
      ],
      log: () => {},
    });
    expect(hub.modules()).toEqual([
      {
        id: 'uses-files',
        status: 'failed',
        error:
          'Erreur au démarrage du module : « ctx.files.dataPath » n’est pas disponible sur le téléphone.',
      },
      { id: 'fine', status: 'loaded' },
    ]);
    const r = await hub.handle({ method: 'GET', url: '/api/modules/fine/ok' });
    expect([r.status, r.text]).toEqual([200, '{"ok":true}']);
    expect((await hub.handle({ method: 'GET', url: '/api/modules/uses-files/x' })).status).toBe(
      404,
    );
  });

  it('settings: defaults, saved values, validation, change listeners; secrets refused', async () => {
    let settings: {
      get: (k: string) => unknown;
      set: (k: string, v: unknown) => void;
      onChange: (h: (k: string) => void) => void;
    } | null = null;
    const changes: string[] = [];
    await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [
        {
          manifest: {
            ...manifest('s'),
            settings: [
              { key: 'n', type: 'number', label: 'Nombre', default: 5, min: 0, max: 10 },
              { key: 'k', type: 'secret', label: 'Clé' },
            ],
          } as never,
          backend: {
            register: (ctx) => {
              settings = ctx.settings as never;
              ctx.settings.onChange((k) => changes.push(k));
            },
          },
        },
      ],
      log: () => {},
    });
    expect(settings!.get('n')).toBe(5);
    settings!.set('n', 7);
    expect(settings!.get('n')).toBe(7);
    expect(() => settings!.set('n', 99)).toThrow(/Nombre/);
    expect(() => settings!.set('k', 'abc')).toThrow(UnavailableOnPhoneError);
    expect(changes).toEqual(['n']);
  });

  it('the settings routes of the PC: listed, saved all or none, errors in French', async () => {
    const hub = await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [
        {
          manifest: {
            ...manifest('s'),
            name: 'Essai',
            settings: [
              { key: 'n', type: 'number', label: 'Nombre', default: 5, min: 0, max: 10 },
              { key: 'b', type: 'boolean', label: 'Oui', default: true },
              { key: 'h', type: 'text', label: 'Caché', hidden: true },
            ],
          } as never,
          backend: { register: () => {} },
        },
        { manifest: manifest('sans-reglage') as never, backend: { register: () => {} } },
      ],
      log: () => {},
    });
    const get = async () =>
      JSON.parse((await hub.handle({ method: 'GET', url: '/api/core/settings' })).text);
    const put = (body: unknown) =>
      hub.handle({
        method: 'PUT',
        url: '/api/core/settings/s',
        body: JSON.stringify(body),
        contentType: 'application/json',
      });
    expect(await get()).toEqual([
      {
        scope: 's',
        title: 'Essai',
        fields: [
          { field: expect.objectContaining({ key: 'n' }), value: 5, isSet: false },
          { field: expect.objectContaining({ key: 'b' }), value: true, isSet: false },
        ],
      },
    ]);
    expect(await put({ n: 7, b: false })).toEqual({ status: 200, text: '{"ok":true}' });
    // One bad value: nothing saved.
    const bad = await put({ b: true, n: 99 });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.text).error).toMatch(/Nombre/);
    const after = await get();
    expect(after[0].fields.map((f: { value: unknown }) => f.value)).toEqual([7, false]);
    const unknown = await hub.handle({
      method: 'PUT',
      url: '/api/core/settings/x',
      body: '{}',
      contentType: 'application/json',
    });
    expect(unknown.status).toBe(400);
  });

  it('ctx.files: only saveAs, through the page (Android share sheet)', async () => {
    let files: { saveAs: (o: object) => Promise<string | null>; dataPath: () => string } | null =
      null;
    const asked: unknown[] = [];
    await PhoneHub.start({
      db: await openWasmDatabase(),
      modules: [
        {
          manifest: manifest('f') as never,
          backend: { register: (ctx) => void (files = ctx.files as never) },
        },
      ],
      host: {
        saveAs: (o) => {
          asked.push(o);
          return Promise.resolve(null);
        },
      },
      log: () => {},
    });
    expect(
      await files!.saveAs({ title: 'T', defaultName: 'a.md', filters: [], data: 'x' }),
    ).toBeNull();
    expect(asked).toEqual([{ title: 'T', defaultName: 'a.md', data: 'x' }]);
    expect(() => files!.dataPath()).toThrow(UnavailableOnPhoneError);
  });
});
