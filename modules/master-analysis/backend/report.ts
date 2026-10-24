// Export of an analysis as one self-contained HTML file (opened in any
// browser, printable to PDF): the measures, the markers, the sections, the
// platforms, the tonal balance and the comparison with the previous version.
// Facts only, like the interface.
import { clock, fr, pct } from '../shared/format';
import {
  dynamicsCurves,
  loudnessCurve,
  markers,
  measures,
  sectionMeasures,
  type compareVersions,
} from '../shared/measures';
import { BANDS, BLOCK, type Analysis, type PlatformResult, type Section } from '../shared/types';

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A line chart (one or two series) as inline SVG. */
function lineSvg(
  series: { values: (number | null)[]; color: string; label: string }[],
  options: { min: number; max: number; seconds: number; unit: string },
) {
  const width = 900;
  const height = 180;
  const pad = 36;
  const x = (i: number, n: number) => pad + (i / Math.max(1, n - 1)) * (width - pad - 8);
  const y = (v: number) =>
    8 +
    (1 -
      (Math.max(options.min, Math.min(options.max, v)) - options.min) /
        (options.max - options.min)) *
      (height - 32);
  const paths = series.map((s) => {
    let d = '';
    let open = false;
    const step = Math.max(1, Math.floor(s.values.length / 900));
    for (let i = 0; i < s.values.length; i += step) {
      const v = s.values[i];
      if (v === null || v === undefined) {
        open = false;
        continue;
      }
      d += `${open ? 'L' : 'M'}${x(i, s.values.length).toFixed(1)},${y(v).toFixed(1)}`;
      open = true;
    }
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.5"/>`;
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => options.min + f * (options.max - options.min));
  return `<svg viewBox="0 0 ${width} ${height}" role="img">
    ${ticks.map((t) => `<line x1="${pad}" x2="${width - 8}" y1="${y(t)}" y2="${y(t)}" stroke="#e3e3ea"/><text x="${pad - 4}" y="${y(t) + 4}" text-anchor="end">${fr(t, 0)}</text>`).join('')}
    ${[0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${pad + f * (width - pad - 8)}" y="${height - 6}" text-anchor="middle">${clock(f * options.seconds, 0)}</text>`).join('')}
    ${paths.join('')}
    <text x="${width - 8}" y="16" text-anchor="end">${escape(series.map((s) => s.label).join(' · '))} (${options.unit})</text>
  </svg>`;
}

export function buildReport(input: {
  title: string;
  version: string;
  analysis: Analysis;
  sections: Section[];
  threshold: number;
  platforms: PlatformResult[];
  previous: {
    name: string;
    comparison: ReturnType<typeof compareVersions> & { offset: number };
  } | null;
}): string {
  const a = input.analysis;
  const m = measures(a);
  const seconds = a.blocks * BLOCK;
  const list = markers(a, input.threshold);
  const short = loudnessCurve(a, 'short');
  const { plr } = dynamicsCurves(a);
  const sections = sectionMeasures(a, input.sections);
  const row = (label: string, value: string) =>
    `<tr><th>${escape(label)}</th><td>${value}</td></tr>`;
  const file = a.file;
  const count = (kind: string) => list.filter((x) => x.kind === kind).length;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Analyse — ${escape(input.title)} — ${escape(input.version)}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #1d1d24; background: #fff; margin: 32px auto; max-width: 960px; padding: 0 16px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; } h2 { font-size: 1.1rem; margin: 28px 0 8px; border-bottom: 1px solid #e3e3ea; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; } th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #f0f0f4; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; } .muted { color: #6b6b78; font-size: 0.85rem; }
  svg { width: 100%; height: auto; font-size: 11px; fill: #6b6b78; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>${escape(input.title)} — ${escape(input.version)}</h1>
<p class="muted">Analyse du master (ToolBox), le ${new Date().toLocaleString('fr-FR')}. Mesures seulement : le fichier n’a pas été modifié.</p>

<h2>Mesures globales</h2>
<table>
${row('Sonie intégrée', `${fr(m.integrated)} LUFS`)}
${row('Plage de sonie (LRA)', `${fr(m.lra)} LU`)}
${row('Crête vraie maximale', `${fr(m.truePeak, 1, true)} dBTP`)}
${row('Crête d’échantillon', `${fr(m.samplePeak, 1, true)} dBFS`)}
${row('PLR (crête vraie − sonie intégrée)', `${fr(m.plr)} LU`)}
${row('Facteur de crête (crête − RMS)', `${fr(m.crest)} dB`)}
${row('Corrélation de phase', fr(m.correlation, 2))}
${row('Largeur stéréo (part du côté)', pct(m.width))}
${row('Compatibilité mono (perte au mono)', `${fr(m.monoLoss)} dB`)}
${row(`Dépassements au-dessus de ${fr(input.threshold, 1, true)} dBTP`, String(count('over')))}
${row('Écrêtages', String(a.clipping.length))}
</table>

<h2>Sonie court terme et PLR</h2>
${lineSvg([{ values: short, color: '#5b4bd6', label: 'Sonie court terme' }], { min: -40, max: 0, seconds, unit: 'LUFS' })}
${lineSvg([{ values: plr, color: '#0f8a7e', label: 'PLR (3 s)' }], { min: 0, max: 24, seconds, unit: 'LU' })}

<h2>Normalisation des plateformes</h2>
<table><tr><th>Plateforme</th><th class="n">Cible</th><th class="n">Gain appliqué</th><th class="n">Résultat</th><th>Détail</th></tr>
${input.platforms.map((p) => `<tr><td>${escape(p.name)}</td><td class="n">${fr(p.target)} LUFS</td><td class="n">${fr(p.gain, 1, true)} dB</td><td class="n">${fr(p.result)} LUFS</td><td>${escape(p.note)}</td></tr>`).join('')}
</table>

<h2>Équilibre tonal</h2>
<table><tr><th>Bande</th><th class="n">Énergie (dB)</th><th class="n">Par rapport à la sonie (dB)</th><th class="n">Largeur</th><th class="n">Perte au mono (dB)</th></tr>
${m.bands.map((b, i) => `<tr><td>${BANDS[i]!.label} (${BANDS[i]!.from}–${BANDS[i]!.to} Hz)</td><td class="n">${fr(b.db)}</td><td class="n">${fr(b.relative, 1, true)}</td><td class="n">${pct(b.width)}</td><td class="n">${fr(b.monoLoss)}</td></tr>`).join('')}
</table>

<h2>Sections</h2>
<table><tr><th>Section</th><th class="n">Début</th><th class="n">Fin</th><th class="n">Sonie</th><th class="n">vs morceau</th><th class="n">PLR</th><th class="n">Largeur</th><th class="n">Densité</th></tr>
${sections.map((s) => `<tr><td>${escape(s.section.label)}</td><td class="n">${clock(s.section.start)}</td><td class="n">${clock(s.section.end)}</td><td class="n">${fr(s.measures.integrated)} LUFS</td><td class="n">${fr(s.vsTrack.integrated, 1, true)} LU</td><td class="n">${fr(s.measures.plr)} LU</td><td class="n">${pct(s.measures.width)}</td><td class="n">${fr(s.measures.density)} /s</td></tr>`).join('')}
</table>

<h2>Repères</h2>
<table><tr><th>Type</th><th class="n">Début</th><th class="n">Fin</th><th class="n">Valeur</th></tr>
${list
  .slice(0, 300)
  .map(
    (x) =>
      `<tr><td>${{ over: 'Crête vraie', clip: 'Écrêtage', phase: 'Phase', silence: 'Silence' }[x.kind]}</td><td class="n">${clock(x.start, 2)}</td><td class="n">${clock(x.end, 2)}</td><td class="n">${x.kind === 'over' ? `${fr(x.value, 1, true)} dBTP` : x.kind === 'clip' ? `${x.value} éch.` : x.kind === 'phase' ? fr(x.value, 2) : ''}</td></tr>`,
  )
  .join('')}
</table>
${list.length > 300 ? `<p class="muted">${list.length - 300} repère(s) de plus non listés.</p>` : ''}

<h2>Fichier</h2>
<table>
${row('Format', `${escape(file.format)} (${escape(file.codec)})${file.lossy ? ' — compressé avec perte' : ''}`)}
${row('Fréquence d’échantillonnage', `${file.sampleRate} Hz`)}
${row('Résolution', file.bitDepth ? `${file.bitDepth} bits${file.sampleFormat === 'float' ? ' (virgule flottante)' : ''}` : '—')}
${row('Canaux', String(file.channels))}
${row('Durée', clock(seconds))}
${row('Silence au début / à la fin', `${fr(a.leadingSilence, 2)} s / ${fr(a.trailingSilence, 2)} s`)}
${row('Décalage continu (DC)', a.dc.map((d) => fr(d * 100, 3) + ' %').join(' / '))}
</table>

${
  input.previous
    ? `<h2>Par rapport à ${escape(input.previous.name)}</h2>
<p class="muted">Versions alignées (décalage ${fr(input.previous.comparison.offset, 2, true)} s).</p>
<table>
${row('Sonie intégrée', `${fr(input.previous.comparison.global.integrated, 1, true)} LU`)}
${row('Crête vraie', `${fr(input.previous.comparison.global.truePeak, 1, true)} dB`)}
${row('PLR', `${fr(input.previous.comparison.global.plr, 1, true)} LU`)}
${row('LRA', `${fr(input.previous.comparison.global.lra, 1, true)} LU`)}
${input.previous.comparison.global.bands.map((b, i) => row(BANDS[i]!.label, `${fr(b.db, 1, true)} dB`)).join('')}
</table>`
    : ''
}
</body></html>
`;
}
