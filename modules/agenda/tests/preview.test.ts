// The preview on hover (v0.41.0, PC): what the card says for each kind of
// item, and where it goes (next to the block, inside the window). The
// behaviour (delay, Échap, scroll, never during a drag, keyboard) is
// measured in Electron (report).
import { describe, expect, it } from 'vitest';
import type { Item } from '../frontend/common';
import { placeCard, PREVIEW_DELAY_MS, previewOf, previewText } from '../frontend/Preview';
import type { ToPlaceDto } from '../shared/types';

const TODAY = '2026-11-17';
const own = (extra: Record<string, unknown> = {}): Item =>
  ({
    source: 'own',
    event: {
      id: 'e1',
      title: 'Computer Network Lab',
      start: '2026-11-18T10:30',
      end: '2026-11-18T12:30',
      allDay: false,
      location: '2F51;2E51;2E44',
      note: 'Groupe : 4MIN-7b · Enseignants : LMT',
      category: 'Cours',
      weekly: null,
      timerPref: null,
      ...extra,
    },
  }) as Item;

describe('the preview card', () => {
  it('an imported course: full title, day and time with the length, full place, note, code, source', () => {
    const c = previewOf(
      {
        kind: 'item',
        movable: true,
        item: own({
          optional: true,
          source: {
            id: 's1',
            name: 'Horaire ECAM',
            original: {
              SUMMARY: '®-RE4L-L2-4MEO-4MIN',
              DESCRIPTION: 'Act:Computer Network Lab\nGroupe:4MIN-7b\nEns:LMT',
            },
          },
        }),
      },
      TODAY,
    );
    expect(c).toEqual({
      title: 'Computer Network Lab',
      when: 'mer. 18 nov. 10:30–12:30 · 2 h',
      place: '2F51, 2E51, 2E44',
      category: 'Cours',
      note: 'Groupe : 4MIN-7b · Enseignants : LMT',
      facts: [
        'Facultatif : ne compte ni dans les conflits ni dans la charge',
        'Code : RE4L-L2-4MEO-4MIN',
        'Importé de « Horaire ECAM »',
      ],
      hint: 'Glisser pour déplacer · tirer le bas pour la durée · clic : la fiche',
    });
    // The aria-label: everything, in one sentence.
    expect(previewText(c)).toContain('Code : RE4L-L2-4MEO-4MIN');
    expect(previewText(c)).toContain('2F51, 2E51, 2E44');
  });

  it('a planned task: done or not, its due date, after its due date; overlapping', () => {
    const task = {
      source: 'task',
      event: {
        id: 't1',
        title: 'Rendre le rapport',
        start: '2026-11-19T09:00',
        end: '2026-11-19T09:45',
        allDay: false,
        category: 'Tâches',
        done: false,
        due: '2026-11-18',
        afterDue: true,
        open: '/m/todo',
      },
    } as Item;
    const c = previewOf({ kind: 'item', item: task, overlaps: true }, TODAY);
    expect(c.when).toBe('jeu. 19 nov. 09:00–09:45 · 45 min');
    expect(c.facts).toEqual([
      'À faire',
      'Échéance : mer. 18 nov.',
      'Prévue après son échéance',
      'Tâche de la To-do',
      'Chevauche un autre élément',
    ]);
    const done = { ...task, event: { ...task.event, done: true } } as Item;
    expect(previewOf({ kind: 'item', item: done }, TODAY).facts).toEqual([
      'Faite',
      'Échéance : mer. 18 nov.',
      'Tâche de la To-do',
    ]);
  });

  it('another tool’s item: its tool and its status; read only', () => {
    const sport = {
      source: 'foreign',
      event: {
        id: 'sport:1',
        moduleId: 'sport',
        title: 'Course à pied',
        start: '2026-11-20T18:00',
        end: '2026-11-20T19:00',
        allDay: false,
        category: 'Sport',
        open: '/m/sport',
        status: 'fait',
      },
    } as Item;
    const c = previewOf({ kind: 'item', item: sport }, TODAY, (id) =>
      id === 'sport' ? 'Sport' : null,
    );
    expect(c.facts).toEqual(['Vient de Sport', 'fait']);
    expect(c.hint).toBe('Se modifie dans son outil (clic pour l’ouvrir)');
    expect(c.place).toBeNull();
  });

  it('a task « à caser »: its due date (late), its estimate', () => {
    const t: ToPlaceDto = {
      id: 't2',
      title: 'Rendre le rapport de labo',
      due: '2026-11-16',
      estimateMin: 90,
      open: '/m/todo',
      late: true,
    };
    const c = previewOf({ kind: 'task', task: t, draggable: true }, TODAY);
    expect(c.when).toBe('À faire pour lun. 16 nov. (en retard)');
    expect(c.facts[0]).toBe('Durée estimée : ~1 h 30');
    expect(
      previewOf({ kind: 'task', task: { ...t, due: null, estimateMin: null } }, TODAY),
    ).toMatchObject({
      when: 'Sans échéance',
      facts: ['Sans durée estimée', 'À caser : pas encore prévue à une heure'],
    });
  });

  it('an all-day item; a place of one room', () => {
    const c = previewOf(
      {
        kind: 'item',
        item: own({ allDay: true, start: '2026-11-21', end: '2026-11-22', location: '1B12' }),
      },
      TODAY,
    );
    expect(c.when).toBe('sam. 21 nov. → dim. 22 nov.');
    expect(c.place).toBe('1B12');
  });

  it('where it goes: right of the block, left at the right edge, up at the bottom, always inside', () => {
    const view = { width: 1280, height: 900 };
    const card = { width: 300, height: 160 };
    expect(placeCard({ left: 400, right: 520, top: 200, bottom: 260 }, card, view)).toEqual({
      left: 528,
      top: 200,
    });
    expect(placeCard({ left: 1100, right: 1220, top: 200, bottom: 260 }, card, view)).toEqual({
      left: 792,
      top: 200,
    });
    expect(placeCard({ left: 400, right: 520, top: 850, bottom: 890 }, card, view)).toEqual({
      left: 528,
      top: 732,
    });
    // A window narrower than block + card on both sides: kept inside.
    const p = placeCard({ left: 100, right: 300, top: 10, bottom: 50 }, card, {
      width: 420,
      height: 300,
    });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + card.width).toBeLessThanOrEqual(412);
    expect(PREVIEW_DELAY_MS).toBe(400);
  });
});
