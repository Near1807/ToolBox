// v0.42.0: the shared context menu (packages/sdk/context-menu.tsx, ADR 0048):
// the keyboard (arrows, Enter, Échap, Home / End, submenu), a disabled
// action never runs, a dangerous one asks first, the ways of opening it
// (Menu key / Shift+F10, long press), where it goes, and a clean list.
// The right click and the real menu are measured in the app (report v0.42.0).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanItems,
  isMenuKey,
  LongPress,
  LONG_PRESS_MS,
  type MenuItem,
  menuKey,
  mergeHandlers,
  nextIndex,
  placeMenu,
  runItem,
} from '../packages/sdk/context-menu';

const ran: string[] = [];
const action = (label: string, extra: Partial<Extract<MenuItem, { onSelect: unknown }>> = {}) =>
  ({ label, onSelect: () => ran.push(label), ...extra }) as MenuItem;

const items: MenuItem[] = [
  { title: 'Cours' },
  action('Ouvrir la fiche'),
  action('Faite', { disabled: 'Déjà faite' }),
  { separator: true },
  { label: 'Changer de catégorie', submenu: [action('Cours'), action('Examens')] },
  {
    label: 'Supprimer',
    danger: true,
    confirm: 'Supprimer « Cours » ?',
    onSelect: () => ran.push('Supprimer'),
  },
];

afterEach(() => {
  ran.length = 0;
  vi.useRealTimers();
});

describe('the keyboard in a menu', () => {
  it('arrows skip titles and separators, wrap around; Home / End', () => {
    expect(nextIndex(items, -1, 1)).toBe(1);
    expect(nextIndex(items, 1, 1)).toBe(2); // disabled: focusable (its reason is read)
    expect(nextIndex(items, 2, 1)).toBe(4);
    expect(nextIndex(items, 5, 1)).toBe(1); // wraps
    expect(nextIndex(items, 1, -1)).toBe(5);
    expect(menuKey('Home', items, 4)).toEqual({ kind: 'focus', index: 1 });
    expect(menuKey('End', items, 1)).toEqual({ kind: 'focus', index: 5 });
    expect(menuKey('ArrowDown', items, -1)).toEqual({ kind: 'focus', index: 1 });
  });
  it('Enter / Space choose; on a submenu, open it (→ too); ← and Échap go back; Échap closes', () => {
    expect(menuKey('Enter', items, 1)).toEqual({ kind: 'select', index: 1 });
    expect(menuKey(' ', items, 1)).toEqual({ kind: 'select', index: 1 });
    expect(menuKey('Enter', items, 4)).toEqual({ kind: 'open-sub', index: 4 });
    expect(menuKey('ArrowRight', items, 4)).toEqual({ kind: 'open-sub', index: 4 });
    expect(menuKey('ArrowRight', items, 1)).toEqual({ kind: 'none' });
    expect(menuKey('ArrowLeft', items, 0, true)).toEqual({ kind: 'close-sub' });
    expect(menuKey('Escape', items, 0, true)).toEqual({ kind: 'close-sub' });
    expect(menuKey('Escape', items, 1)).toEqual({ kind: 'close' });
    expect(menuKey('Tab', items, 1)).toEqual({ kind: 'close' });
    expect(menuKey('a', items, 1)).toEqual({ kind: 'none' });
  });
});

describe('choosing', () => {
  it('a disabled action never runs, nor a submenu’s label', () => {
    expect(runItem(items[2]!)).toBe(false);
    expect(runItem(items[4]!)).toBe(false);
    expect(runItem(items[0]!)).toBe(false);
    expect(ran).toEqual([]);
    expect(runItem(items[1]!)).toBe(true);
    expect(ran).toEqual(['Ouvrir la fiche']);
  });
  it('a dangerous action asks its question: « Annuler » = nothing done, OK = done', () => {
    const asked: string[] = [];
    expect(runItem(items[5]!, (q) => (asked.push(q), false))).toBe(false);
    expect(ran).toEqual([]);
    expect(runItem(items[5]!, (q) => (asked.push(q), true))).toBe(true);
    expect(ran).toEqual(['Supprimer']);
    expect(asked).toEqual(['Supprimer « Cours » ?', 'Supprimer « Cours » ?']);
  });
});

describe('opening it', () => {
  it('the keyboard: the Menu key, or Shift+F10 (not F10 alone)', () => {
    expect(isMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    expect(isMenuKey({ key: 'F10', shiftKey: true })).toBe(true);
    expect(isMenuKey({ key: 'F10', shiftKey: false })).toBe(false);
    expect(isMenuKey({ key: 'Enter', shiftKey: true })).toBe(false);
  });
  it('a long press: after 500 ms still; a move of more than 10 px (scroll, drag) cancels it', () => {
    vi.useFakeTimers();
    const fired: [number, number][] = [];
    const press = new LongPress((x, y) => fired.push([x, y]));
    press.start(100, 200);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(fired).toEqual([]);
    press.move(104, 206); // a finger's tremble: still a press
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([[100, 200]]);
    expect(press.fired).toBe(true);
    // A scroll: the finger moves → nothing.
    press.start(100, 200);
    press.move(100, 230);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(fired).toHaveLength(1);
    expect(press.fired).toBe(false);
    // Lifted before: nothing.
    press.start(10, 10);
    vi.advanceTimersByTime(300);
    press.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toHaveLength(1);
  });
});

describe('where it goes, what it lists', () => {
  const view = { width: 1280, height: 800 };
  const size = { width: 220, height: 300 };
  it('at the point; flipped left / up at the window’s edges; never outside', () => {
    expect(placeMenu({ x: 100, y: 100 }, size, view)).toEqual({ left: 100, top: 100 });
    expect(placeMenu({ x: 1200, y: 100 }, size, view)).toEqual({ left: 980, top: 100 });
    expect(placeMenu({ x: 100, y: 700 }, size, view)).toEqual({ left: 100, top: 400 });
    // A tiny window (the phone, 412 px): inside, 8 px from the edges.
    const p = placeMenu(
      { x: 400, y: 20 },
      { width: 300, height: 900 },
      { width: 412, height: 915 },
    );
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 300).toBeLessThanOrEqual(412 - 8);
    expect(p.top).toBe(8);
  });
  it('no separator twice, first or last; nothing for nulls; an empty list stays empty', () => {
    const list = cleanItems([
      { separator: true },
      action('A'),
      null,
      { separator: true },
      false,
      { separator: true },
      action('B'),
      { separator: true },
      { title: 'Rien après' },
    ]);
    expect(list.map((i) => ('label' in i ? i.label : 'separator' in i ? '—' : 'title'))).toEqual([
      'A',
      '—',
      'B',
    ]);
    expect(cleanItems([{ title: 'Seul' }, { separator: true }])).toEqual([]);
  });
  it('an element’s own handlers and the menu’s both run, its own first', () => {
    const calls: string[] = [];
    const merged = mergeHandlers(
      { onKeyDown: () => calls.push('own'), onClick: () => calls.push('click') },
      { onKeyDown: () => calls.push('menu'), onContextMenu: () => calls.push('ctx') },
    );
    merged.onKeyDown();
    merged.onClick();
    merged.onContextMenu();
    expect(calls).toEqual(['own', 'menu', 'click', 'ctx']);
  });
});
