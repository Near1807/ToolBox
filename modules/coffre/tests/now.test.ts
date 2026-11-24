// v0.47.0 F: « Maintenant » — a course of the Agenda in progress or within 15
// minutes: its context (by name / code, or linked by hand), its elements, the
// most recent first; without the Agenda (or no course now): nothing.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import type { AgendaCourseNow } from '../../agenda/contract';
import { contextOfCourse, linkedTo, NO_COURSE } from '../shared/now';
import type { ContextDto, ItemDto, NowDto } from '../shared/types';

const API = '/api/modules/coffre';

describe('cours ↔ contexte (pur)', () => {
  const c = (id: string, p: string[], courseName: string | null = null) => ({
    id,
    name: p[p.length - 1]!,
    path: p,
    courseName,
  });
  it('par la main d’abord, puis par le nom ou le code (le plus profond), jamais « aucun »', () => {
    const course = { name: 'Thermodynamique', code: 'TH2C' };
    const list = [c('a', ['Cours', 'TH2C']), c('b', ['Cours', 'S2', 'th2c'])];
    expect(contextOfCourse(list, course)?.id).toBe('b');
    expect(contextOfCourse([...list, c('h', ['Perso'], 'thermodynamique')], course)?.id).toBe('h');
    expect(linkedTo({ name: 'TH2C', courseName: NO_COURSE }, course)).toBeNull();
    expect(linkedTo({ name: 'TH2C', courseName: 'Réseaux' }, course)).toBeNull();
  });
});

/** A fake Agenda giving the courses now (the real one reads its timetable at the hub's clock). */
const fakeAgenda = (list: () => AgendaCourseNow[]) => ({
  folder: 'agenda',
  manifest: {
    id: 'agenda',
    name: 'Agenda',
    description: 'x',
    version: '1.0.0',
    section: 'Outils',
    icon: 'calendar',
    provides: { services: ['agenda'] },
  },
  backend: {
    register(ctx: import('@hub/sdk/core').ModuleContext) {
      ctx.services.provide('agenda', { courses: () => [], coursesNow: () => list() });
    },
  },
});

let hub: TestHub | null = null;
afterEach(async () => {
  await hub?.close();
  hub = null;
});
const ok = async <T>(method: string, url: string, body?: unknown) => {
  const r = await hub!.request<T>(method, url, body);
  if (r.status >= 400) throw new Error(`${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

describe('Maintenant', () => {
  it('sans Agenda : rien', async () => {
    hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    expect(await ok('GET', `${API}/now`)).toBeNull();
  });

  it('en cours / dans 15 min / aucun ; contexte par le code, puis lié à la main ; récents d’abord', async () => {
    let now: AgendaCourseNow[] = [];
    hub = await createTestHub({
      loadExamples: false,
      modules: [fakeAgenda(() => now), await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    const ctx = await ok<ContextDto>('POST', `${API}/contexts`, { name: 'TH2C' });
    const other = await ok<ContextDto>('POST', `${API}/contexts`, { name: 'Physique' });
    expect(await ok('GET', `${API}/now`)).toBeNull();
    const course = (inProgress: boolean): AgendaCourseNow => ({
      name: 'Thermodynamique',
      code: 'TH2C',
      teachers: ['PCH'],
      start: '2026-11-24T10:45',
      end: '2026-11-24T12:45',
      location: 'Salle 2E',
      inProgress,
    });
    now = [course(true)];
    let n = (await ok<NowDto>('GET', `${API}/now`))!;
    expect(n.course).toMatchObject({
      name: 'Thermodynamique',
      end: '2026-11-24T12:45',
      inProgress: true,
    });
    expect(n.context?.id).toBe(ctx.id);
    expect(n.items).toEqual([]);
    now = [course(false)];
    expect((await ok<NowDto>('GET', `${API}/now`))!.course.inProgress).toBe(false);
    // Linked by hand to another context.
    await ok('PATCH', `${API}/contexts/${other.id}`, { courseName: 'Thermodynamique' });
    n = (await ok<NowDto>('GET', `${API}/now`))!;
    expect(n.context?.id).toBe(other.id);
    expect(n.context?.courseName).toBe('Thermodynamique');
    await ok('PATCH', `${API}/contexts/${other.id}`, { courseName: null });
    expect((await ok<NowDto>('GET', `${API}/now`))!.context?.id).toBe(ctx.id);
    now = [];
    expect(await ok('GET', `${API}/now`)).toBeNull();
    void ({} as ItemDto);
  });
});
