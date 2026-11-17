// v0.42.0: the Agenda's right-click / long-press menus: only the actions
// valid for each element, each one writing ONE change with its « Annuler »;
// « Supprimer » asks first; another tool's element: « Ouvrir dans son outil ».
import { describe, expect, it } from 'vitest';
import { cleanItems, type MenuItem, runItem } from '@hub/sdk/frontend';
import { agendaMenuItems, type Dialog, type MenuDeps, type MenuTarget } from '../frontend/Menus';
import type { CategoryDto } from '../shared/categories';
import type { AgendaEventDto, ForeignEventDto, PlannedTaskDto, ToPlaceDto } from '../shared/types';

const event = (extra: Partial<AgendaEventDto> = {}): AgendaEventDto => ({
  id: 'e1',
  title: 'Thermo',
  start: '2026-11-18T08:15',
  end: '2026-11-18T10:00',
  allDay: false,
  location: '2E44',
  note: null,
  category: 'Cours',
  weekly: null,
  timerPref: null,
  ...extra,
});

function deps(timer = true) {
  const calls: string[] = [];
  const undos: string[] = [];
  const opened: string[] = [];
  const dialogs: Dialog[] = [];
  const api = Object.fromEntries(
    (['put', 'patch', 'post', 'delete'] as const).map((m) => [
      m,
      (url: string, body?: unknown) => {
        calls.push(
          `${m.toUpperCase()} ${url}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`,
        );
        return Promise.resolve();
      },
    ]),
  ) as MenuDeps['api'];
  const d: MenuDeps = {
    timer,
    categories: [
      { key: 'cours', name: 'Cours', shape: 'normal' },
      { key: 'deadline', name: 'Deadline', shape: 'deadline' },
      { key: 'soirée', name: 'Soirée', shape: 'normal' },
    ] as CategoryDto[],
    api,
    write: (task, undo) => {
      void task();
      undos.push(undo.message);
      void undo.run();
    },
    open: (i) => opened.push(`fiche ${i.event.title}`),
    openTask: (t) => opened.push(`tâche ${t.title}`),
    go: (url) => opened.push(`aller ${url}`),
    dialog: (x) => dialogs.push(x),
  };
  return { d, calls, undos, opened, dialogs };
}

const labels = (items: MenuItem[]) =>
  cleanItems(items).map((i) =>
    'label' in i
      ? `${i.label}${'disabled' in i && i.disabled ? ` (${i.disabled === true ? 'off' : i.disabled})` : ''}${'submenu' in i ? ' ›' : ''}`
      : 'separator' in i
        ? '—'
        : `[${i.title}]`,
  );
const pick = (items: MenuItem[], label: string) =>
  items.find((i) => 'label' in i && i.label === label) as MenuItem;

describe('the menu of each element', () => {
  it('an event: open, facultatif, timer, category, colour, delete', () => {
    const { d } = deps();
    expect(
      labels(agendaMenuItems({ kind: 'item', item: { source: 'own', event: event() } }, d)),
    ).toEqual([
      '[Thermo]',
      'Ouvrir la fiche',
      'Facultatif',
      'Lancer le timer…',
      '—',
      'Changer de catégorie ›',
      'Couleur de « Cours »…',
      '—',
      'Supprimer',
    ]);
    // Facultatif → Obligatoire when it is.
    const optional = agendaMenuItems(
      { kind: 'item', item: { source: 'own', event: event({ optional: true }) } },
      d,
    );
    expect(labels(optional)).toContain('Obligatoire');
  });
  it('a deadline: « Faite » / « À refaire », no timer, no facultatif', () => {
    const { d } = deps();
    const items = agendaMenuItems(
      {
        kind: 'item',
        item: {
          source: 'own',
          event: event({ category: 'Deadline', deadline: true, end: '2026-11-18T08:15' }),
        },
      },
      d,
    );
    expect(labels(items)).toEqual([
      '[Thermo]',
      'Ouvrir la fiche',
      'Faite',
      '—',
      'Changer de catégorie ›',
      'Couleur de « Deadline »…',
      '—',
      'Supprimer',
    ]);
    const done = agendaMenuItems(
      { kind: 'item', item: { source: 'own', event: event({ deadline: true, done: true }) } },
      d,
    );
    expect(labels(done)).toContain('À refaire');
  });
  it('an occurrence of the week type: open, timer, colour (no delete, no category)', () => {
    const { d } = deps();
    const items = agendaMenuItems(
      {
        kind: 'item',
        item: {
          source: 'own',
          event: event({ weekly: { id: 'w1', date: '2026-11-18', moved: false } }),
        },
      },
      d,
    );
    expect(labels(items)).toEqual([
      '[Thermo]',
      'Ouvrir la fiche',
      'Lancer le timer…',
      '—',
      'Couleur de « Cours »…',
    ]);
  });
  it('a planned task, a task « à caser »: done / to redo, timer', () => {
    const { d } = deps();
    const task: PlannedTaskDto = {
      id: 't1',
      title: 'Labo',
      start: '2026-11-18T14:00',
      end: '2026-11-18T15:00',
      allDay: false,
      category: 'Tâches',
      done: true,
      due: null,
      afterDue: false,
      open: '/m/todo',
    };
    expect(
      labels(agendaMenuItems({ kind: 'item', item: { source: 'task', event: task } }, d)),
    ).toEqual([
      '[Labo]',
      'Ouvrir la fiche',
      'À refaire',
      'Lancer le timer…',
      '—',
      'Couleur de « Tâches »…',
    ]);
    const toPlace: ToPlaceDto = {
      id: 't2',
      title: 'Rapport',
      due: null,
      estimateMin: 60,
      open: '/m/todo',
      late: false,
    };
    expect(labels(agendaMenuItems({ kind: 'task', task: toPlace }, d))).toEqual([
      '[Rapport]',
      'Ouvrir la fiche',
      'Faite',
      'Lancer le timer…',
    ]);
  });
  it('another tool’s element: « Ouvrir dans son outil » only', () => {
    const { d, opened } = deps();
    const foreign: ForeignEventDto = {
      id: 'sport:1',
      moduleId: 'sport',
      title: 'Course',
      start: '2026-11-18T07:00',
      end: '2026-11-18T08:00',
      allDay: false,
      category: 'Sport',
      open: '/m/sport',
      status: null,
    };
    const items = agendaMenuItems({ kind: 'item', item: { source: 'foreign', event: foreign } }, d);
    expect(labels(items)).toEqual(['[Course]', 'Ouvrir dans son outil']);
    runItem(pick(items, 'Ouvrir dans son outil'));
    expect(opened).toEqual(['aller /m/sport']);
  });
  it('without the Timer: « Lancer le timer… » disabled, with its reason', () => {
    const { d } = deps(false);
    const items = agendaMenuItems({ kind: 'item', item: { source: 'own', event: event() } }, d);
    expect(labels(items)).toContain('Lancer le timer… (Le Timer n’est pas installé)');
    expect(runItem(pick(items, 'Lancer le timer…'))).toBe(false);
  });
});

describe('what each action writes, and its « Annuler »', () => {
  const target = (e: AgendaEventDto): MenuTarget => ({
    kind: 'item',
    item: { source: 'own', event: e },
  });
  it('Facultatif: one PATCH, Annuler writes it back', () => {
    const { d, calls, undos } = deps();
    runItem(pick(agendaMenuItems(target(event()), d), 'Facultatif'));
    expect(calls).toEqual([
      'PATCH /events/e1 {"optional":true}',
      'PATCH /events/e1 {"optional":false}',
    ]);
    expect(undos).toEqual(['« Thermo » facultatif : ne compte plus']);
  });
  it('Faite (a task): PUT done, Annuler: not done', () => {
    const { d, calls } = deps();
    const t: ToPlaceDto = {
      id: 't2',
      title: 'Rapport',
      due: null,
      estimateMin: null,
      open: '',
      late: false,
    };
    runItem(pick(agendaMenuItems({ kind: 'task', task: t }, d), 'Faite'));
    expect(calls).toEqual([
      'PUT /tasks/t2/done {"done":true}',
      'PUT /tasks/t2/done {"done":false}',
    ]);
  });
  it('Changer de catégorie: the current one disabled; another: PATCH, Annuler puts it back', () => {
    const { d, calls, dialogs } = deps();
    const sub = pick(agendaMenuItems(target(event()), d), 'Changer de catégorie') as Extract<
      MenuItem,
      { submenu: MenuItem[] }
    >;
    expect(labels(sub.submenu)).toEqual([
      'Cours (Sa catégorie actuelle)',
      'Deadline (deadline)',
      'Soirée',
      '—',
      'Nouvelle catégorie…',
    ]);
    runItem(pick(sub.submenu, 'Soirée'));
    expect(calls[0]).toBe('PATCH /events/e1 {"category":"Soirée"}');
    expect(calls[1]).toContain('"category":"Cours"');
    runItem(pick(sub.submenu, 'Nouvelle catégorie…'));
    expect(dialogs[0]).toMatchObject({ kind: 'new-category' });
  });
  it('Supprimer: asks first; « Annuler » of the question = nothing; then DELETE, Annuler = restore', () => {
    const { d, calls } = deps();
    const del = pick(agendaMenuItems(target(event()), d), 'Supprimer');
    expect(runItem(del, () => false)).toBe(false);
    expect(calls).toEqual([]);
    expect(runItem(del, () => true)).toBe(true);
    expect(calls).toEqual(['DELETE /events/e1', 'POST /events/e1/restore']);
  });
  it('Couleur de cette catégorie…: opens its dialog (nothing written yet)', () => {
    const { d, calls, dialogs } = deps();
    runItem(pick(agendaMenuItems(target(event()), d), 'Couleur de « Cours »…'));
    expect(dialogs).toEqual([{ kind: 'color', category: 'Cours' }]);
    expect(calls).toEqual([]);
  });
});
