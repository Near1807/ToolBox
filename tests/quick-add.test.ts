// The « Ajouter » bar (v0.36.0, ADR 0046): the destinations the present
// modules declare (absent module = no destination), in their order. Each
// module tests its own preview (modules/*/tests/quick-add.test.ts).
import { describe, expect, it } from 'vitest';
import { quickAddDestinationsOf, type FrontendModule, type PresentModule } from '@hub/sdk/frontend';

const dest = (label: string, order: number): FrontendModule =>
  ({
    quickAdd: {
      label,
      icon: 'plus',
      order,
      placeholder: '',
      preview: () => ({ ok: true, text: label }),
      add: () => Promise.resolve({ message: label }),
    },
  }) as unknown as FrontendModule;
const present = (pairs: [string, FrontendModule][]): PresentModule[] =>
  pairs.map(([id, frontend]) => ({
    manifest: {
      id,
      name: id,
      version: '1',
      description: '',
      section: 'Outils',
      icon: 'x',
    } as never,
    frontend,
  }));
const todo = dest('Tâche', 1);
const agenda = dest('Rendez-vous', 2);
const ideas = dest('Idée', 3);
const timer = {} as FrontendModule;

describe('the « Ajouter » bar', () => {
  it('lists the destinations of the present modules, Tâche first; absent = absent', () => {
    const all = quickAddDestinationsOf(
      present([
        ['ideas', ideas],
        ['timer', timer],
        ['agenda', agenda],
        ['todo', todo],
      ]),
    );
    expect(all.map((d) => [d.moduleId, d.label])).toEqual([
      ['todo', 'Tâche'],
      ['agenda', 'Rendez-vous'],
      ['ideas', 'Idée'],
    ]);
    const noTodo = quickAddDestinationsOf(
      present([
        ['ideas', ideas],
        ['agenda', agenda],
      ]),
    );
    expect(noTodo.map((d) => d.label)).toEqual(['Rendez-vous', 'Idée']);
    expect(quickAddDestinationsOf(present([['timer', timer]]))).toEqual([]);
  });
});
