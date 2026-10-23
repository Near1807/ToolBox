import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleSettings } from '@hub/sdk/backend';
import { createTestHub, type TestHub } from '@hub/sdk/testing';
import type { SettingsSection } from '../../backend/core/settings';
import { fakeModule } from '../helpers/fake-modules';

describe('settings', () => {
  let hub: TestHub;
  let settings: ModuleSettings;
  const changes: string[] = [];

  beforeEach(async () => {
    hub = await createTestHub({
      modules: [
        fakeModule('conf', {
          manifest: {
            settings: [
              { key: 'artist', type: 'string', label: 'Artiste', default: 'Thomas' },
              { key: 'duration', type: 'number', label: 'Durée', min: 15, max: 90, default: 30 },
              { key: 'apiKey', type: 'secret', label: 'Clé' },
              { key: 'days', type: 'weekdays', label: 'Jours', default: '1,2,3,4,5' },
              { key: 'key', type: 'string', label: 'Touche', default: '106', hidden: true },
            ],
          },
          backend: {
            register: (ctx) => {
              settings = ctx.settings;
              ctx.settings.onChange((key) => changes.push(key));
            },
          },
        }),
      ],
    });
  });

  afterEach(async () => {
    await hub.close();
  });

  it('keeps hidden settings off the Settings page, but readable', async () => {
    const { body } = await hub.request<SettingsSection[]>('GET', '/api/core/settings');
    const keys = body.find((s) => s.scope === 'conf')!.fields.map((f) => f.field.key);
    expect(keys).not.toContain('key');
    expect(settings.get('key')).toBe('106');
  });

  it('returns declared defaults', () => {
    expect(settings.get('artist')).toBe('Thomas');
    expect(settings.get('duration')).toBe(30);
    expect(settings.get('apiKey')).toBeNull();
  });

  it('saves values from the Settings page and notifies the module', async () => {
    const response = await hub.request('PUT', '/api/core/settings/conf', {
      artist: 'Near',
      duration: 45,
    });
    expect(response.status).toBe(200);
    expect(settings.get('artist')).toBe('Near');
    expect(changes).toEqual(['artist', 'duration']);
  });

  it('validates values and saves nothing when one is invalid', async () => {
    const response = await hub.request<{ error: string }>('PUT', '/api/core/settings/conf', {
      artist: 'X',
      duration: 200,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/maximum 90/);
    expect(settings.get('artist')).toBe('Thomas');
  });

  it('encrypts secrets and never sends them back to the UI', async () => {
    await hub.request('PUT', '/api/core/settings/conf', { apiKey: 's3cr3t' });
    expect(settings.get('apiKey')).toBe('s3cr3t');
    const raw = hub.hub.handle.db
      .prepare("SELECT value, encrypted FROM core__settings WHERE key = 'apiKey'")
      .get() as { value: string; encrypted: number };
    expect(raw.encrypted).toBe(1);
    expect(raw.value).not.toContain('s3cr3t');

    const { body } = await hub.request<SettingsSection[]>('GET', '/api/core/settings');
    const field = body
      .find((s) => s.scope === 'conf')!
      .fields.find((f) => f.field.key === 'apiKey')!;
    expect(field).toMatchObject({ value: null, isSet: true });
  });

  it('exposes the core output folder setting', async () => {
    const { body } = await hub.request<SettingsSection[]>('GET', '/api/core/settings');
    expect(body[0]).toMatchObject({ scope: 'core', title: 'Général' });
    expect(body[0]!.fields[0]!.field.key).toBe('outputRoot');
  });

  it('keeps interface preferences (theme, sidebar) apart from the Settings page', async () => {
    expect((await hub.request('GET', '/api/core/ui')).body).toEqual({ theme: '', navigation: '' });
    expect((await hub.request('PUT', '/api/core/ui', { theme: 'clair' })).status).toBe(200);
    expect((await hub.request('GET', '/api/core/ui')).body).toMatchObject({ theme: 'clair' });
    const { body } = await hub.request<SettingsSection[]>('GET', '/api/core/settings');
    expect(body.some((s) => s.scope === 'ui')).toBe(false);
    expect((await hub.request('PUT', '/api/core/ui', { unknown: 1 })).status).toBe(400);
  });

  it('stores days of the week, sorted, at least one', async () => {
    expect(settings.get('days')).toBe('1,2,3,4,5');
    await hub.request('PUT', '/api/core/settings/conf', { days: '6,1,1' });
    expect(settings.get('days')).toBe('1,6');
    expect((await hub.request('PUT', '/api/core/settings/conf', { days: '' })).status).toBe(400);
    expect((await hub.request('PUT', '/api/core/settings/conf', { days: '8' })).status).toBe(400);
  });
});
