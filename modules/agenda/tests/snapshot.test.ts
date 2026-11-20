// v0.44.0: the calendar's image (ADR 0050). The scene (pure) for each view,
// the switches, the « Dispos seulement » mode, the whole range of hours; and a
// real PNG painted with @napi-rs/canvas (its size, no text chunk in it).
// SNAPSHOT_OUT=<folder>: the PNGs are also written there (the report's images).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  BUSY,
  buildSnapshot,
  sceneTexts,
  snapshotFileName,
  snapshotTitle,
  type Scene,
  type SnapshotInput,
  type SnapshotItem,
} from '../shared/snapshot';
import { type Canvas2D, paintScene, snapshotColors } from '../shared/snapshot-paint';
import { cssRules, parseRgba, substitute, themeTokens } from '../shared/snapshot-color';
import { snapshotItems, snapshotPeriod } from '../frontend/snapshot';
import type { RangeDto } from '../shared/types';

const THEMES = path.resolve(__dirname, '..', '..', '..', 'frontend', 'src', 'themes');
const rules = ['palette.css', 'nebula.css', 'clair.css', 'minuit.css'].flatMap((f) =>
  cssRules(readFileSync(path.join(THEMES, f), 'utf8')),
);
const colorsOf = (theme: string, scheme: 'light' | 'dark') => {
  const tokens = themeTokens(rules, theme, scheme);
  const colors = snapshotColors((name) => tokens.get(name));
  if (!colors) throw new Error(`theme ${theme}: tokens missing`);
  return colors;
};

const COLORS: Record<string, string> = {
  Cours: 'var(--series-2)',
  Sport: 'var(--hue-vert)',
  Deadline: 'var(--danger)',
  'Rendez-vous': 'var(--series-1)',
};

const item = (
  over: Partial<SnapshotItem> & Pick<SnapshotItem, 'id' | 'start' | 'end'>,
): SnapshotItem => ({
  title: over.id,
  allDay: false,
  category: 'Cours',
  location: null,
  source: 'own',
  ...over,
});

/** A full week: courses with places, a sport, an all-day camp over two weeks, deadlines, a facultatif. */
const WEEK: SnapshotItem[] = [
  item({
    id: 'Thermodynamique',
    start: '2026-11-23T08:15',
    end: '2026-11-23T10:00',
    location: '2E44',
  }),
  item({
    id: 'Électronique',
    start: '2026-11-23T10:30',
    end: '2026-11-23T12:30',
    location: '2F51',
  }),
  item({
    id: 'Labo de chimie',
    start: '2026-11-24T13:45',
    end: '2026-11-24T17:00',
    location: '2F51, 2E51',
  }),
  item({
    id: 'Analyse',
    start: '2026-11-25T08:15',
    end: '2026-11-25T10:00',
    location: 'Auditoire Ampère',
  }),
  item({
    id: 'Réunion projet',
    start: '2026-11-25T09:00',
    end: '2026-11-25T10:30',
    category: 'Rendez-vous',
    location: 'Salle 3',
  }),
  item({
    id: 'Course à pied',
    start: '2026-11-26T18:30',
    end: '2026-11-26T19:30',
    category: 'Sport',
    source: 'foreign',
  }),
  item({
    id: 'Dentiste',
    start: '2026-11-27T16:00',
    end: '2026-11-27T16:30',
    category: 'Rendez-vous',
    location: 'Rue de la Loi 12',
  }),
  item({
    id: 'Conférence',
    start: '2026-11-27T14:00',
    end: '2026-11-27T15:30',
    optional: true,
    location: 'Aula',
  }),
  item({
    id: 'Camp scout',
    start: '2026-11-28',
    end: '2026-12-02',
    allDay: true,
    category: 'Rendez-vous',
    location: 'Han',
  }),
  item({
    id: 'Rendu rapport',
    start: '2026-11-26T23:30',
    end: '2026-11-26T23:30',
    category: 'Deadline',
    deadline: true,
  }),
  item({
    id: 'Inscription examens',
    start: '2026-11-27',
    end: '2026-11-27',
    allDay: true,
    category: 'Cours',
    deadline: true,
  }),
  item({
    id: 'Réviser stats',
    start: '2026-11-24T19:00',
    end: '2026-11-24T21:00',
    category: 'Tâches',
    source: 'task',
  }),
];
const PERSONAL = [
  'Thermodynamique',
  '2E44',
  'Électronique',
  'Labo de chimie',
  'Dentiste',
  'Rue de la Loi',
  'Camp scout',
  'Han',
  'Rendu rapport',
  'Inscription',
  'Réviser',
  'Conférence',
  'Aula',
];

const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  view: 'week',
  mode: 'details',
  from: '2026-11-23',
  to: '2026-11-29',
  items: WEEK,
  dayStartHour: 7,
  dayEndHour: 23,
  colorOf: (c) => COLORS[c] ?? 'var(--series-6)',
  ...over,
});

/** A real PNG of the scene (@napi-rs/canvas), and its chunks' types. */
function png(scene: Scene, theme = colorsOf('clair', 'light')) {
  const canvas = createCanvas(scene.width * scene.scale, scene.height * scene.scale);
  paintScene(canvas.getContext('2d') as unknown as Canvas2D, scene, theme);
  const bytes = canvas.toBuffer('image/png');
  const chunks: string[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    chunks.push(bytes.toString('latin1', at + 4, at + 8));
    at += 12 + length;
  }
  return { bytes, chunks, width: canvas.width, height: canvas.height };
}
const OUT = process.env.SNAPSHOT_OUT;
const keep = (name: string, bytes: Buffer) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, name), bytes);
};

describe('the period of the image', () => {
  it('week, month, day: their titles (across months and years too)', () => {
    expect(snapshotTitle('week', '2026-11-23', '2026-11-29')).toBe(
      'Semaine du 23 au 29 novembre 2026',
    );
    expect(snapshotTitle('week', '2026-11-30', '2026-12-06')).toBe(
      'Semaine du 30 novembre au 6 décembre 2026',
    );
    expect(snapshotTitle('week', '2026-12-28', '2027-01-03')).toBe(
      'Semaine du 28 décembre 2026 au 3 janvier 2027',
    );
    expect(snapshotTitle('month', '2026-10-26', '2026-12-06', '2026-11')).toBe('Novembre 2026');
    expect(snapshotTitle('day', '2026-11-23', '2026-11-23')).toBe('Lundi 23 novembre 2026');
    expect(snapshotTitle('day', '2026-12-01', '2026-12-01')).toBe('Mardi 1er décembre 2026');
    expect(snapshotFileName('week', '2026-11-23')).toBe('Agenda semaine du 2026-11-23.png');
  });
  it('follows the navigation: the week shown (next, previous), the month, the day', () => {
    expect(snapshotPeriod('week', '2026-11-26')).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(snapshotPeriod('week', '2026-12-02')).toEqual({ from: '2026-11-30', to: '2026-12-06' });
    expect(snapshotPeriod('week', '2026-11-18')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(snapshotPeriod('month', '2026-11-26')).toEqual({
      from: '2026-10-26',
      to: '2026-12-06',
      month: '2026-11',
    });
    expect(snapshotPeriod('day', '2026-11-26')).toEqual({ from: '2026-11-26', to: '2026-11-26' });
    const next = buildSnapshot(input({ from: '2026-11-30', to: '2026-12-06' }));
    expect(next.title).toBe('Semaine du 30 novembre au 6 décembre 2026');
    // Only the camp reaches that week (its last days, from the edge: « ← »).
    expect(sceneTexts(next)).toContain('← Camp scout');
    expect(sceneTexts(next)).not.toContain('Thermodynamique');
  });
});

describe('what the image holds', () => {
  it('« Détails »: titles, places, deadlines, the facultatif hatched, the legend', () => {
    const scene = buildSnapshot(input());
    const texts = sceneTexts(scene);
    for (const t of [
      'Thermodynamique',
      '2E44',
      'Camp scout →',
      'Rendu rapport',
      'Inscription examens',
      'Conférence',
    ])
      expect(texts, t).toContain(t);
    expect(scene.legend).toEqual(['Cours', 'Deadline', 'Rendez-vous', 'Sport', 'Tâches']);
    expect(scene.shapes.filter((s) => s.t === 'alert')).toHaveLength(2);
    expect(scene.shapes.some((s) => s.t === 'rect' && s.hatch)).toBe(true);
    // Nothing of the interface.
    for (const t of ['À caser', 'Charge', 'de libre', 'léger'])
      expect(texts.join(' ')).not.toContain(t);
  });
  it('the whole range of hours: from the first to the last element, the Agenda range at least', () => {
    expect(buildSnapshot(input()).hours).toEqual({ start: 7, end: 24 });
    const early = buildSnapshot(
      input({ items: [item({ id: 'Train', start: '2026-11-24T05:40', end: '2026-11-24T06:50' })] }),
    );
    expect(early.hours).toEqual({ start: 5, end: 23 });
    const narrow = buildSnapshot(input({ items: [], dayStartHour: 8, dayEndHour: 18 }));
    expect(narrow.hours).toEqual({ start: 8, end: 18 });
  });
  it('« Dispos seulement »: « Occupé » only — no title, place nor note anywhere; no deadline, no legend', () => {
    const scene = buildSnapshot(input({ mode: 'busy' }));
    const all = JSON.stringify(scene);
    for (const word of PERSONAL) expect(all, word).not.toContain(word);
    const texts = sceneTexts(scene);
    expect(texts).toContain(BUSY);
    expect(texts).toContain(`${BUSY} (facultatif)`);
    expect(scene.legend).toEqual([]);
    expect(scene.shapes.filter((s) => s.t === 'alert')).toHaveLength(0);
    // The colours stay (one per category drawn).
    const bars = new Set(
      scene.shapes.flatMap((s) =>
        s.t === 'rect' && s.bar && 'color' in s.bar ? [s.bar.color] : [],
      ),
    );
    expect(bars.size).toBe(4);
    // The same in the month.
    const month = buildSnapshot(
      input({
        view: 'month',
        mode: 'busy',
        from: '2026-10-26',
        to: '2026-12-06',
        month: '2026-11',
      }),
    );
    for (const word of PERSONAL) expect(JSON.stringify(month), word).not.toContain(word);
  });
  it('the switches: a category switched off is not in the image (nor its legend)', () => {
    const data = {
      events: WEEK.filter((i) => i.source === 'own').map((i) => ({
        id: i.id,
        title: i.title,
        start: i.start,
        end: i.end,
        allDay: i.allDay,
        location: i.location,
        note: 'note privée',
        category: i.category,
        weekly: null,
        timerPref: null,
        ...(i.deadline ? { deadline: true } : {}),
        ...(i.optional ? { optional: true } : {}),
      })),
      foreign: [
        {
          id: 'sport:1',
          title: 'Course à pied',
          start: '2026-11-26T18:30',
          end: '2026-11-26T19:30',
          allDay: false,
          category: 'Sport',
          moduleId: 'sport',
          open: '/m/sport',
          status: null,
        },
      ],
      tasks: [],
    } as unknown as RangeDto;
    const items = snapshotItems(data, (c) => c !== 'Sport');
    expect(items.map((i) => i.category)).not.toContain('Sport');
    const scene = buildSnapshot(input({ items }));
    expect(sceneTexts(scene)).not.toContain('Course à pied');
    expect(scene.legend).not.toContain('Sport');
    // A note is never in the image, whatever the mode.
    expect(JSON.stringify(scene)).not.toContain('note privée');
  });
  it('the month and the phone’s day', () => {
    const month = buildSnapshot(
      input({ view: 'month', from: '2026-10-26', to: '2026-12-06', month: '2026-11' }),
    );
    expect(month.title).toBe('Novembre 2026');
    expect(sceneTexts(month)).toContain('Thermodynamique');
    const day = buildSnapshot(input({ view: 'day', from: '2026-11-25', to: '2026-11-25' }));
    expect(day.title).toBe('Mercredi 25 novembre 2026');
    expect(sceneTexts(day)).toContain('Réunion projet');
    expect(sceneTexts(day)).not.toContain('Thermodynamique');
    expect(day.width).toBeLessThan(month.width);
  });
});

describe('the PNG', () => {
  it('about 1 600 px wide (×2), no text chunk; light and dark themes', () => {
    const cases: [string, Scene, 'clair' | 'minuit'][] = [
      ['semaine-details-clair.png', buildSnapshot(input()), 'clair'],
      ['semaine-dispos-clair.png', buildSnapshot(input({ mode: 'busy' })), 'clair'],
      [
        'mois-details-clair.png',
        buildSnapshot(
          input({ view: 'month', from: '2026-10-26', to: '2026-12-06', month: '2026-11' }),
        ),
        'clair',
      ],
      [
        'jour-details-clair.png',
        buildSnapshot(input({ view: 'day', from: '2026-11-25', to: '2026-11-25' })),
        'clair',
      ],
      ['semaine-details-sombre.png', buildSnapshot(input()), 'minuit'],
    ];
    for (const [name, scene, theme] of cases) {
      const out = png(
        scene,
        theme === 'clair' ? colorsOf('clair', 'light') : colorsOf('minuit', 'dark'),
      );
      expect(out.width).toBe(name.startsWith('jour') ? 960 : 1600);
      expect(out.chunks.filter((c) => /^[tiz]TXt$/.test(c))).toEqual([]);
      keep(name, out.bytes);
    }
  });
  it('the theme’s tokens are read (« Clair »: a light surface, a dark text)', () => {
    const c = colorsOf('clair', 'light');
    expect(c.surface.every((v) => v > 240)).toBe(true);
    expect(c.text.every((v) => v < 60)).toBe(true);
    expect(c.color('var(--hue-vert)')).not.toBeNull();
    expect(parseRgba('rgb(30 35 70 / 10%)')).toEqual({ rgb: [30, 35, 70], alpha: 0.1 });
    expect(substitute('var(--a, var(--b))', (n) => (n === '--b' ? 'red' : undefined))).toBe('red');
  });
});

describe('« Enregistrer l’image… » (the route)', () => {
  it('a PNG only, a file name ending in .png; outside the desktop app: cancelled, nothing written', async () => {
    const { createTestHub, loadModuleFolder } = await import('@hub/sdk/testing');
    const hub = await createTestHub({
      loadExamples: false,
      modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
    });
    try {
      const url = '/api/modules/agenda/image/save';
      const scene = png(buildSnapshot(input()));
      const b64 = scene.bytes.toString('base64');
      expect((await hub.request('POST', url, { name: 'x.txt', png: b64 })).status).toBe(400);
      expect((await hub.request('POST', url, { name: 'a/b.png', png: b64 })).status).toBe(400);
      expect(
        (
          await hub.request('POST', url, {
            name: 'Agenda.png',
            png: Buffer.from('hello').toString('base64'),
          })
        ).status,
      ).toBe(400);
      const ok = await hub.request('POST', url, {
        name: 'Agenda semaine du 2026-11-23.png',
        png: b64,
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ cancelled: true });
    } finally {
      await hub.close();
    }
  });
});
