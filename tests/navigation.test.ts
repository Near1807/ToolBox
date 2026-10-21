import { describe, expect, it } from 'vitest';
import {
  buildNavigation,
  createCategory,
  deleteCategory,
  EMPTY_LAYOUT,
  filterNavigation,
  moveCategory,
  moveTool,
  parseLayout,
  renameCategory,
  serializeLayout,
  setCollapsed,
  shiftTool,
  type NavLayout,
  type NavTool,
} from '../frontend/src/shell/navigation';

const tools: NavTool[] = [
  { id: 'music-library', name: 'Bibliothèque', section: 'Musique', order: 10 },
  { id: 'youtube-video', name: 'Vidéo YouTube', section: 'Musique', order: 20 },
  { id: 'instagram-video', name: 'Pack Insta', section: 'Musique', order: 30 },
  { id: 'notes', name: 'Notes', section: 'Outils' },
];

const ids = (layout: NavLayout, list = tools) =>
  buildNavigation(list, layout).map((c) => [c.name, c.tools.map((t) => t.id)]);

describe('sidebar navigation', () => {
  it('groups tools by manifest section by default', () => {
    expect(ids(EMPTY_LAYOUT)).toEqual([
      ['Musique', ['music-library', 'youtube-video', 'instagram-video']],
      ['Outils', ['notes']],
    ]);
  });

  it('lets the user create categories and move tools; their choice wins', () => {
    let layout = EMPTY_LAYOUT;
    let nav = buildNavigation(tools, layout);
    layout = createCategory(layout, nav, 'Publier', 'c:pub');
    nav = buildNavigation(tools, layout);
    layout = moveTool(layout, nav, 'instagram-video', 'c:pub');
    nav = buildNavigation(tools, layout);
    layout = moveTool(layout, nav, 'youtube-video', 'c:pub', 'instagram-video');
    expect(ids(layout)).toEqual([
      ['Musique', ['music-library']],
      ['Outils', ['notes']],
      ['Publier', ['youtube-video', 'instagram-video']],
    ]);
    // Survives a save / reload.
    expect(ids(parseLayout(serializeLayout(layout)))).toEqual(ids(layout));
  });

  it('puts a new module in its default section', () => {
    let layout = EMPTY_LAYOUT;
    layout = moveTool(layout, buildNavigation(tools, layout), 'notes', 's:Musique');
    const withNew = [...tools, { id: 'stats', name: 'Stats', section: 'Musique', order: 40 }];
    expect(ids(layout, withNew)).toEqual([
      ['Musique', ['music-library', 'youtube-video', 'instagram-video', 'notes', 'stats']],
      ['Outils', []],
    ]);
  });

  it('keeps the place of a module that is temporarily not loaded', () => {
    let layout = EMPTY_LAYOUT;
    layout = createCategory(layout, buildNavigation(tools, layout), 'Perso', 'c:perso');
    layout = moveTool(layout, buildNavigation(tools, layout), 'notes', 'c:perso');
    const without = tools.filter((t) => t.id !== 'notes');
    // Some change while "notes" is disabled…
    layout = renameCategory(layout, buildNavigation(without, layout), 's:Musique', 'Son');
    // …it comes back where the user put it.
    expect(ids(layout)).toContainEqual(['Perso', ['notes']]);
    expect(ids(layout)[0]).toEqual(['Son', ['music-library', 'youtube-video', 'instagram-video']]);
  });

  it('sends the tools of a deleted category back to their section', () => {
    let layout = EMPTY_LAYOUT;
    layout = createCategory(layout, buildNavigation(tools, layout), 'Perso', 'c:perso');
    layout = moveTool(layout, buildNavigation(tools, layout), 'youtube-video', 'c:perso');
    layout = deleteCategory(layout, buildNavigation(tools, layout), 'c:perso');
    expect(ids(layout).map(([name]) => name)).toEqual(['Musique', 'Outils']);
    expect(ids(layout)[0]![1]).toContain('youtube-video');
  });

  it('reorders tools and categories, remembers collapsed categories', () => {
    let layout = EMPTY_LAYOUT;
    layout = shiftTool(layout, buildNavigation(tools, layout), 'instagram-video', -1);
    expect(ids(layout)[0]![1]).toEqual(['music-library', 'instagram-video', 'youtube-video']);
    layout = moveCategory(layout, buildNavigation(tools, layout), 's:Outils', { delta: -1 });
    expect(ids(layout).map(([name]) => name)).toEqual(['Outils', 'Musique']);
    layout = moveCategory(layout, buildNavigation(tools, layout), 's:Outils', { before: null });
    expect(ids(layout).map(([name]) => name)).toEqual(['Musique', 'Outils']);
    layout = setCollapsed(layout, buildNavigation(tools, layout), 's:Musique', true);
    expect(buildNavigation(tools, parseLayout(serializeLayout(layout)))[0]!.collapsed).toBe(true);
    layout = setCollapsed(layout, buildNavigation(tools, layout), 'all', true);
    expect(buildNavigation(tools, layout).every((c) => c.collapsed)).toBe(true);
  });

  it('searches tools ignoring accents and case, and opens matching categories', () => {
    const nav = buildNavigation(
      tools,
      setCollapsed(EMPTY_LAYOUT, buildNavigation(tools, EMPTY_LAYOUT), 'all', true),
    );
    const found = filterNavigation(nav, 'bibliotheque');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Musique', collapsed: false });
    expect(found[0]!.tools.map((t) => t.id)).toEqual(['music-library']);
  });

  it('ignores an invalid stored layout', () => {
    expect(parseLayout('not json')).toEqual(EMPTY_LAYOUT);
    expect(parseLayout('{"categories":[{"id":1}]}')).toEqual(EMPTY_LAYOUT);
  });
});
