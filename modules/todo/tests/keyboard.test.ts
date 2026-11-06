// The « Nouvelle tâche » field: on the PC it takes the focus on arrival
// (unchanged); in the phone app it does not (no keyboard over the list).
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { httpTransport, ModuleProvider, onPhone, setApiTransport } from '@hub/sdk/frontend';
import { WorkerClient, workerTransport } from '@hub/sdk/testing';
import manifest from '../module.json';
import { QuickAdd } from '../frontend/index';

const field = () => {
  const quickAdd = createElement(QuickAdd, {
    data: { today: '2026-11-05', tasks: [], tags: [], library: false, tracks: [], timer: false },
    onAdded: () => {},
  });
  const html = renderToStaticMarkup(
    createElement(ModuleProvider, { manifest: manifest as never, children: quickAdd }),
  );
  return html.match(/<input[^>]*aria-label="Nouvelle tâche"[^>]*>/)![0];
};

describe('To-do keyboard on arrival', () => {
  afterEach(() => setApiTransport(httpTransport));

  it('PC: the field takes the focus (unchanged)', () => {
    expect(onPhone()).toBe(false);
    expect(field()).toContain('autofocus');
  });

  it('phone app: no focus, so no keyboard', () => {
    const port = { postMessage: () => {}, addEventListener: () => {} };
    setApiTransport(workerTransport(new WorkerClient(port)));
    expect(onPhone()).toBe(true);
    expect(field()).not.toContain('autofocus');
  });
});
