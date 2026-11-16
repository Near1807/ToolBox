// The blocks of the week (v0.38.0): no control on a block (a task is ticked
// in its panel); the TITLE first — a block of 15 or 30 minutes is one line
// that starts with its title, the time after it; a tall one shows the time
// then the title on the lines left; « prévue après son échéance » is not
// flagged once the task is done; « chevauche » stays.
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, dumpTables, loadModuleFolder, type TestHub } from '@hub/sdk/testing';
import { readFileSync } from 'node:fs';
import { Block, Ghost, ghostLabel, SHORT_BLOCK_PX, titleLines } from '../frontend/WeekView';
import type { Item } from '../frontend/common';
import type { RangeDto } from '../shared/types';

const MODULES = path.resolve(__dirname, '..', '..');

const HOUR_PX = 44;
const task = (title: string, minutes: number, extra: Record<string, unknown> = {}): Item =>
  ({
    source: 'task',
    event: {
      id: 't1',
      title,
      start: '2026-11-18T09:00',
      end: `2026-11-18T09:${String(minutes).padStart(2, '0')}`,
      allDay: false,
      category: 'Tâches',
      done: false,
      due: null,
      afterDue: false,
      open: '/m/todo',
      ...extra,
    },
  }) as Item;
const render = (item: Item, minutes: number, overlaps = false) =>
  renderToStaticMarkup(
    createElement(Block, {
      item,
      top: 0,
      // As the week computes it.
      height: (minutes / 60) * HOUR_PX - 2,
      lane: 0,
      lanes: 1,
      overlaps,
      dragging: false,
      onOpen: () => undefined,
      wasDrag: () => false,
    }),
  );
const order = (html: string, a: string, b: string) => html.indexOf(a) < html.indexOf(b);

describe('a block of the week', () => {
  it('15 and 30 minutes: one line, the title first, then the time; no checkbox', () => {
    for (const minutes of [15, 30]) {
      const html = render(task('Appeler le garage', minutes), minutes);
      expect(html).toContain('ag-block--short');
      expect(html).toContain('<span class="ag-block__title">Appeler le garage</span>');
      expect(order(html, 'ag-block__title', 'ag-block__time')).toBe(true);
      expect(html).not.toContain('checkbox');
      expect(html).not.toContain('<input');
    }
    // 30 and 45 minutes are short; an hour is not.
    expect((30 / 60) * HOUR_PX - 2).toBeLessThan(SHORT_BLOCK_PX);
    expect((45 / 60) * HOUR_PX - 2).toBeLessThan(SHORT_BLOCK_PX);
    expect((60 / 60) * HOUR_PX - 2).toBeGreaterThanOrEqual(SHORT_BLOCK_PX);
  });

  it('tall: the time, then the title on the lines left (at least one)', () => {
    const html = render(task('Réviser la thermodynamique', 59), 120);
    expect(html).not.toContain('ag-block--short');
    expect(order(html, 'ag-block__time', 'ag-block__title')).toBe(true);
    expect(html).toContain('-webkit-line-clamp:4');
    expect(titleLines(42)).toBe(1);
    expect(titleLines(86)).toBe(4);
  });

  it('the warning: « après son échéance » not on a done task, « chevauche » always; after the title', () => {
    const late = task('Rendre le rapport', 30, { afterDue: true });
    expect(render(late, 30)).toContain('ag-block__warn');
    expect(render(late, 30)).toContain('Prévue après son échéance');
    const doneLate = task('Rendre le rapport', 30, { afterDue: true, done: true });
    expect(render(doneLate, 30)).not.toContain('ag-block__warn');
    expect(render(doneLate, 30)).not.toContain('Prévue après son échéance');
    expect(render(doneLate, 30)).toContain('ag-block--done');
    const overlapping = render(doneLate, 30, true);
    expect(overlapping).toContain('ag-block__warn');
    expect(order(overlapping, 'ag-block__title', 'ag-block__warn')).toBe(true);
  });
});

describe('ticking a task in its panel (the To-do’s sheet)', () => {
  let hub: TestHub | null = null;
  afterEach(async () => {
    await hub?.close();
    hub = null;
  });

  it('one write, its undo one more; the week shows it done, without the late flag', async () => {
    hub = await createTestHub({
      loadExamples: false,
      modules: await Promise.all(
        ['todo', 'agenda'].map((id) => loadModuleFolder(path.join(MODULES, id))),
      ),
    });
    const made = (
      await hub.request<{ id: string }>('POST', '/api/modules/agenda/tasks', {
        title: 'Rendre le rapport',
        plannedAt: '2030-11-19T09:00',
        durationMin: 30,
      })
    ).body;
    await hub.request('PATCH', `/api/modules/todo/tasks/${made.id}`, { due: '2030-11-17' });
    const journal = () => (dumpTables(hub!.dataDir, 'todo').todo__changes ?? []).length;
    const before = journal();
    // What the sheet does on « Faite »: one PATCH.
    await hub.request('PATCH', `/api/modules/todo/tasks/${made.id}`, { done: true });
    expect(journal()).toBe(before + 1);
    const week = (
      await hub.request<RangeDto>('GET', '/api/modules/agenda/range?from=2030-11-18&to=2030-11-24')
    ).body;
    const planned = week.tasks.find((t) => t.id === made.id)!;
    expect(planned).toMatchObject({ done: true, afterDue: true });
    const html = render({ source: 'task', event: planned } as Item, 30);
    expect(html).toContain('ag-block--done');
    expect(html).not.toContain('ag-block__warn');
    // « Annuler »: the opposite write.
    await hub.request('PATCH', `/api/modules/todo/tasks/${made.id}`, { done: false });
    expect(journal()).toBe(before + 2);
    const again = (
      await hub.request<RangeDto>('GET', '/api/modules/agenda/range?from=2030-11-18&to=2030-11-24')
    ).body.tasks.find((t) => t.id === made.id)!;
    expect(again.done).toBe(false);
  });
});

describe('the ghost of a move, a stretch, a creation (v0.40.0)', () => {
  const span = { start: '2026-11-18T08:15', end: '2026-11-18T09:00' };
  it('says the time and the length, inside when tall enough, under it when short', () => {
    expect(ghostLabel(span)).toBe('08:15 – 09:00 · 45 min');
    const tall = renderToStaticMarkup(
      createElement(Ghost, { span, top: 0, height: 31, category: 'Tâches' }),
    );
    expect(tall).toContain('08:15 – 09:00 · 45 min');
    expect(tall).not.toContain('ag-ghost__label--below');
    const short = renderToStaticMarkup(
      createElement(Ghost, {
        span: { ...span, end: '2026-11-18T08:30' },
        top: 0,
        height: 9,
        category: 'Tâches',
      }),
    );
    expect(short).toContain('ag-ghost__label ag-ghost__label--below');
    expect(short).toContain('08:15 – 08:30 · 15 min');
    expect(short).toContain('height:18px');
  });
  it('the whole column wide: explicit left/right, no size containment (the v0.38 regression)', () => {
    const css = readFileSync(path.join(__dirname, '..', 'frontend', 'agenda.css'), 'utf8');
    const rule = /\.ag-block\.ag-block--ghost \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/left: 0;/);
    expect(rule).toMatch(/right: 0;/);
    expect(rule).toMatch(/container-type: normal;/);
  });
});
