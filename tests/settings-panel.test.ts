// A module's own panel in its section of Réglages (v0.37.0, MODULES.md §7.7):
// rendered in the module's context, found by the settings search through its
// label, nothing when the module has none or is absent. The shell knows no
// module: it only asks the present ones.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ModuleSettingsPanel,
  PresentModulesProvider,
  useModule,
  useSettingsPanelLabel,
  type FrontendModule,
  type PresentModule,
} from '@hub/sdk/frontend';

const present = (id: string, frontend: Partial<FrontendModule>): PresentModule => ({
  manifest: { id, name: id, version: '1', description: '', icon: 'x' } as never,
  frontend: frontend as FrontendModule,
});
const Panel: ComponentType = () => createElement('p', null, `sources @ ${useModule().manifest.id}`);
const Label = (props: { id: string }) =>
  createElement('i', null, useSettingsPanelLabel()(props.id) ?? 'none');
const render = (modules: PresentModule[], id: string) =>
  renderToStaticMarkup(
    createElement(PresentModulesProvider, {
      modules,
      children: [
        createElement(ModuleSettingsPanel, { key: 'panel', moduleId: id }),
        createElement(Label, { key: 'label', id }),
      ],
    }),
  );

describe('a module’s settings panel', () => {
  const modules = [
    present('todo', {}),
    present('agenda', { settingsPanel: { label: 'Sources', component: Panel } }),
  ];
  it('rendered in its module’s context, its label for the search', () => {
    expect(render(modules, 'agenda')).toBe('<p>sources @ agenda</p><i>Sources</i>');
  });
  it('none for a module without panel, or absent', () => {
    expect(render(modules, 'todo')).toBe('<i>none</i>');
    expect(render([], 'agenda')).toBe('<i>none</i>');
  });
});
