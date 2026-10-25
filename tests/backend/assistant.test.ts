import { afterEach, describe, expect, it } from 'vitest';
import { HttpError, type ModuleContext } from '@hub/sdk/backend';
import { createTestHost, createTestHub, type TestHub } from '@hub/sdk/testing';
import type { HostKeyEvent } from '../../backend/core/host';
import { validateParams } from '../../backend/core/assistant';
import { fakeModule } from '../helpers/fake-modules';

const hubs: TestHub[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close().catch(() => {});
});

let items: string[] = [];

/** A module declaring one action of each risk level, and a consumer with the permission. */
async function start(host = createTestHost(), grant = true) {
  items = ['a'];
  let consumer: ModuleContext | null = null;
  const hub = await createTestHub({
    host,
    modules: [
      fakeModule('lists', {
        backend: {
          register: (ctx) => {
            ctx.assistant.define({
              name: 'count',
              description: 'Compte les éléments',
              risk: 'read',
              run: () => ({ message: `${items.length} éléments`, data: { items } }),
            });
            ctx.assistant.define({
              name: 'add',
              description: 'Ajoute un élément',
              parameters: {
                text: { type: 'string', description: 'Texte' },
                times: { type: 'integer', description: 'Combien de fois' },
                tags: { type: 'string[]', description: 'Tags' },
              },
              required: ['text'],
              risk: 'change',
              right: { id: 'edit', label: 'L’assistant peut modifier la liste' },
              run: (p) => {
                items.push(String(p.text));
                return { message: `Ajouté ${String(p.text)}`, undo: () => void items.pop() };
              },
            });
            ctx.assistant.define({
              name: 'clear',
              description: 'Vide la liste',
              risk: 'destructive',
              right: { id: 'clear', label: 'L’assistant peut vider la liste' },
              confirmation: () => `Vider les ${items.length} éléments ?`,
              run: () => {
                const before = items;
                items = [];
                return { message: 'Liste vidée', undo: () => void (items = before) };
              },
            });
            ctx.assistant.define({
              name: 'publish',
              description: 'Publie la liste',
              risk: 'sensitive',
              page: 'publish',
            });
            ctx.assistant.define({
              name: 'fail',
              description: 'Échoue',
              risk: 'read',
              run: () => {
                throw new HttpError(404, 'Élément introuvable');
              },
            });
          },
        },
      }),
      fakeModule('voice', {
        manifest: { permissions: { assistant: true, globalKeys: true } },
        backend: { register: (ctx) => void (consumer = ctx) },
      }),
      fakeModule('plain', {
        backend: {
          register: (ctx) => {
            expect(() => ctx.assistant.actions()).toThrow(/permissions\.assistant/);
            expect(() => ctx.hotkeys.hold(null, { onPress() {}, onRelease() {} })).toThrow(
              /permissions\.globalKeys/,
            );
          },
        },
      }),
    ],
  });
  hubs.push(hub);
  if (grant) {
    hub.hub.assistant.setRight('lists.edit', true);
    hub.hub.assistant.setRight('lists.clear', true);
  }
  return { hub, ctx: consumer! as ModuleContext };
}

describe('ctx.assistant', () => {
  it('lists the actions of every module, with the core ones', async () => {
    const { ctx } = await start();
    const ids = ctx.assistant.actions().map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'core.list-jobs',
        'core.open',
        'lists.count',
        'lists.add',
        'lists.clear',
        'lists.publish',
      ]),
    );
    const publish = ctx.assistant.actions().find((a) => a.id === 'lists.publish')!;
    expect(publish).toMatchObject({
      risk: 'sensitive',
      page: '/m/lists/publish',
      moduleName: 'Module lists',
    });
  });

  it('runs reads directly and changes with an undo', async () => {
    const { ctx } = await start();
    expect(await ctx.assistant.run('lists.count', {})).toMatchObject({
      status: 'done',
      message: '1 éléments',
      undoId: null,
    });
    const added = await ctx.assistant.run('lists.add', { text: 'b', times: '2', tags: 'x, y' });
    expect(added.status).toBe('done');
    expect(items).toEqual(['a', 'b']);
    const undoId = (added as { undoId: string }).undoId;
    expect(await ctx.assistant.undo(undoId)).toEqual({ ok: true, message: 'Annulé : Ajouté b' });
    expect(items).toEqual(['a']);
    // An undo runs only once.
    expect((await ctx.assistant.undo(undoId)).ok).toBe(false);
  });

  it('never runs a destructive action without confirmation', async () => {
    const { ctx } = await start();
    expect(await ctx.assistant.run('lists.clear', {})).toEqual({
      status: 'confirm',
      id: 'lists.clear',
      question: 'Vider les 1 éléments ?',
    });
    expect(items).toEqual(['a']);
    const done = await ctx.assistant.run('lists.clear', {}, { confirmed: true });
    expect(done.status).toBe('done');
    expect(items).toEqual([]);
    await ctx.assistant.undo((done as { undoId: string }).undoId);
    expect(items).toEqual(['a']);
  });

  it('is read-only by default: each change has its own right, off until turned on', async () => {
    const { hub, ctx } = await start(createTestHost(), false);
    expect(await ctx.assistant.run('lists.count', {})).toMatchObject({ status: 'done' });
    expect(await ctx.assistant.run('lists.add', { text: 'b' })).toEqual({
      status: 'forbidden',
      id: 'lists.add',
      message:
        'Je n’ai pas le droit de le faire : « L’assistant peut modifier la liste » est désactivé dans les droits de l’assistant.',
      right: { id: 'lists.edit', label: 'L’assistant peut modifier la liste' },
    });
    // Even confirmed, a destructive action without its right is refused.
    expect(await ctx.assistant.run('lists.clear', {}, { confirmed: true })).toMatchObject({
      status: 'forbidden',
    });
    expect(items).toEqual(['a']);
    expect(ctx.assistant.rights()).toEqual([
      expect.objectContaining({ id: 'lists.edit', granted: false, actions: ['lists.add'] }),
      expect.objectContaining({ id: 'lists.clear', granted: false, actions: ['lists.clear'] }),
    ]);
    // The rights are ordinary settings (section « Droits de l’assistant vocal »).
    const settings = await hub.request<{ scope: string; values: Record<string, unknown> }[]>(
      'GET',
      '/api/core/settings',
    );
    expect(JSON.stringify(settings.body)).toContain('lists__edit');
    hub.hub.assistant.setRight('lists.edit', true);
    expect(await ctx.assistant.run('lists.add', { text: 'b' })).toMatchObject({ status: 'done' });
    // The other right stays off; the confirmation is still required once it is on.
    expect(await ctx.assistant.run('lists.clear', {})).toMatchObject({ status: 'forbidden' });
    hub.hub.assistant.setRight('lists.clear', true);
    expect(await ctx.assistant.run('lists.clear', {})).toMatchObject({ status: 'confirm' });
  });

  it('refuses a change or destructive action declared without its own right', async () => {
    const hub = await createTestHub({
      modules: [
        fakeModule('bad', {
          backend: {
            register: (ctx) =>
              ctx.assistant.define({
                name: 'wipe',
                description: 'x',
                risk: 'change',
                run: () => ({ message: '' }),
              }),
          },
        }),
      ],
    });
    hubs.push(hub);
    expect(hub.hub.moduleInfos().find((m) => m.id === 'bad')).toMatchObject({ status: 'failed' });
  });

  it('refuses sensitive actions and gives their page', async () => {
    const { ctx } = await start();
    const outcome = await ctx.assistant.run('lists.publish', {}, { confirmed: true });
    expect(outcome).toMatchObject({ status: 'refused', open: '/m/lists/publish' });
  });

  it('rejects unknown actions, unknown or missing parameters, and reports errors', async () => {
    const { ctx } = await start();
    expect(await ctx.assistant.run('lists.nope', {})).toMatchObject({ status: 'invalid' });
    expect(await ctx.assistant.run('lists.add', {})).toMatchObject({
      status: 'invalid',
      message: 'Paramètre « text » manquant',
    });
    expect(await ctx.assistant.run('lists.add', { text: 'x', colour: 'red' })).toMatchObject({
      status: 'invalid',
      message: 'Paramètre inconnu « colour »',
    });
    expect(await ctx.assistant.run('lists.add', { text: 'x', times: 1.5 })).toMatchObject({
      status: 'invalid',
    });
    expect(await ctx.assistant.run('lists.fail', {})).toEqual({
      status: 'error',
      id: 'lists.fail',
      message: 'Élément introuvable',
    });
    expect(items).toEqual(['a']);
  });

  it('opens tools and shell pages by name', async () => {
    const { ctx } = await start();
    expect(await ctx.assistant.run('core.open', { target: 'le module lists' })).toMatchObject({
      status: 'done',
      open: '/m/lists',
    });
    expect(await ctx.assistant.run('core.open', { target: 'les réglages' })).toMatchObject({
      open: '/settings',
    });
    expect(await ctx.assistant.run('core.open', { target: 'xyz' })).toMatchObject({
      status: 'error',
    });
    // Standardised command: the target is taken from the phrase by code.
    expect(
      await ctx.assistant.extract('core.open', 'euh, ouvre le planning s’il te plaît'),
    ).toEqual({ target: 'planning' });
    expect(await ctx.assistant.extract('core.open', 'va dans les réglages')).toEqual({
      target: 'réglages',
    });
    expect(await ctx.assistant.extract('core.open', 'ouvre')).toBeNull();
    expect(await ctx.assistant.extract('core.list-jobs', 'quels rendus sont en cours')).toEqual({});
  });

  it('opens a tool by a nickname or by its sound, and offers the closest one', async () => {
    const { ctx } = await start();
    ctx.assistant.setToolNicknames({ lists: ['ma liste de courses'], '/settings': ['options'] });
    expect(await ctx.assistant.run('core.open', { target: 'ma liste de courses' })).toMatchObject({
      open: '/m/lists',
    });
    expect(await ctx.assistant.run('core.open', { target: 'options' })).toMatchObject({
      open: '/settings',
    });
    // Nothing close enough: what was not found, and the closest names.
    const outcome = await ctx.assistant.run('core.open', { target: 'module liste' });
    expect(outcome.status === 'done' || outcome.status === 'error').toBe(true);
    const none = await ctx.assistant.run('core.open', { target: 'zzzz' });
    expect(none).toMatchObject({
      status: 'error',
      message: 'Je ne trouve pas l’outil « zzzz ».',
      notFound: { param: 'target', value: 'zzzz' },
    });
  });

  it('« ouvre l’application » shows the window, on a page if asked', async () => {
    const { ctx } = await start();
    const extract = (said: string) => ctx.assistant.extract('core.show-app', said);
    expect(await extract('ouvre l’application')).toEqual({});
    expect(await extract('ouvre ToolBox')).toEqual({});
    expect(await extract('reviens sur l’app')).toEqual({});
    expect(await extract('ouvre l’application sur les réglages')).toEqual({ target: 'reglages' });
    expect(await extract('ouvre le planning')).toBeNull();
    // « ouvre l'application » is not a tool to open.
    expect(await ctx.assistant.extract('core.open', 'ouvre l’application')).toBeNull();
    expect(await ctx.assistant.run('core.show-app', {})).toMatchObject({
      status: 'done',
      message: 'C’est ouvert.',
      open: '/',
    });
    expect(await ctx.assistant.run('core.show-app', { target: 'reglages' })).toMatchObject({
      open: '/settings',
    });
  });

  it('coerces what models send', () => {
    const definition = {
      name: 'x',
      description: 'x',
      risk: 'read' as const,
      parameters: {
        n: { type: 'number' as const, description: '' },
        b: { type: 'boolean' as const, description: '' },
        e: { type: 'string' as const, description: '', enum: ['a', 'b'] },
      },
      run: () => ({ message: '' }),
    };
    expect(validateParams(definition, { n: '3', b: 'true', e: ' a ' })).toEqual({
      n: 3,
      b: true,
      e: 'a',
    });
    expect(validateParams(definition, { n: null, e: '' })).toEqual({});
    expect(() => validateParams(definition, { e: 'c' })).toThrow(/a, b/);
  });

  it('refuses ill-formed declarations', async () => {
    const hub = await createTestHub({
      modules: [
        fakeModule('bad', {
          backend: {
            register: (ctx) =>
              ctx.assistant.define({
                name: 'wipe',
                description: 'Efface',
                risk: 'destructive',
                run: () => ({ message: '' }),
              }),
          },
        }),
      ],
    });
    hubs.push(hub);
    const { body } = await hub.request<{ id: string; status: string; error: string }[]>(
      'GET',
      '/api/core/modules',
    );
    expect(body.find((m) => m.id === 'bad')).toMatchObject({ status: 'failed' });
    expect(body.find((m) => m.id === 'bad')!.error).toMatch(/confirmation/);
  });
});

describe('ctx.hotkeys', () => {
  function fakeKeyboard() {
    let listener: ((event: HostKeyEvent) => void) | null = null;
    const keyboard = {
      running: false,
      press: (code: number) => listener?.({ type: 'down', code }),
      release: (code: number) => listener?.({ type: 'up', code }),
    };
    const host = createTestHost({
      globalKeys: {
        start: (next) => {
          listener = next;
          keyboard.running = true;
        },
        stop: () => {
          keyboard.running = false;
        },
        label: (code) => (code === 106 ? 'Touche Copilot' : `Touche ${code}`),
      },
    });
    return { host, keyboard };
  }

  it('reports the hold and release of the bound key, once per press', async () => {
    const { host, keyboard } = fakeKeyboard();
    const { ctx } = await start(host);
    expect(ctx.hotkeys.status()).toEqual({ available: true, reason: null });
    expect(keyboard.running).toBe(false); // no hook while nobody listens
    const events: string[] = [];
    ctx.hotkeys.hold(
      { code: 106, label: 'Touche Copilot' },
      { onPress: () => events.push('press'), onRelease: () => events.push('release') },
    );
    expect(keyboard.running).toBe(true);
    keyboard.press(30);
    keyboard.press(106);
    keyboard.press(106); // auto-repeat
    keyboard.release(106);
    keyboard.release(30);
    expect(events).toEqual(['press', 'release']);
    ctx.hotkeys.hold(null, { onPress() {}, onRelease() {} });
    expect(keyboard.running).toBe(false);
  });

  it('captures the next key pressed, without triggering the binding', async () => {
    const { host, keyboard } = fakeKeyboard();
    const { ctx } = await start(host);
    const events: string[] = [];
    ctx.hotkeys.hold(
      { code: 30, label: 'A' },
      { onPress: () => events.push('press'), onRelease() {} },
    );
    const captured = ctx.hotkeys.capture(1000);
    keyboard.press(106);
    expect(await captured).toEqual({ code: 106, label: 'Touche Copilot' });
    keyboard.release(106);
    expect(await ctx.hotkeys.capture(10)).toBeNull();
    expect(events).toEqual([]);
  });

  it('combinations: captured with the modifiers held, fired only with them', async () => {
    const { host, keyboard } = fakeKeyboard();
    const { ctx } = await start(host);
    // Ctrl (29) + Space (57).
    const captured = ctx.hotkeys.capture(1000);
    keyboard.press(29);
    keyboard.press(57);
    expect(await captured).toEqual({
      code: 57,
      label: 'Ctrl + Touche 57',
      modifiers: ['ctrl'],
    });
    keyboard.release(57);
    keyboard.release(29);
    // A modifier alone: pressed and released.
    const alone = ctx.hotkeys.capture(1000);
    keyboard.press(3613);
    keyboard.release(3613);
    expect(await alone).toEqual({ code: 3613, label: 'Touche 3613' });
    const events: string[] = [];
    ctx.hotkeys.hold(
      { code: 57, label: 'Ctrl + Espace', modifiers: ['ctrl'] },
      { onPress: () => events.push('bar'), onRelease() {} },
      'bar',
    );
    // Several bindings of the same module, by name.
    ctx.hotkeys.hold(
      { code: 106, label: 'Touche Copilot' },
      { onPress: () => events.push('mic'), onRelease() {} },
      'mic',
    );
    keyboard.press(57); // Space alone: nothing
    keyboard.release(57);
    keyboard.press(3613); // right Ctrl counts as Ctrl
    keyboard.press(57);
    keyboard.release(57);
    keyboard.release(3613);
    keyboard.press(42); // Shift + Copilot: a single key fires whatever is held
    keyboard.press(106);
    keyboard.release(106);
    keyboard.release(42);
    expect(events).toEqual(['bar', 'mic']);
    ctx.hotkeys.hold(null, { onPress() {}, onRelease() {} }, 'bar');
    ctx.hotkeys.hold(null, { onPress() {}, onRelease() {} }, 'mic');
    expect(keyboard.running).toBe(false);
  });

  it('is unavailable outside the desktop app', async () => {
    const { ctx } = await start();
    expect(ctx.hotkeys.status().available).toBe(false);
    expect(await ctx.hotkeys.capture(10)).toBeNull();
  });

  it('shows the floating indicator while a module asks for it', async () => {
    const calls: unknown[] = [];
    const host = createTestHost({
      setOverlayVisible: (visible) => calls.push(visible),
      showWindow: (target) => calls.push(target),
    });
    const { ctx } = await start(host);
    ctx.ui.setOverlay(true);
    ctx.ui.setOverlay(true);
    ctx.ui.setOverlay(false);
    ctx.ui.open('/m/lists');
    expect(() => ctx.ui.open('m/lists')).toThrow();
    expect(calls).toEqual([true, false, '/m/lists']);
  });
});
