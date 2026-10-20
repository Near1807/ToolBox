import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleInfo } from '@hub/sdk/manifest';
import { createTestHost, createTestHub, type TestHub } from '@hub/sdk/testing';
import { createPkce } from '../../backend/core/accounts';
import { fakeModule } from '../helpers/fake-modules';

const hubs: TestHub[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close().catch(() => {});
});

describe('ctx.accounts, ctx.notifications, start with Windows', () => {
  it('makes PKCE pairs (S256)', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(createPkce().verifier).not.toBe(verifier);
  });

  it('only gives a module the providers declared in permissions.accounts', async () => {
    const hub = await createTestHub({
      modules: [
        fakeModule('declared', {
          manifest: { permissions: { accounts: ['google'] } },
          backend: {
            register: (ctx) => {
              ctx.routes.get('/state', () => ctx.accounts.status('google'));
            },
          },
        }),
        fakeModule('undeclared', {
          backend: { register: (ctx) => void ctx.accounts.status('google') },
        }),
        fakeModule('unknown-provider', {
          manifest: { permissions: { accounts: ['twitter' as 'google'] } },
        }),
      ],
    });
    hubs.push(hub);
    const { body } = await hub.request<ModuleInfo[]>('GET', '/api/core/modules');
    const byId = Object.fromEntries(body.map((m) => [m.id, m]));
    expect(byId.declared!.status).toBe('loaded');
    expect(byId.undeclared!.status).toBe('failed');
    expect(byId.undeclared!.error).toContain('permissions.accounts');
    expect(byId['unknown-provider']!.status).toBe('failed');
    expect(byId['unknown-provider']!.error).toContain('fournisseur de compte inconnu');
    const state = await hub.request('GET', '/api/modules/declared/state');
    expect(state.body).toMatchObject({ provider: 'google', configured: false, connected: false });
    // The OAuth client is a core setting (secret encrypted), entered by the user.
    await hub.request('PUT', '/api/core/settings/accounts', {
      googleClientId: ' id.apps.googleusercontent.com ',
      googleClientSecret: 's3cret',
    });
    const configured = await hub.request('GET', '/api/modules/declared/state');
    expect(configured.body).toMatchObject({ configured: true });
    const settings = await hub.request<{ scope: string; fields: { value: unknown }[] }[]>(
      'GET',
      '/api/core/settings',
    );
    const secret = settings.body.find((s) => s.scope === 'accounts')!.fields[1]!;
    expect(secret.value).toBeNull();
    const accounts = await hub.request('GET', '/api/core/accounts');
    expect(accounts.body).toEqual([
      expect.objectContaining({ provider: 'google', connected: false }),
    ]);
    expect((await hub.request('DELETE', '/api/core/accounts/unknown')).status).toBe(400);
  });

  it('sends notifications that open a page of the module', async () => {
    const sent: { title: string; body: string; target?: string }[] = [];
    const hub = await createTestHub({
      modules: [
        fakeModule('notifier', {
          backend: {
            register: (ctx) => {
              ctx.routes.post('/ping', () => {
                ctx.notifications.notify({ title: 'Rappel', body: 'Reel 2', path: 'items/3' });
                ctx.notifications.notify({ title: 'Accueil', body: '' });
                return { ok: true };
              });
            },
          },
        }),
      ],
      host: createTestHost({ notify: (n) => sent.push(n) }),
    });
    hubs.push(hub);
    await hub.request('POST', '/api/modules/notifier/ping');
    expect(sent).toEqual([
      { title: 'Rappel', body: 'Reel 2', target: '/m/notifier/items/3' },
      { title: 'Accueil', body: '', target: '/m/notifier' },
    ]);
  });

  it('applies « Lancer ToolBox au démarrage de Windows » (off by default)', async () => {
    const calls: boolean[] = [];
    const hub = await createTestHub({
      modules: [],
      host: createTestHost({ setLaunchAtStartup: (enabled) => calls.push(enabled) }),
    });
    hubs.push(hub);
    expect(calls).toEqual([false]);
    await hub.request('PUT', '/api/core/settings/core', { launchAtStartup: true });
    await hub.request('PUT', '/api/core/settings/core', { launchAtStartup: false });
    expect(calls).toEqual([false, true, false]);
  });
});
