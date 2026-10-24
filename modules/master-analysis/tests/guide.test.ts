// The built-in guide: every « ? » and every link lead to a section, every
// capture exists with its marks, and the search finds what it should.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE, linkTargets, searchGuide, sectionById } from '../frontend/guide/content';
import shots from '../frontend/guide/shots.json';

const FRONTEND = path.join(__dirname, '..', 'frontend');

describe('built-in guide', () => {
  it('every « ? » of the interface and every link points to a section', () => {
    const sources = readdirSync(FRONTEND)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync(path.join(FRONTEND, f), 'utf8'))
      .join('\n');
    const topics = [
      ...sources.matchAll(/<Help topic="([^"]+)"/g),
      ...sources.matchAll(/topic: '([^']+)'/g),
      ...sources.matchAll(/: '(vue-[a-z-]+)'/g),
    ].map((m) => m[1]!);
    expect(topics.length).toBeGreaterThan(30);
    for (const topic of [...topics, ...linkTargets()])
      expect(sectionById(topic), topic).not.toBeNull();
  });

  it('section ids are unique, and every view, workflow and setting has its part', () => {
    const ids = GUIDE.flatMap((c) => c.sections.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'prise-en-main',
      'vue-ligne-de-temps',
      'vue-mesures-globales',
      'vue-sections',
      'vue-versions',
      'vue-references',
      'flux-boucle',
      'flux-sections',
      'flux-references',
      'flux-dossier',
      'reglages',
      'limites',
    ])
      expect(ids).toContain(id);
    // Every setting of the module is explained.
    const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', 'module.json'), 'utf8'));
    const settings = JSON.stringify(sectionById('reglages'));
    for (const s of manifest.settings as { label: string }[])
      expect(settings, s.label).toContain(s.label.replace(/'/g, '’').slice(0, 20));
  });

  it('every capture exists, with a box for each of its marks', () => {
    const blocks = GUIDE.flatMap((c) => c.sections.flatMap((s) => s.blocks));
    const captures = blocks.filter(
      (b): b is Extract<(typeof blocks)[number], { shot: string }> =>
        typeof b === 'object' && 'shot' in b,
    );
    expect(captures.length).toBeGreaterThanOrEqual(6);
    const all = shots as Record<string, { file: string; marks: Record<string, unknown> }>;
    for (const c of captures) {
      const shot = all[c.shot];
      expect(shot, c.shot).toBeDefined();
      expect(existsSync(path.join(FRONTEND, 'guide', 'img', shot!.file)), shot!.file).toBe(true);
      for (const m of c.marks) expect(shot!.marks[m.id], `${c.shot}:${m.id}`).toBeDefined();
    }
  });

  it('search: accents and case ignored, every word must match', () => {
    expect(searchGuide('').length).toBe(0);
    expect(searchGuide('PLR').map((r) => r.section.id)).toContain('plr');
    expect(searchGuide('cretE VRAIE').map((r) => r.section.id)).toContain('crete-vraie');
    expect(searchGuide('drop montée').map((r) => r.section.id)).toContain('flux-sections');
    expect(searchGuide('spotify').map((r) => r.section.id)).toContain('normalisation');
    expect(searchGuide('xylophone')).toEqual([]);
  });
});
