// Lent components (ADR 0046): a module renders another module's component
// only through the contract (`provides` + <Lent>); absent lender = the
// fallback (nothing by default), and the borrower can hide its button.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Lent,
  PresentModulesProvider,
  useLentAvailable,
  useModule,
  type FrontendModule,
  type PresentModule,
} from '@hub/sdk/frontend';

const lender = (id: string, provides: Record<string, ComponentType<never>>): PresentModule => ({
  manifest: { id, name: id, version: '1', description: '', icon: 'x' } as never,
  frontend: { provides } as unknown as FrontendModule,
});
// The lent component shows in which module's context it runs.
const Sheet = ((props: { title: string }) =>
  createElement('p', null, `${props.title} @ ${useModule().manifest.id}`)) as ComponentType<never>;
const Probe = () => createElement('i', null, useLentAvailable('todo.sheet') ? 'yes' : 'no');
const render = (modules: PresentModule[]) =>
  renderToStaticMarkup(
    createElement(PresentModulesProvider, {
      modules,
      children: [
        createElement(Lent<{ title: string }>, {
          key: 'lent',
          name: 'todo.sheet',
          props: { title: 'Réviser' },
          fallback: createElement('b', null, 'absent'),
        }),
        createElement(Probe, { key: 'probe' }),
      ],
    }),
  );

describe('lent components', () => {
  it('renders the lender’s component in the lender’s context', () => {
    expect(render([lender('agenda', {}), lender('todo', { 'todo.sheet': Sheet })])).toBe(
      '<p>Réviser @ todo</p><i>yes</i>',
    );
  });
  it('absent lender: the fallback, and the button can hide', () => {
    expect(render([lender('agenda', {})])).toBe('<b>absent</b><i>no</i>');
    expect(render([])).toBe('<b>absent</b><i>no</i>');
  });
});
