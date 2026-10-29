import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { NavLink } from 'react-router';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderInput,
  FolderOpen,
  FolderPlus,
  House,
  Pencil,
  ScrollText,
  Search,
  Settings,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { useNavigation, type NavModule } from './NavigationContext';
import {
  createCategory,
  deleteCategory,
  filterNavigation,
  moveCategory,
  moveTool,
  newCategoryId,
  renameCategory,
  setCollapsed,
  shiftTool,
  type NavCategory,
} from './navigation';
import { FullscreenButton } from './WindowControls';

const TOOL_TYPE = 'application/x-toolbox-tool';
const CATEGORY_TYPE = 'application/x-toolbox-category';

type Menu = { x: number; y: number; entries: MenuEntry[] };
type DropTarget = { category: string; before: string | null } | { beforeCategory: string | null };

/**
 * Main navigation: tools grouped in collapsible categories. Categories and
 * tools are reordered by drag and drop or with the context menu (right click);
 * the layout is remembered by the core (docs/ARCHITECTURE.md, « Navigation »).
 */
export function Sidebar(props: { fullscreen: boolean }) {
  const { sidebar, change, error } = useNavigation();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const search = useRef<HTMLInputElement>(null);

  // Ctrl+K: quick search.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const searching = query.trim() !== '';
  const shown = filterNavigation(sidebar, query);
  const allCollapsed = sidebar.length > 0 && sidebar.every((c) => c.collapsed);

  const newCategory = () => {
    const id = newCategoryId();
    change((layout, nav) => createCategory(layout, nav, 'Nouvelle catégorie', id));
    setRenaming(id);
  };

  const removeCategory = (category: NavCategory<NavModule>) => {
    if (
      category.tools.length > 0 &&
      !window.confirm(
        `Supprimer la catégorie « ${category.name} » ?\n\nSes outils retournent dans leur section d’origine. Aucun outil n’est supprimé.`,
      )
    ) {
      return;
    }
    change((layout, nav) => deleteCategory(layout, nav, category.id));
  };

  const categoryMenu = (event: MouseEvent, category: NavCategory<NavModule>, index: number) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      entries: [
        { title: category.name },
        { label: 'Renommer', icon: <Pencil size={14} />, onClick: () => setRenaming(category.id) },
        {
          label: 'Monter',
          icon: <ArrowUp size={14} />,
          disabled: index === 0,
          onClick: () => change((l, n) => moveCategory(l, n, category.id, { delta: -1 })),
        },
        {
          label: 'Descendre',
          icon: <ArrowDown size={14} />,
          disabled: index === sidebar.length - 1,
          onClick: () => change((l, n) => moveCategory(l, n, category.id, { delta: 1 })),
        },
        { separator: true },
        { label: 'Nouvelle catégorie', icon: <FolderPlus size={14} />, onClick: newCategory },
        {
          label: 'Supprimer la catégorie',
          icon: <Trash2 size={14} />,
          onClick: () => removeCategory(category),
        },
      ],
    });
  };

  const toolMenu = (event: MouseEvent, tool: NavModule, category: NavCategory<NavModule>) => {
    event.preventDefault();
    const index = category.tools.findIndex((t) => t.id === tool.id);
    setMenu({
      x: event.clientX,
      y: event.clientY,
      entries: [
        { title: tool.name },
        {
          label: 'Monter',
          icon: <ArrowUp size={14} />,
          disabled: index === 0,
          onClick: () => change((l, n) => shiftTool(l, n, tool.id, -1)),
        },
        {
          label: 'Descendre',
          icon: <ArrowDown size={14} />,
          disabled: index === category.tools.length - 1,
          onClick: () => change((l, n) => shiftTool(l, n, tool.id, 1)),
        },
        { separator: true },
        { title: 'Déplacer vers' },
        ...sidebar
          .filter((c) => c.id !== category.id)
          .map((target) => ({
            label: target.name,
            icon: <FolderInput size={14} />,
            onClick: () => change((l, n) => moveTool(l, n, tool.id, target.id)),
          })),
        {
          label: 'Nouvelle catégorie…',
          icon: <FolderPlus size={14} />,
          onClick: () => {
            const id = newCategoryId();
            change((l, n) => {
              const created = createCategory(l, n, 'Nouvelle catégorie', id);
              const nav = n.concat({
                id,
                name: 'Nouvelle catégorie',
                collapsed: false,
                isSection: false,
                tools: [],
              });
              return moveTool(created, nav, tool.id, id);
            });
            setRenaming(id);
          },
        },
      ],
    });
  };

  // Drag and drop ------------------------------------------------------------
  const dragTool = (event: DragEvent, tool: NavModule) => {
    event.dataTransfer.setData(TOOL_TYPE, tool.id);
    event.dataTransfer.effectAllowed = 'move';
  };
  const dragCategory = (event: DragEvent, category: NavCategory<NavModule>) => {
    event.dataTransfer.setData(CATEGORY_TYPE, category.id);
    event.dataTransfer.effectAllowed = 'move';
  };
  const over = (event: DragEvent, target: DropTarget) => {
    const types = event.dataTransfer.types;
    if (!types.includes('category' in target ? TOOL_TYPE : CATEGORY_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    if (JSON.stringify(target) !== JSON.stringify(drop)) setDrop(target);
  };
  /** Over a category header or a tool: a dragged category goes before this category. */
  const overItem = (event: DragEvent, categoryId: string, beforeTool: string | null) => {
    if (event.dataTransfer.types.includes(CATEGORY_TYPE))
      over(event, { beforeCategory: categoryId });
    else over(event, { category: categoryId, before: beforeTool });
  };
  const dropped = (event: DragEvent) => {
    event.preventDefault();
    const target = drop;
    setDrop(null);
    if (!target) return;
    const tool = event.dataTransfer.getData(TOOL_TYPE);
    const category = event.dataTransfer.getData(CATEGORY_TYPE);
    if (tool && 'category' in target) {
      change((l, n) => moveTool(l, n, tool, target.category, target.before));
    } else if (category && 'beforeCategory' in target && category !== target.beforeCategory) {
      change((l, n) => moveCategory(l, n, category, { before: target.beforeCategory }));
    }
  };
  const isDrop = (target: DropTarget) => JSON.stringify(drop) === JSON.stringify(target);

  return (
    <nav className="sidebar" aria-label="Navigation principale" onDragEnd={() => setDrop(null)}>
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark">
          <Wrench size={15} />
        </span>
        ToolBox
      </div>

      <div className="sidebar__tools">
        <label className="sidebar__search">
          <Search size={14} aria-hidden />
          <input
            ref={search}
            type="search"
            placeholder="Rechercher"
            title="Rechercher un outil (Ctrl+K)"
            aria-label="Rechercher un outil (Ctrl+K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
          {searching ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Effacer"
              onClick={() => setQuery('')}
            >
              <X size={13} />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          className="icon-button"
          title={allCollapsed ? 'Tout déplier' : 'Tout replier'}
          aria-label={allCollapsed ? 'Tout déplier' : 'Tout replier'}
          onClick={() => change((l, n) => setCollapsed(l, n, 'all', !allCollapsed))}
        >
          {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
        </button>
        <button
          type="button"
          className="icon-button"
          title="Nouvelle catégorie"
          aria-label="Nouvelle catégorie"
          onClick={newCategory}
        >
          <FolderPlus size={15} />
        </button>
      </div>

      <div className="sidebar__scroll">
        {!searching && (
          <NavLink to="/" end className="nav-link">
            <House size={16} />
            <span className="nav-link__label">Accueil</span>
          </NavLink>
        )}
        {searching && shown.length === 0 && (
          <p className="sidebar__empty faint small">Aucun outil trouvé.</p>
        )}
        {shown.map((category, index) => {
          const collapsed = category.collapsed && !searching;
          return (
            <div
              key={category.id}
              className={`sidebar__section${isDrop({ beforeCategory: category.id }) ? ' sidebar__section--drop-before' : ''}`}
              onDragOver={(e) => over(e, { category: category.id, before: null })}
              onDrop={dropped}
            >
              <div
                className={`sidebar__category${isDrop({ category: category.id, before: null }) ? ' sidebar__category--drop' : ''}`}
                draggable={!searching && renaming !== category.id}
                onDragStart={(e) => dragCategory(e, category)}
                onDragOver={(e) => overItem(e, category.id, null)}
                onContextMenu={(e) => categoryMenu(e, category, index)}
              >
                {renaming === category.id ? (
                  <RenameField
                    initial={category.name}
                    onDone={(name) => {
                      setRenaming(null);
                      if (name !== null) change((l, n) => renameCategory(l, n, category.id, name));
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="sidebar__category-toggle"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      change((l, n) => setCollapsed(l, n, category.id, !category.collapsed))
                    }
                    onDoubleClick={() => setRenaming(category.id)}
                    title="Clic : replier / déplier · Double-clic : renommer · Clic droit : options"
                  >
                    {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <span className="sidebar__category-name">{category.name}</span>
                    <span className="sidebar__category-count">{category.tools.length}</span>
                  </button>
                )}
              </div>
              {!collapsed &&
                category.tools.map((tool) => (
                  <NavLink
                    key={tool.id}
                    to={`/m/${tool.id}`}
                    className={({ isActive }) =>
                      `nav-link${isActive ? ' active' : ''}${isDrop({ category: category.id, before: tool.id }) ? ' nav-link--drop-before' : ''}`
                    }
                    draggable={!searching}
                    onDragStart={(e) => dragTool(e, tool)}
                    onDragOver={(e) => overItem(e, category.id, tool.id)}
                    onContextMenu={(e) => toolMenu(e, tool, category)}
                  >
                    <span className="nav-link__icon">{tool.module.manifest.icon}</span>
                    <span className="nav-link__label">{tool.name}</span>
                    {tool.module.manifest.experimental && (
                      <span className="nav-link__tag" title="Expérimental">
                        β
                      </span>
                    )}
                  </NavLink>
                ))}
              {!collapsed && category.tools.length === 0 && (
                <p className="sidebar__empty faint small">Glisse un outil ici.</p>
              )}
            </div>
          );
        })}
        {!searching && sidebar.length > 0 && (
          <div
            className={`sidebar__drop-end${isDrop({ beforeCategory: null }) ? ' sidebar__section--drop-before' : ''}`}
            onDragOver={(e) => over(e, { beforeCategory: null })}
            onDrop={dropped}
          />
        )}
        {error && <p className="error small">{error}</p>}
      </div>

      <div className="sidebar__footer">
        <NavLink to="/outputs" className="nav-link">
          <FolderOpen size={16} />
          <span className="nav-link__label">Fichiers générés</span>
        </NavLink>
        <NavLink to="/jobs" className="nav-link">
          <Activity size={16} />
          <span className="nav-link__label">Tâches</span>
        </NavLink>
        <NavLink to="/logs" className="nav-link">
          <ScrollText size={16} />
          <span className="nav-link__label">Journaux</span>
        </NavLink>
        <NavLink to="/settings" className="nav-link">
          <Settings size={16} />
          <span className="nav-link__label">Réglages</span>
        </NavLink>
        <FullscreenButton fullscreen={props.fullscreen} />
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </nav>
  );
}

/** Inline name field: Enter or leaving the field saves, Escape cancels (null). */
function RenameField(props: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(props.initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(name);
  };
  return (
    <input
      className="input sidebar__rename"
      aria-label="Nom de la catégorie"
      autoFocus
      onFocus={(e) => e.target.select()}
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value.trim() || null);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(value.trim() || null)}
    />
  );
}
