// The empty Boîte à idées: on the PC it mentions the assistant (unchanged);
// on the phone, where there is no assistant, it does not.
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { httpTransport, ModuleProvider, setApiTransport } from '@hub/sdk/frontend';
import { WorkerClient, workerTransport } from '@hub/sdk/testing';
import manifest from '../module.json';
import ideas from '../frontend/index';

// The page reads its data with useApi (not run by a static render): the hint is
// the one of the empty list, shown while there is no idea.
const page = () =>
  renderToStaticMarkup(
    createElement(MemoryRouter, {
      children: createElement(ModuleProvider, {
        manifest: manifest as never,
        children: createElement(ideas.pages![0]!.component),
      }),
    }),
  );

describe('Boîte à idées, empty list hint', () => {
  afterEach(() => setApiTransport(httpTransport));
  it('the source keeps the PC sentence and the phone one apart', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../frontend/index.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(
      /onPhone\(\)\s*\? 'Note la première ci-dessus\.'\s*: 'Note la première ci-dessus, ou dis « idée : … » à l’assistant\.'/,
    );
    // Both render without error on each side.
    expect(() => page()).not.toThrow();
    setApiTransport(
      workerTransport(new WorkerClient({ postMessage: () => {}, addEventListener: () => {} })),
    );
    expect(() => page()).not.toThrow();
  });
});
