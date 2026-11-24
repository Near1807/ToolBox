// v0.42.0 (Expérimental): the shared context menu (ADR 0048, MODULES.md §7.7).
// One component and one hook for every module and the shell: right click,
// the Menu key or Shift+F10 (keyboard), a long press on the phone (~500 ms,
// cancelled by a move or a scroll, so neither the scroll nor a block's drag
// suffers). Items: label, icon, shortcut shown, enabled or disabled with a
// reason, separators, titles, one level of submenu, « dangereuse » (always
// asks its confirmation first). Closed by Échap, a click elsewhere, a scroll,
// a resize. Kept inside the window. Only actions that exist elsewhere in the
// interface go in a menu; an element without a menu keeps the browser's.
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';

// --- The items ----------------------------------------------------------------------

/** An action of the menu. */
export interface MenuAction {
  label: string;
  icon?: IconName;
  /** Shown on the right (« Entrée »): the shortcut that does the same elsewhere. */
  shortcut?: string;
  /** Disabled: `true`, or the reason, shown to the user (« Déjà faite »). */
  disabled?: boolean | string;
  onSelect: () => void;
}

/** A dangerous action: red, and it asks `confirm` first (« Annuler » stays the caller's). */
export interface MenuDanger extends MenuAction {
  danger: true;
  /** The question asked before (window.confirm): never skipped. */
  confirm: string;
}

/** One level of submenu (« Changer de catégorie › »). */
export interface MenuSubmenu {
  label: string;
  icon?: IconName;
  disabled?: boolean | string;
  submenu: MenuItem[];
}

export type MenuItem =
  MenuAction | MenuDanger | MenuSubmenu | { separator: true } | { title: string };

const isSeparator = (i: MenuItem): i is { separator: true } => 'separator' in i;
const isTitle = (i: MenuItem): i is { title: string } => 'title' in i;
export const isSubmenu = (i: MenuItem): i is MenuSubmenu => 'submenu' in i;
/** Can it take the focus (an action or a submenu, disabled ones too: their reason is read)? */
export const focusable = (i: MenuItem) => !isSeparator(i) && !isTitle(i);
const reasonOf = (i: MenuItem) =>
  'disabled' in i && typeof i.disabled === 'string' ? i.disabled : null;
export const isDisabled = (i: MenuItem) => 'disabled' in i && Boolean(i.disabled);

/** Separators never twice, nor first, nor last; titles followed by nothing removed. */
export function cleanItems(items: readonly (MenuItem | null | false | undefined)[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const i of items) {
    if (!i) continue;
    if (isSeparator(i) && (out.length === 0 || isSeparator(out[out.length - 1]!))) continue;
    out.push(i);
  }
  while (out.length && (isSeparator(out[out.length - 1]!) || isTitle(out[out.length - 1]!)))
    out.pop();
  return out;
}

// --- Pure logic (tested) --------------------------------------------------------------

/** The next item to focus from `index` (-1: none yet) going `delta` (wraps; skips separators and titles). */
export function nextIndex(items: readonly MenuItem[], index: number, delta: 1 | -1): number {
  const n = items.length;
  if (!items.some(focusable)) return -1;
  let i = index;
  for (let step = 0; step < n; step++) {
    i = (((i + delta) % n) + n) % n;
    if (focusable(items[i]!)) return i;
  }
  return index;
}

export type MenuKeyResult =
  | { kind: 'focus'; index: number }
  | { kind: 'select'; index: number }
  | { kind: 'open-sub'; index: number }
  | { kind: 'close-sub' }
  | { kind: 'close' }
  | { kind: 'none' };

/** What a key does in a menu (`inSub`: in a submenu). */
export function menuKey(
  key: string,
  items: readonly MenuItem[],
  index: number,
  inSub = false,
): MenuKeyResult {
  switch (key) {
    case 'ArrowDown':
      return { kind: 'focus', index: nextIndex(items, index, 1) };
    case 'ArrowUp':
      return { kind: 'focus', index: nextIndex(items, index < 0 ? 0 : index, -1) };
    case 'Home':
      return { kind: 'focus', index: nextIndex(items, -1, 1) };
    case 'End':
      return { kind: 'focus', index: nextIndex(items, 0, -1) };
    case 'ArrowRight':
      return index >= 0 && isSubmenu(items[index]!) && !isDisabled(items[index]!)
        ? { kind: 'open-sub', index }
        : { kind: 'none' };
    case 'ArrowLeft':
      return inSub ? { kind: 'close-sub' } : { kind: 'none' };
    case 'Enter':
    case ' ':
      if (index < 0) return { kind: 'none' };
      if (isSubmenu(items[index]!))
        return isDisabled(items[index]!) ? { kind: 'none' } : { kind: 'open-sub', index };
      return { kind: 'select', index };
    case 'Escape':
      return inSub ? { kind: 'close-sub' } : { kind: 'close' };
    case 'Tab':
      return { kind: 'close' };
    default:
      return { kind: 'none' };
  }
}

/**
 * Run an item chosen: never a disabled one; a dangerous one only after its
 * confirmation. Returns whether its action ran.
 */
export function runItem(
  item: MenuItem,
  confirm: (question: string) => boolean = (q) => window.confirm(q),
): boolean {
  if (!focusable(item) || isSubmenu(item) || isDisabled(item)) return false;
  const action = item as MenuAction | MenuDanger;
  if ('danger' in action && action.danger && !confirm(action.confirm)) return false;
  action.onSelect();
  return true;
}

/** Where the menu goes: at the point, flipped left / up when it would leave the window. */
export function placeMenu(
  at: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  let left = at.x;
  let top = at.y;
  if (left + size.width > viewport.width - margin) left = Math.max(margin, at.x - size.width);
  if (top + size.height > viewport.height - margin) top = Math.max(margin, at.y - size.height);
  left = Math.min(Math.max(margin, left), Math.max(margin, viewport.width - size.width - margin));
  top = Math.min(Math.max(margin, top), Math.max(margin, viewport.height - size.height - margin));
  return { left, top };
}

/** The keyboard's way to open a menu: the Menu key, or Shift+F10. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) =>
  e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');

/** How long a finger stays still to open the menu (phone), and how far it may move. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_MOVE_PX = 10;

/**
 * A long press: `start` on the finger down, `move` on each move (more than
 * LONG_PRESS_MOVE_PX: cancelled, it is a scroll or a drag), `cancel` on a
 * scroll or the finger up. Fires `onFire(x, y)` once after LONG_PRESS_MS.
 */
export class LongPress {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private origin: { x: number; y: number } | null = null;
  fired = false;
  constructor(
    private readonly onFire: (x: number, y: number) => void,
    private readonly delay = LONG_PRESS_MS,
  ) {}
  start(x: number, y: number) {
    this.cancel();
    this.fired = false;
    this.origin = { x, y };
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fired = true;
      this.onFire(x, y);
    }, this.delay);
  }
  move(x: number, y: number) {
    if (this.origin && Math.hypot(x - this.origin.x, y - this.origin.y) > LONG_PRESS_MOVE_PX)
      this.cancel();
  }
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.origin = null;
  }
}

// --- The component ----------------------------------------------------------------------

function MenuList(props: {
  items: MenuItem[];
  at: { x: number; y: number };
  onClose: () => void;
  label?: string;
  inSub?: boolean;
  onBack?: () => void;
}) {
  const { items, onClose } = props;
  const [index, setIndex] = useState(() => (props.inSub ? nextIndex(items, -1, 1) : -1));
  const [sub, setSub] = useState<{ index: number; at: { x: number; y: number } } | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const focus = (i: number) => {
    setIndex(i);
    buttons.current[i]?.focus();
  };
  const openSub = (i: number) => {
    const r = buttons.current[i]?.getBoundingClientRect();
    if (r) setSub({ index: i, at: { x: r.right - 4, y: r.top - 5 } });
  };
  const choose = (i: number) => {
    const item = items[i]!;
    if (isSubmenu(item)) {
      if (!isDisabled(item)) openSub(i);
      return;
    }
    if (isDisabled(item)) return;
    onClose();
    runItem(item);
  };
  /** Placed at once, inside the window (a submenu: next to its item). */
  const place = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const p = placeMenu(
        props.at,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      if (props.inSub) el.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
      else el.focus();
    },
    [props.at, props.inSub],
  );
  return (
    <>
      <div
        ref={place}
        className="ui-menu"
        role="menu"
        tabIndex={-1}
        aria-label={props.label}
        style={{ left: props.at.x, top: props.at.y }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (sub) return;
          const r = menuKey(e.key, items, index, props.inSub);
          if (r.kind === 'none') return;
          e.preventDefault();
          e.stopPropagation();
          if (r.kind === 'focus') focus(r.index);
          else if (r.kind === 'open-sub') openSub(r.index);
          else if (r.kind === 'select') choose(r.index);
          else if (r.kind === 'close-sub') props.onBack?.();
          else onClose();
        }}
      >
        {items.map((item, i) => {
          if (isSeparator(item)) return <hr key={i} />;
          if (isTitle(item))
            return (
              <div key={i} className="ui-menu__title label">
                {item.title}
              </div>
            );
          const reason = reasonOf(item);
          const danger = 'danger' in item && item.danger;
          return (
            <button
              key={i}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === index ? 0 : -1}
              aria-disabled={isDisabled(item) || undefined}
              aria-haspopup={isSubmenu(item) ? 'menu' : undefined}
              aria-expanded={isSubmenu(item) ? sub?.index === i : undefined}
              className={`ui-menu__item${danger ? ' ui-menu__item--danger' : ''}${isDisabled(item) ? ' ui-menu__item--disabled' : ''}`}
              title={reason ?? undefined}
              onMouseEnter={() => {
                setIndex(i);
                if (isSubmenu(item) && !isDisabled(item)) openSub(i);
                else if (sub) setSub(null);
              }}
              onClick={() => choose(i)}
            >
              <span className="ui-menu__icon" aria-hidden="true">
                {item.icon && <Icon name={item.icon} />}
              </span>
              <span className="ui-menu__label">
                {item.label}
                {reason && <span className="ui-menu__reason">{reason}</span>}
              </span>
              {'shortcut' in item && item.shortcut && (
                <kbd className="ui-menu__shortcut">{item.shortcut}</kbd>
              )}
              {isSubmenu(item) && <Icon name="chevron-right" />}
            </button>
          );
        })}
      </div>
      {sub && isSubmenu(items[sub.index]!) && (
        <MenuList
          items={(items[sub.index] as MenuSubmenu).submenu}
          at={sub.at}
          label={(items[sub.index] as MenuSubmenu).label}
          onClose={onClose}
          inSub
          onBack={() => {
            setSub(null);
            buttons.current[sub.index]?.focus();
          }}
        />
      )}
    </>
  );
}

/** A menu open at a point (`items` already built); closes by itself. */
export function ContextMenu(props: {
  items: MenuItem[];
  x: number;
  y: number;
  label?: string;
  onClose: () => void;
}) {
  const { onClose } = props;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: Event) => {
      if (root.current?.contains(e.target as Node)) return;
      onClose();
    };
    const scroll = (e: Event) => {
      if (root.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('touchstart', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('wheel', scroll, { passive: true, capture: true });
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', outside, true);
      window.removeEventListener('touchstart', outside, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('wheel', scroll, { capture: true });
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={root} className="ui-menu-layer">
      <MenuList
        items={props.items}
        at={{ x: props.x, y: props.y }}
        label={props.label}
        onClose={onClose}
      />
    </div>,
    document.body,
  );
}

/** The handlers `bind` gives an element (spread them on it, merged with its own). */
export interface ContextMenuHandlers {
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onTouchStart: (e: ReactTouchEvent<HTMLElement>) => void;
  onTouchMove: (e: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: ReactTouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * The menu of a list of elements: `bind(() => items, label)` on each element
 * (right click, Menu key / Shift+F10, long press); `node` once in the page.
 * The items are built when the menu opens (always up to date). An empty
 * list opens nothing (the browser's own menu is not shown either).
 */
export function useContextMenu() {
  const [open, setOpen] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
    label?: string;
  } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  /** The click that ends a long press must not also « open » the element. */
  const swallowClick = useRef(false);
  /** When a long press last opened the menu (Android then fires its own contextmenu). */
  const lastLongPress = useRef(0);
  const press = useRef<LongPress | null>(null);

  const show = useCallback((build: () => MenuItem[], x: number, y: number, label?: string) => {
    const items = cleanItems(build());
    if (!items.some(focusable)) return false;
    setOpen({ items, x, y, label });
    return true;
  }, []);

  const bind = useCallback(
    (build: () => MenuItem[], label?: string): ContextMenuHandlers => ({
      onContextMenu: (e) => {
        // Just opened by a long press (Android fires its own after): nothing more.
        if (Date.now() - lastLongPress.current < 800) {
          e.preventDefault();
          return;
        }
        if (show(build, e.clientX, e.clientY, label)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onKeyDown: (e) => {
        if (!isMenuKey(e)) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (show(build, r.left + 8, r.bottom - 4, label)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onTouchStart: (e) => {
        const t = e.touches[0];
        if (!t || e.touches.length > 1) return;
        press.current?.cancel();
        press.current = new LongPress((x, y) => {
          if (show(build, x, y, label)) {
            swallowClick.current = true;
            lastLongPress.current = Date.now();
          }
        });
        press.current.start(t.clientX, t.clientY);
      },
      onTouchMove: (e) => {
        const t = e.touches[0];
        if (t) press.current?.move(t.clientX, t.clientY);
      },
      onTouchEnd: (e) => {
        const fired = press.current?.fired;
        press.current?.cancel();
        // Opened: the finger's lift is not a tap.
        if (fired && swallowClick.current) e.preventDefault();
      },
      onTouchCancel: () => press.current?.cancel(),
      onClickCapture: (e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [show],
  );

  // A scroll of the page cancels a long press that started.
  useEffect(() => {
    const cancel = () => press.current?.cancel();
    window.addEventListener('scroll', cancel, true);
    return () => window.removeEventListener('scroll', cancel, true);
  }, []);

  const node: ReactNode = open ? (
    <ContextMenu items={open.items} x={open.x} y={open.y} label={open.label} onClose={close} />
  ) : null;
  /**
   * v0.44.0: opens the menu at a point (a button's own menu, under it): the
   * same menu, keyboard and rules as the right click.
   */
  const openAt = useCallback(
    (build: () => MenuItem[], x: number, y: number, label?: string) => {
      show(build, x, y, label);
    },
    [show],
  );
  return { bind, node, close, openAt, isOpen: open !== null };
}

/**
 * Two sets of handlers on one element (an element's own and the menu's):
 * each event calls both, the element's first.
 */
export function mergeHandlers<A extends object, B extends object>(a: A, b: B): A & B {
  const out = { ...a } as Record<string, unknown>;
  for (const [key, fn] of Object.entries(b)) {
    const mine = out[key];
    out[key] =
      typeof mine === 'function' && typeof fn === 'function'
        ? (...args: unknown[]) => {
            (mine as (...x: unknown[]) => void)(...args);
            (fn as (...x: unknown[]) => void)(...args);
          }
        : fn;
  }
  return out as A & B;
}
