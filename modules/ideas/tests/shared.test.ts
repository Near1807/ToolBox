// Search without accents, tag filter, simple formatting (never HTML), long ideas.
import { describe, expect, it } from 'vitest';
import { splitIdea, markdownOf } from '../backend/index';
import { formatText, matchesSearch, matchesTags } from '../shared';

describe('search', () => {
  const idea = {
    title: 'Élan des cordes',
    body: 'Un break **lent** à 1:30',
    tags: ['arrangement'],
  };
  it('ignores accents and case, every word must be there', () => {
    expect(matchesSearch(idea, 'elan')).toBe(true);
    expect(matchesSearch(idea, 'ÉLAN CORDES')).toBe(true);
    expect(matchesSearch(idea, 'break lent')).toBe(true);
    expect(matchesSearch(idea, '#arrangement')).toBe(true);
    expect(matchesSearch(idea, 'cordes piano')).toBe(false);
    expect(matchesSearch(idea, '  ')).toBe(true);
  });
  it('several tags narrow the list', () => {
    expect(matchesTags({ tags: ['a', 'b'] }, ['a'])).toBe(true);
    expect(matchesTags({ tags: ['a', 'b'] }, ['a', 'b'])).toBe(true);
    expect(matchesTags({ tags: ['a'] }, ['a', 'b'])).toBe(false);
    expect(matchesTags({ tags: [] }, [])).toBe(true);
  });
});

describe('simple formatting', () => {
  it('bold, italic, lists, links; HTML stays text', () => {
    const blocks = formatText(
      'Intro **forte** et *douce*\nvoir https://exemple.fr/a.\n\n- cordes\n- [démo](https://x.fr/d)\n<script>x</script>',
    );
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      parts: [
        { kind: 'text', text: 'Intro ' },
        { kind: 'bold', text: 'forte' },
        { kind: 'text', text: ' et ' },
        { kind: 'italic', text: 'douce' },
        { kind: 'text', text: '\nvoir ' },
        { kind: 'link', text: 'https://exemple.fr/a', url: 'https://exemple.fr/a' },
        { kind: 'text', text: '.' },
      ],
    });
    expect(blocks[1]).toEqual({
      kind: 'list',
      items: [
        [{ kind: 'text', text: 'cordes' }],
        [{ kind: 'link', text: 'démo', url: 'https://x.fr/d' }],
      ],
    });
    expect(blocks[2]).toEqual({
      kind: 'paragraph',
      parts: [{ kind: 'text', text: '<script>x</script>' }],
    });
    // Only http(s) links.
    expect(formatText('[x](javascript:alert(1))')[0]).toMatchObject({
      parts: [{ kind: 'text' }],
    });
  });
});

describe('ideas said aloud', () => {
  it('a short one is its title; a long one keeps the whole text', () => {
    expect(splitIdea('  un break   avec des cordes ')).toEqual({
      title: 'un break avec des cordes',
      body: '',
    });
    const long =
      'faire un clip tourné de nuit dans le métro avec des lumières qui suivent le kick et des plans très lents';
    const { title, body } = splitIdea(long);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(body).toBe(long);
  });
  it('exports in Markdown with tags, dates, track and task', () => {
    const md = markdownOf([
      {
        id: 1,
        title: 'Break',
        body: 'Des **cordes**',
        tags: ['arrangement'],
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-21T10:00:00.000Z',
        archived: false,
        track: { id: 1, title: 'Nuit Blanche' },
        task: { id: 3, title: 'Break' },
      },
    ]);
    expect(md).toContain('## Break');
    expect(md).toContain(
      '*#arrangement · créée le 2026-10-20 · modifiée le 2026-10-21 · morceau : Nuit Blanche · devenue une tâche*',
    );
    expect(md).toContain('Des **cordes**');
  });
});
