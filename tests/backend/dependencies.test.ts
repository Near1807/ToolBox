import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@hub/sdk/manifest';
import { planModuleLoading } from '../../backend/core/modules/dependencies';

function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return { id, name: id, description: '', version: '1.0.0', section: 'S', icon: 'x', ...extra };
}

describe('planModuleLoading', () => {
  it('orders providers before consumers', () => {
    const plan = planModuleLoading([
      manifest('youtube-video', {
        dependsOn: { services: ['musicLibrary'], modules: ['video-engine'] },
      }),
      manifest('video-engine'),
      manifest('music-library', { provides: { services: ['musicLibrary'] } }),
    ]);
    expect(plan.blocked.size).toBe(0);
    expect(plan.order.indexOf('music-library')).toBeLessThan(plan.order.indexOf('youtube-video'));
    expect(plan.order.indexOf('video-engine')).toBeLessThan(plan.order.indexOf('youtube-video'));
  });

  it('blocks a module whose dependency is absent, with a clear reason', () => {
    const plan = planModuleLoading([
      manifest('youtube-video', { dependsOn: { modules: ['video-engine'] } }),
    ]);
    expect(plan.order).toEqual([]);
    expect(plan.blocked.get('youtube-video')).toMatch(/« video-engine » est absent/);
  });

  it('blocks a module whose service is provided by nobody', () => {
    const plan = planModuleLoading([manifest('a', { dependsOn: { services: ['x'] } })]);
    expect(plan.blocked.get('a')).toMatch(/aucun module/);
  });

  it('cascades through unavailable modules', () => {
    const plan = planModuleLoading(
      [
        manifest('a'),
        manifest('b', { dependsOn: { modules: ['a'] } }),
        manifest('c', { dependsOn: { modules: ['b'] } }),
        manifest('d'),
      ],
      new Map([['a', 'désactivé']]),
    );
    expect(plan.order).toEqual(['d']);
    expect([...plan.blocked.keys()].sort()).toEqual(['b', 'c']);
  });

  it('detects dependency cycles', () => {
    const plan = planModuleLoading([
      manifest('a', { dependsOn: { modules: ['b'] } }),
      manifest('b', { dependsOn: { modules: ['a'] } }),
    ]);
    expect(plan.blocked.get('a')).toMatch(/circulaire/);
  });

  it('loads providers of optional services first, and never blocks without them', () => {
    const plan = planModuleLoading(
      [
        manifest('planner', {
          dependsOn: { services: ['library'], optionalServices: ['reels', 'stats'] },
        }),
        manifest('reels', { provides: { services: ['reels'] } }),
        manifest('library', { provides: { services: ['library'] } }),
        manifest('stats', { provides: { services: ['stats'] } }),
      ],
      new Map([['stats', 'désactivé']]),
    );
    expect(plan.blocked.size).toBe(0);
    expect(plan.order.indexOf('reels')).toBeLessThan(plan.order.indexOf('planner'));
    expect(plan.order).not.toContain('stats');
    // Absent provider: still loaded.
    expect(
      planModuleLoading([manifest('a', { dependsOn: { optionalServices: ['x'] } })]).order,
    ).toEqual(['a']);
  });

  it('breaks a cycle made only of optional links', () => {
    const plan = planModuleLoading([
      manifest('a', { provides: { services: ['sa'] }, dependsOn: { optionalServices: ['sb'] } }),
      manifest('b', { provides: { services: ['sb'] }, dependsOn: { optionalServices: ['sa'] } }),
    ]);
    expect(plan.blocked.size).toBe(0);
    expect(plan.order).toHaveLength(2);
  });
});
