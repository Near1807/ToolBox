// v0.42.0 (Expérimental): the right-click (long press on the phone) menu of
// the Agenda's elements, through the SDK's shared menu (ADR 0048). Only
// actions that already exist in the sheet, each with its « Annuler »;
// « Supprimer » asks first. Another tool's element: « Ouvrir dans son
// outil » only. « Lancer le timer… » opens the sheet, where the Timer lends
// its button (the Agenda never calls the Timer itself).
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Button,
  type ContextMenuHandlers,
  errorMessage,
  type MenuItem,
  useContextMenu,
  useModule,
} from '@hub/sdk/frontend';
import type { AgendaEventDto, RangeDto, ToPlaceDto } from '../shared/types';
import type { CategoryDto } from '../shared/categories';
import { ColorChooser, NewCategoryForm } from './Categories';
import { categoryInfo, knownCategories, type Item } from './common';
import type { Undo } from './EventPanel';

/** What a menu is for: an element of the week / day, or a task « à caser ». */
export type MenuTarget = { kind: 'item'; item: Item } | { kind: 'task'; task: ToPlaceDto };
export type BindMenu = (target: MenuTarget) => ContextMenuHandlers;

export type Dialog =
  { kind: 'color'; category: string } | { kind: 'new-category'; event: AgendaEventDto };

export function useAgendaMenus(props: {
  data: RangeDto | null;
  /** The Timer is there (its button is lent in the sheet). */
  timer: boolean;
  onOpen: (item: Item) => void;
  onOpenTask: (task: ToPlaceDto) => void;
  /** After a write: its « Annuler » (the page's notice) and a new reading. */
  onChanged: (undo?: Undo) => void;
  /** A write refused: its message (the page's notice, nothing to undo). */
  onError: (message: string) => void;
}) {
  const module = useModule();
  const navigate = useNavigate();
  const menu = useContextMenu();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const api = module.api;

  const write = (task: () => Promise<unknown>, undo: Undo) => {
    task().then(
      () => props.onChanged(undo),
      (e: unknown) => props.onError(errorMessage(e)),
    );
  };

  /** « Nouvelle catégorie… »: created, then the event moves to it (« Annuler » puts it back). */
  const changeCategory = (e: AgendaEventDto, to: string) =>
    write(() => api.patch(`/events/${e.id}`, { category: to }), {
      message: `« ${e.title} » dans « ${to} »`,
      run: () =>
        api.patch(`/events/${e.id}`, {
          category: e.category,
          allDay: e.allDay,
          start: e.start,
          end: e.end,
        }),
    });

  const items = (target: MenuTarget) =>
    agendaMenuItems(target, {
      timer: props.timer,
      categories: knownCategories(),
      api,
      write,
      open: props.onOpen,
      openTask: props.onOpenTask,
      go: (url) => void navigate(url),
      dialog: setDialog,
    });

  const bind: BindMenu = (target) =>
    menu.bind(
      () => items(target),
      target.kind === 'task' ? target.task.title : target.item.event.title,
    );

  const node = (
    <>
      {menu.node}
      {dialog?.kind === 'color' && (
        <div className="ag-dialog" role="dialog" aria-label={`Couleur de « ${dialog.category} »`}>
          <strong>Couleur de « {dialog.category} »</strong>
          <p className="small muted">Elle change partout (semaine, jour, interrupteurs, aperçu).</p>
          <ColorChooser
            value={categoryInfo(dialog.category)?.color ?? null}
            css={categoryInfo(dialog.category)?.css ?? 'var(--accent)'}
            onChange={(value) => {
              const before = categoryInfo(dialog.category)?.color ?? null;
              const url = `/categories/${encodeURIComponent(dialog.category)}`;
              write(() => api.patch(url, { color: value }), {
                message: `Couleur de « ${dialog.category} » changée`,
                run: () => api.patch(url, { color: before }),
              });
              setDialog(null);
            }}
          />
          <div className="ui-actions">
            <Button small variant="secondary" onClick={() => setDialog(null)}>
              Fermer
            </Button>
          </div>
        </div>
      )}
      {dialog?.kind === 'new-category' && (
        <div className="ag-dialog" role="dialog" aria-label="Nouvelle catégorie">
          <strong>Nouvelle catégorie pour « {dialog.event.title} »</strong>
          <NewCategoryForm
            onCreated={(c) => {
              const e = dialog.event;
              setDialog(null);
              changeCategory(e, c.name);
            }}
            onCancel={() => setDialog(null)}
          />
        </div>
      )}
    </>
  );
  return { bind, node };
}

/** What the menu needs to act (the page gives it; the tests give stubs). */
export interface MenuDeps {
  /** The Timer is there (its button is lent in the sheet). */
  timer: boolean;
  /** Every category, in Thomas's order (« Changer de catégorie »). */
  categories: CategoryDto[];
  api: {
    put: (url: string, body?: unknown) => Promise<unknown>;
    patch: (url: string, body?: unknown) => Promise<unknown>;
    post: (url: string, body?: unknown) => Promise<unknown>;
    delete: (url: string) => Promise<unknown>;
  };
  /** One write, then its « Annuler ». */
  write: (task: () => Promise<unknown>, undo: Undo) => void;
  open: (item: Item) => void;
  openTask: (task: ToPlaceDto) => void;
  go: (url: string) => void;
  dialog: (d: Dialog) => void;
}

/**
 * The menu of an element: only the actions valid for it (pure; the tests
 * check every kind). An imported or own event, a deadline, an occurrence
 * of the week type, a planned task, a task « à caser », another tool's.
 */
export function agendaMenuItems(target: MenuTarget, d: MenuDeps): MenuItem[] {
  const doneItems = (
    title: string,
    done: boolean,
    url: string,
    body: (d: boolean) => unknown,
    method: 'put' | 'patch',
  ) =>
    ({
      label: done ? 'À refaire' : 'Faite',
      icon: done ? 'undo' : 'check',
      onSelect: () =>
        d.write(() => d.api[method](url, body(!done)), {
          message: done ? `« ${title} » à refaire` : `« ${title} » faite`,
          run: () => d.api[method](url, body(done)),
        }),
    }) satisfies MenuItem;

  const timerItem = (open: () => void, allowed: boolean | string = true): MenuItem => ({
    label: 'Lancer le timer…',
    icon: 'timer',
    disabled: !d.timer ? 'Le Timer n’est pas installé' : allowed === true ? false : allowed,
    onSelect: open,
  });

  const colorItem = (category: string): MenuItem => ({
    label: `Couleur de « ${category} »…`,
    icon: 'palette',
    onSelect: () => d.dialog({ kind: 'color', category }),
  });

  const changeCategory = (e: AgendaEventDto, to: string) =>
    d.write(() => d.api.patch(`/events/${e.id}`, { category: to }), {
      message: `« ${e.title} » dans « ${to} »`,
      run: () =>
        d.api.patch(`/events/${e.id}`, {
          category: e.category,
          allDay: e.allDay,
          start: e.start,
          end: e.end,
        }),
    });

  const categoryMenu = (e: AgendaEventDto): MenuItem => ({
    label: 'Changer de catégorie',
    icon: 'tag',
    submenu: [
      ...d.categories.map((c: CategoryDto): MenuItem => ({
        label: c.shape === 'deadline' ? `${c.name} (deadline)` : c.name,
        disabled: c.key === e.category.trim().toLowerCase() && 'Sa catégorie actuelle',
        onSelect: () => changeCategory(e, c.name),
      })),
      { separator: true },
      {
        label: 'Nouvelle catégorie…',
        icon: 'plus',
        onSelect: () => d.dialog({ kind: 'new-category', event: e }),
      },
    ],
  });

  return ((): MenuItem[] => {
    if (target.kind === 'task') {
      const t = target.task;
      return [
        { title: t.title },
        { label: 'Ouvrir la fiche', icon: 'file', onSelect: () => d.openTask(t) },
        doneItems(t.title, false, `/tasks/${t.id}/done`, (done) => ({ done }), 'put'),
        timerItem(() => d.openTask(t)),
      ];
    }
    const { item } = target;
    if (item.source === 'foreign')
      return [
        { title: item.event.title },
        {
          label: 'Ouvrir dans son outil',
          icon: 'external-link',
          onSelect: () => d.go(item.event.open),
        },
      ];
    const open: MenuItem = {
      label: 'Ouvrir la fiche',
      icon: 'file',
      shortcut: 'Entrée',
      onSelect: () => d.open(item),
    };
    if (item.source === 'task') {
      const t = item.event;
      return [
        { title: t.title },
        open,
        doneItems(t.title, t.done, `/tasks/${t.id}/done`, (done) => ({ done }), 'put'),
        timerItem(() => d.open(item)),
        { separator: true },
        colorItem(t.category),
      ];
    }
    const e = item.event;
    if (e.weekly)
      return [
        { title: e.title },
        open,
        timerItem(() => d.open(item), e.allDay ? 'Pas pour un élément sur la journée' : true),
        { separator: true },
        colorItem(e.category),
      ];
    const url = `/events/${e.id}`;
    return [
      { title: e.title },
      open,
      e.deadline
        ? doneItems(e.title, Boolean(e.done), url, (done) => ({ done }), 'patch')
        : {
            label: e.optional ? 'Obligatoire' : 'Facultatif',
            icon: 'sliders',
            onSelect: () =>
              d.write(() => d.api.patch(url, { optional: !e.optional }), {
                message: e.optional
                  ? `« ${e.title} » compte de nouveau`
                  : `« ${e.title} » facultatif : ne compte plus`,
                run: () => d.api.patch(url, { optional: Boolean(e.optional) }),
              }),
          },
      !e.deadline &&
        timerItem(() => d.open(item), e.allDay ? 'Pas pour un élément sur la journée' : true),
      { separator: true },
      categoryMenu(e),
      colorItem(e.category),
      { separator: true },
      {
        label: 'Supprimer',
        icon: 'trash',
        danger: true,
        confirm: `Supprimer « ${e.title} » de l’agenda ?`,
        onSelect: () =>
          d.write(() => d.api.delete(url), {
            message: `« ${e.title} » supprimé`,
            run: () => d.api.post(`${url}/restore`),
          }),
      },
    ].filter(Boolean) as MenuItem[];
  })();
}
