// Sidebar and home page layout: categories of tools, chosen by the user.
// By default a tool sits in the category named after its manifest `section`;
// once the user moves it, their choice wins. A module that appears later lands
// in its default section. The layout is stored by the core (ui.navigation).
// Pure functions only: tested in tests/navigation.test.ts.

export interface NavTool {
  id: string;
  name: string;
  section: string;
  order?: number;
}

export interface NavCategoryLayout {
  id: string;
  name: string;
  collapsed?: boolean;
  /** Tool ids in display order (may include tools not loaded right now). */
  tools: string[];
}

export interface NavLayout {
  categories: NavCategoryLayout[];
}

export interface NavCategory<T extends NavTool = NavTool> {
  id: string;
  name: string;
  collapsed: boolean;
  /** Category created from a manifest section (as opposed to one made by the user). */
  isSection: boolean;
  tools: T[];
}

export const EMPTY_LAYOUT: NavLayout = { categories: [] };

let lastId = 0;
/** Unique id for a category made by the user. */
export function newCategoryId(): string {
  lastId = Math.max(lastId + 1, Date.now());
  return `c:${lastId.toString(36)}`;
}

/** Id of the category holding the tools of a manifest section by default. */
export const sectionCategoryId = (section: string) => `s:${section}`;

/** Reads the stored JSON; anything invalid gives the default layout. */
export function parseLayout(json: string | null | undefined): NavLayout {
  if (!json) return EMPTY_LAYOUT;
  try {
    const value = JSON.parse(json) as { categories?: unknown };
    if (!Array.isArray(value.categories)) return EMPTY_LAYOUT;
    const seen = new Set<string>();
    const categories: NavCategoryLayout[] = [];
    for (const raw of value.categories as Record<string, unknown>[]) {
      if (typeof raw?.id !== 'string' || typeof raw.name !== 'string' || seen.has(raw.id)) continue;
      seen.add(raw.id);
      categories.push({
        id: raw.id,
        name: raw.name,
        collapsed: raw.collapsed === true,
        tools: Array.isArray(raw.tools)
          ? (raw.tools as unknown[]).filter((t): t is string => typeof t === 'string')
          : [],
      });
    }
    return { categories };
  } catch {
    return EMPTY_LAYOUT;
  }
}

export function serializeLayout(layout: NavLayout): string {
  return JSON.stringify(layout);
}

const byManifestOrder = (a: NavTool, b: NavTool) =>
  (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name, 'fr');

/**
 * Categories with their tools, in display order. Each tool appears once: in
 * the first category listing it, otherwise in its section's category
 * (created after the user's categories when missing).
 */
export function buildNavigation<T extends NavTool>(
  tools: T[],
  layout: NavLayout,
): NavCategory<T>[] {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const placed = new Set<string>();
  const categories: NavCategory<T>[] = layout.categories.map((category) => {
    const list: T[] = [];
    for (const id of category.tools) {
      const tool = byId.get(id);
      if (tool && !placed.has(id)) {
        placed.add(id);
        list.push(tool);
      }
    }
    return {
      id: category.id,
      name: category.name,
      collapsed: category.collapsed === true,
      isSection: category.id.startsWith('s:'),
      tools: list,
    };
  });

  const rest = tools.filter((tool) => !placed.has(tool.id)).sort(byManifestOrder);
  const added: NavCategory<T>[] = [];
  for (const tool of rest) {
    const id = sectionCategoryId(tool.section);
    let category = categories.find((c) => c.id === id) ?? added.find((c) => c.id === id);
    if (!category) {
      category = { id, name: tool.section, collapsed: false, isSection: true, tools: [] };
      added.push(category);
    }
    category.tools.push(tool);
  }
  // New sections: in the order of their first tool.
  return [...categories, ...added];
}

/** The displayed navigation, written back as an explicit layout (keeps unknown tools). */
export function materialize(nav: NavCategory[], previous: NavLayout): NavLayout {
  const shown = new Set(nav.flatMap((c) => c.tools.map((t) => t.id)));
  return {
    categories: nav.map((category) => {
      const before = previous.categories.find((c) => c.id === category.id);
      const hidden = (before?.tools ?? []).filter((id) => !shown.has(id));
      return {
        id: category.id,
        name: category.name,
        collapsed: category.collapsed,
        tools: [...category.tools.map((t) => t.id), ...hidden],
      };
    }),
  };
}

function update(
  layout: NavLayout,
  nav: NavCategory[],
  change: (categories: NavCategoryLayout[]) => void,
): NavLayout {
  const next = materialize(nav, layout);
  change(next.categories);
  return next;
}

/** Moves a tool into a category, before another tool (or at the end). */
export function moveTool(
  layout: NavLayout,
  nav: NavCategory[],
  toolId: string,
  categoryId: string,
  beforeToolId?: string | null,
): NavLayout {
  return update(layout, nav, (categories) => {
    const target = categories.find((c) => c.id === categoryId);
    if (!target || toolId === beforeToolId) return;
    for (const category of categories)
      category.tools = category.tools.filter((id) => id !== toolId);
    const index = beforeToolId ? target.tools.indexOf(beforeToolId) : -1;
    if (index === -1) target.tools.push(toolId);
    else target.tools.splice(index, 0, toolId);
  });
}

/** Moves a tool one step up or down inside its category. */
export function shiftTool(
  layout: NavLayout,
  nav: NavCategory[],
  toolId: string,
  delta: -1 | 1,
): NavLayout {
  return update(layout, nav, (categories) => {
    const category = categories.find((c) => c.tools.includes(toolId));
    if (!category) return;
    const visible = nav.find((c) => c.id === category.id)!.tools.map((t) => t.id);
    const index = visible.indexOf(toolId);
    const other = visible[index + delta];
    if (!other) return;
    const a = category.tools.indexOf(toolId);
    const b = category.tools.indexOf(other);
    [category.tools[a], category.tools[b]] = [category.tools[b]!, category.tools[a]!];
  });
}

export function createCategory(
  layout: NavLayout,
  nav: NavCategory[],
  name: string,
  id = newCategoryId(),
): NavLayout {
  return update(layout, nav, (categories) => {
    categories.push({ id, name: name.trim() || 'Nouvelle catégorie', collapsed: false, tools: [] });
  });
}

export function renameCategory(
  layout: NavLayout,
  nav: NavCategory[],
  categoryId: string,
  name: string,
): NavLayout {
  return update(layout, nav, (categories) => {
    const category = categories.find((c) => c.id === categoryId);
    if (category && name.trim()) category.name = name.trim();
  });
}

/**
 * Deletes a category. Its tools go back to their default section, which
 * reappears (under the section name) if it was the deleted one.
 */
export function deleteCategory(
  layout: NavLayout,
  nav: NavCategory[],
  categoryId: string,
): NavLayout {
  return update(layout, nav, (categories) => {
    const index = categories.findIndex((c) => c.id === categoryId);
    if (index !== -1) categories.splice(index, 1);
  });
}

/** Moves a category one step up or down, or before another category. */
export function moveCategory(
  layout: NavLayout,
  nav: NavCategory[],
  categoryId: string,
  target: { delta: -1 | 1 } | { before: string | null },
): NavLayout {
  return update(layout, nav, (categories) => {
    const index = categories.findIndex((c) => c.id === categoryId);
    if (index === -1) return;
    const [category] = categories.splice(index, 1);
    let to: number;
    if ('delta' in target) to = Math.min(categories.length, Math.max(0, index + target.delta));
    else {
      const before = target.before ? categories.findIndex((c) => c.id === target.before) : -1;
      to = before === -1 ? categories.length : before;
    }
    categories.splice(to, 0, category!);
  });
}

export function setCollapsed(
  layout: NavLayout,
  nav: NavCategory[],
  categoryId: string | 'all',
  collapsed: boolean,
): NavLayout {
  return update(layout, nav, (categories) => {
    for (const category of categories) {
      if (categoryId === 'all' || category.id === categoryId) category.collapsed = collapsed;
    }
  });
}

/** Quick search: tools whose name contains the text (accents and case ignored). */
export function filterNavigation<T extends NavTool>(
  nav: NavCategory<T>[],
  query: string,
): NavCategory<T>[] {
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const needle = fold(query.trim());
  if (!needle) return nav;
  return nav
    .map((category) => ({
      ...category,
      collapsed: false,
      tools: category.tools.filter(
        (tool) => fold(tool.name).includes(needle) || fold(category.name).includes(needle),
      ),
    }))
    .filter((category) => category.tools.length > 0);
}
