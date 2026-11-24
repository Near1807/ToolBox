// v0.47.0 (ADR 0059): files sent by Windows (« Ranger dans ToolBox »,
// « Envoyer vers ») — the launch's arguments, ten launches gathered into ONE
// batch, given to the one receiving module, the window shown on its route.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHost, createTestHub, type TestHub } from '@hub/sdk/testing';
import type { ModuleContext } from '@hub/sdk/core';
import { FileBatcher, pathsFromArgv } from '../backend/core/received-files';

const fake = (id: string, register: (ctx: ModuleContext) => void) => ({
  folder: id,
  manifest: { id, name: id, description: 'x', version: '1.0.0', section: 'Outils', icon: 'x' },
  backend: { register },
});

describe('arguments de lancement', () => {
  it('les chemins après --ranger, sans les options de Chromium', () => {
    expect(pathsFromArgv(['ToolBox.exe'])).toBeNull();
    expect(
      pathsFromArgv(['ToolBox.exe', '--allow-file-access', '--ranger', 'C:\\a b\\x.pdf']),
    ).toEqual(['C:\\a b\\x.pdf']);
    expect(pathsFromArgv(['ToolBox.exe', '--ranger', '"C:\\x.pdf"', 'C:\\y.md', '--flag'])).toEqual(
      ['C:\\x.pdf', 'C:\\y.md'],
    );
    // In development, Chromium may put the switches before the app's folder: left out.
    expect(
      pathsFromArgv(['electron', '--no-sandbox', '--ranger', '/app/', '/dl/x.pdf'], ['/app']),
    ).toEqual(['/dl/x.pdf']);
    // « Envoyer vers » with nothing: no path, nothing to do.
    expect(pathsFromArgv(['ToolBox.exe', '--ranger'])).toEqual([]);
  });
});

describe('regroupement', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('10 lancements rapprochés : un seul lot, sans doublon, dans l’ordre', () => {
    vi.useFakeTimers();
    const batches: string[][] = [];
    const b = new FileBatcher((p) => batches.push(p), 700);
    for (let i = 0; i < 10; i++) {
      b.add([`C:\\f${i}.pdf`]);
      vi.advanceTimersByTime(120);
    }
    b.add(['C:\\f3.pdf']);
    vi.advanceTimersByTime(699);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(batches).toEqual([Array.from({ length: 10 }, (_, i) => `C:\\f${i}.pdf`)]);
    // Later: another batch.
    b.add(['C:\\g.pdf']);
    vi.advanceTimersByTime(700);
    expect(batches).toHaveLength(2);
  });

  it('pendant le démarrage : gardé, puis donné une fois prêt', () => {
    vi.useFakeTimers();
    const batches: string[][] = [];
    const b = new FileBatcher((p) => batches.push(p), 700);
    b.hold();
    b.add(['C:\\a.pdf', 'C:\\b.pdf']);
    vi.advanceTimersByTime(5000);
    b.add(['C:\\c.pdf']);
    vi.advanceTimersByTime(5000);
    expect(batches).toEqual([]);
    b.release();
    expect(batches).toEqual([['C:\\a.pdf', 'C:\\b.pdf', 'C:\\c.pdf']]);
  });
});

describe('réception par un module', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
  });

  it('un seul module reçoit ; la fenêtre vient sur sa route ; chemins relatifs écartés', async () => {
    const shown: (string | undefined)[] = [];
    const got: string[][] = [];
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({ showWindow: (t) => void shown.push(t) }),
      modules: [
        fake('premier', (ctx) =>
          ctx.ui.receiveFiles((paths) => {
            got.push(paths);
            return '/m/premier/ranger/1';
          }),
        ),
        fake('second', (ctx) => ctx.ui.receiveFiles(() => '/m/second/x')),
      ],
    });
    const abs = process.platform === 'win32' ? 'C:\\x.pdf' : '/tmp/x.pdf';
    const route = await hub.hub.receiveFiles([abs, 'relatif.pdf']);
    expect(route).toBe('/m/premier/ranger/1');
    expect(got).toEqual([[abs]]);
    expect(shown).toEqual(['/m/premier/ranger/1']);
    expect(await hub.hub.receiveFiles(['relatif.pdf'])).toBeNull();
    expect(shown).toHaveLength(1);
  });

  it('sans module pour recevoir : la fenêtre seulement', async () => {
    const shown: (string | undefined)[] = [];
    hub = await createTestHub({
      loadExamples: false,
      host: createTestHost({ showWindow: (t) => void shown.push(t) }),
      modules: [],
    });
    expect(await hub.hub.receiveFiles([process.cwd()])).toBeNull();
    expect(shown).toEqual([undefined]);
  });

  it('clic droit de Windows : absent hors de l’app de bureau sous Windows', async () => {
    hub = await createTestHub({ loadExamples: false, modules: [] });
    expect((await hub.request('GET', '/api/core/shell-integration')).body).toEqual({
      available: false,
      menu: false,
      sendTo: false,
    });
    expect(
      (await hub.request('PUT', '/api/core/shell-integration', { enabled: true })).status,
    ).toBe(409);
  });
});
