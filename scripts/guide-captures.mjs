// Captures of the real interface for the guide of « Analyse du master », with
// the boxes of their numbered marks (modules/master-analysis/frontend/guide/).
// Run again after any change of the interface it shows:
//   npm run build
//   xvfb-run -a node scripts/guide-captures.mjs <master v1> <master v2> <reference>
// (three audio files of a few minutes; Playwright must be installed, as in the
// cloud environment). Uses a temporary userData: nothing of yours is touched.
/* global window */
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'modules', 'master-analysis', 'frontend', 'guide');
const [v1, v2, reference] = process.argv.slice(2).map((p) => path.resolve(p));
if (!reference) {
  console.error('Usage : node scripts/guide-captures.mjs <master v1> <master v2> <référence>');
  process.exit(1);
}

const userData = mkdtempSync(path.join(tmpdir(), 'toolbox-guide-'));
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [ROOT, '--no-sandbox'],
  env: { ...process.env, TOOLBOX_USER_DATA_DIR: userData },
});
const shots = {};
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 2400 });
  await page.waitForSelector('.module-card', { timeout: 60_000 });
  const api = (method, url, body) =>
    page.evaluate(
      async ([method, url, body]) => {
        const r = await fetch(url, {
          method,
          headers: {
            'x-toolbox-token': window.toolbox.token,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return r.json();
      },
      [method, url, body],
    );
  const track = await api('POST', '/api/modules/music-library/tracks', { audioPath: v1 });
  await api('PATCH', `/api/modules/music-library/tracks/${track.id}`, { title: 'Nuit Blanche' });
  await api('POST', '/api/modules/master-analysis/versions', { trackId: track.id, paths: [v1] });
  await api('POST', '/api/modules/master-analysis/versions', { trackId: track.id, paths: [v2] });
  const profile = await api('POST', '/api/modules/master-analysis/profiles', { name: 'Club' });
  await api('POST', `/api/modules/master-analysis/profiles/${profile.id}/references`, {
    paths: [reference],
  });
  for (let i = 0; i < 300; i++) {
    const jobs = await api('GET', '/api/core/jobs?module=master-analysis');
    if (jobs.length && jobs.every((j) => !['queued', 'running'].includes(j.status))) break;
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => (window.location.hash = '#/m/master-analysis'));
  await page.waitForSelector('.ma-lanes canvas', { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const boxOf = async (target) => {
    const locator = typeof target === 'string' ? page.locator(target).first() : target;
    return locator.boundingBox();
  };
  const union = (boxes) => {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
  };
  const card = (title) =>
    page.locator('section.card', { has: page.locator(`h3:has-text("${title}")`) });
  /** The views panel, from its top down to the bottom of `last`. */
  const down = async (last) => {
    const top = await boxOf('.ma-panels');
    const b = await boxOf(last);
    return { x: top.x, y: top.y, width: top.width, height: b.y + b.height - top.y };
  };
  /** Screenshot of `clip`, and the marks as % of it. */
  const capture = async (id, clip, marks) => {
    const c = {
      x: Math.round(clip.x),
      y: Math.round(clip.y),
      width: Math.round(clip.width),
      height: Math.round(clip.height),
    };
    const file = `${id}.jpg`;
    await page.screenshot({
      path: path.join(OUT, 'img', file),
      clip: c,
      type: 'jpeg',
      quality: 82,
    });
    const boxes = {};
    for (const [mark, target] of Object.entries(marks)) {
      const b = Array.isArray(target)
        ? union(await Promise.all(target.map(boxOf)))
        : await boxOf(target);
      if (!b) throw new Error(`${id} : repère « ${mark} » introuvable`);
      const pad = 3;
      const pct = (v, total) => Math.round((v / total) * 10000) / 100;
      // Kept inside the capture (a box sticking out would widen the guide page).
      const left = Math.max(0, b.x - pad - c.x);
      const top = Math.max(0, b.y - pad - c.y);
      const right = Math.min(c.width, b.x + b.width + pad - c.x);
      const bottom = Math.min(c.height, b.y + b.height + pad - c.y);
      boxes[mark] = {
        x: pct(left, c.width),
        y: pct(top, c.height),
        w: pct(right - left, c.width),
        h: pct(bottom - top, c.height),
      };
    }
    shots[id] = { file, width: c.width, height: c.height, marks: boxes };
    console.log(`${file} ${c.width}×${c.height}`);
  };
  mkdirSync(path.join(OUT, 'img'), { recursive: true });

  // 1. The page: projects, versions, player, tabs.
  const pageBox = await boxOf('.page');
  const tabs = await boxOf('.ma-tabs');
  await capture(
    'apercu',
    {
      x: pageBox.x,
      y: pageBox.y,
      width: pageBox.width,
      height: tabs.y + tabs.height + 16 - pageBox.y,
    },
    {
      projects: '.ui-tracks',
      add: 'button:has-text("Ajouter une version")',
      versions: '.ma-versions',
      player: '.ma-player',
      tabs: '.ma-tabs',
      guide: '.page__actions button:has-text("Guide")',
    },
  );

  // 2. The timeline, values shown at a point.
  const lanes = await boxOf('.ma-lanes');
  await page.mouse.move(lanes.x + lanes.width * 0.36, lanes.y + 260);
  await page.waitForTimeout(400);
  await capture('ligne-de-temps', await boxOf('.ma-timeline'), {
    zoom: [
      '.ma-timeline__tools button:has-text("Zoom +")',
      '.ma-timeline__tools button:has-text("Tout")',
    ],
    overview: '.ma-overview',
    sections: '.ma-sections',
    lanes: '.ma-lanes-wrap',
    tip: '.ma-tip',
    toggles: page.locator('.ma-timeline > .toolbar').last(),
  });
  await page.mouse.move(0, 0);

  // 3. Global measures, down to the platforms (the list of markers below can be long).
  await page.click('button[role=tab]:has-text("Mesures globales")');
  await page.waitForTimeout(600);
  const platforms = card('Normalisation des plateformes');
  await capture('mesures-globales', await down(platforms), {
    loudness: card('Sonie et dynamique'),
    stereo: card('Stéréo et mono'),
    tonal: card('Équilibre tonal'),
    platforms,
  });

  // 4. Sections.
  await page.click('button[role=tab]:has-text("Sections")');
  await page.waitForTimeout(600);
  await capture('sections', await boxOf('.ma-panels'), {
    tools: page.locator('.ma-panels .toolbar').first(),
    table: page.locator('.ma-panels .ma-table').first(),
    contrasts: card('Contrastes entre sections'),
  });

  // 5. Versions (down to the overlaid loudness).
  await page.click('button[role=tab]:has-text("Versions")');
  await page.waitForSelector('.ma-map__grid', { timeout: 20_000 });
  await page.waitForTimeout(600);
  const overlay = card('Sonie court terme superposée');
  await capture('versions', await down(overlay), {
    pick: page.locator('.ma-panels .toolbar').first(),
    global: card('Différences globales'),
    bands: card('Énergie par bande'),
    overlay,
  });

  // 6. References (down to the global table).
  await page.click('button[role=tab]:has-text("Références")');
  await page.waitForSelector('text=Écoute A/B', { timeout: 20_000 });
  await page.waitForTimeout(600);
  const global = card('Global');
  await capture('references', await down(global), {
    profile: page.locator('.ma-panels .toolbar').first(),
    ab: card('Écoute A/B'),
    bands: card('Équilibre par bande'),
    global,
  });

  writeFileSync(path.join(OUT, 'shots.json'), `${JSON.stringify(shots, null, 2)}\n`);
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
