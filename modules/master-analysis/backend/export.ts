// Exports of an analysis, all built from the same input so that their numbers
// agree: a self-contained HTML report (tables as text, charts as embedded PNG
// images, no script), a compact Markdown summary to paste into a conversation,
// and the complete data (curves over time as CSV + everything as JSON, in a
// zip). Facts only, like the interface: no interpretation, no advice.
import yazl from 'yazl';
import { clock, fr, pct } from '../shared/format';
import {
  bandCurve,
  type compareReferences,
  type compareVersions,
  dynamicsCurves,
  loudnessCurve,
  markers,
  measures,
  monoLossCurve,
  sectionMeasures,
  widthCurve,
} from '../shared/measures';
import {
  BANDS,
  BLOCK,
  type Analysis,
  type Measures,
  type PlatformResult,
  type Section,
} from '../shared/types';
import {
  contrastsChart,
  spectrogramChart,
  spectrumChart,
  stereoChart,
  timelineChart,
  versionsChart,
} from './charts';

export interface ExportInput {
  title: string;
  version: { name: string; originalName: string; createdAt: string };
  analysis: Analysis;
  sections: Section[];
  threshold: number;
  platforms: PlatformResult[];
  /** Comparison with another version of the project (b = this version), when there is one. */
  versions: {
    other: string;
    comparison: ReturnType<typeof compareVersions>;
    confidence: number;
    manual: boolean;
    measures: { a: Measures; b: Measures };
    overlay: { t: number; a: number | null; b: number | null }[];
  } | null;
  /** Comparison with a profile of references, when one has analysed references. */
  references: {
    profile: string;
    names: string[];
    result: ReturnType<typeof compareReferences>;
  } | null;
  generatedAt: Date;
}

const KIND: Record<string, string> = {
  over: 'Crête vraie',
  clip: 'Écrêtage',
  phase: 'Phase',
  silence: 'Silence',
};

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const markerValue = (x: { kind: string; value: number | null }) =>
  x.kind === 'over'
    ? `${fr(x.value, 1, true)} dBTP`
    : x.kind === 'clip'
      ? `${x.value} éch.`
      : x.kind === 'phase'
        ? fr(x.value, 2)
        : '';

const dateFr = (d: Date) => d.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

type Marker = ReturnType<typeof markers>[number];

/**
 * Markers of a kind merged into zones (less than 2 s apart): a long list of
 * true-peak overs stays readable; the full list is in the appendix / the JSON.
 */
export function zones(list: Marker[]) {
  const out: {
    kind: Marker['kind'];
    start: number;
    end: number;
    count: number;
    worst: number | null;
  }[] = [];
  for (const kind of ['clip', 'over', 'phase', 'silence'] as const) {
    let zone: (typeof out)[number] | null = null;
    for (const x of list.filter((m) => m.kind === kind).sort((p, q) => p.start - q.start)) {
      if (zone && x.start - zone.end < 2) {
        zone.end = Math.max(zone.end, x.end);
        zone.count++;
        if (
          x.value !== null &&
          (zone.worst === null || (kind === 'phase' ? x.value < zone.worst : x.value > zone.worst))
        )
          zone.worst = x.value;
      } else {
        zone = { kind, start: x.start, end: x.end, count: 1, worst: x.value };
        out.push(zone);
      }
    }
  }
  return out;
}

const zoneValue = (z: ReturnType<typeof zones>[number]) =>
  z.worst === null ? '' : markerValue({ kind: z.kind, value: z.worst });

/** Everything the three exports show, computed once. */
function facts(input: ExportInput) {
  const a = input.analysis;
  const m = measures(a);
  const list = markers(a, input.threshold);
  return {
    a,
    m,
    list,
    overs: list.filter((x) => x.kind === 'over'),
    seconds: a.blocks * BLOCK,
    sections: sectionMeasures(a, input.sections),
  };
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

export function htmlReport(input: ExportInput): string {
  const { a, m, list, overs, seconds, sections } = facts(input);
  const file = a.file;
  const table = (head: string[], rows: string[][], numeric: boolean[] = []) =>
    `<table${head.length > 8 ? ' class="wide"' : ''}><tr>${head.map((h, i) => `<th${numeric[i] ? ' class="n"' : ''}>${escape(h)}</th>`).join('')}</tr>${rows
      .map(
        (r) =>
          `<tr>${r.map((c, i) => `<td${numeric[i] ? ' class="n"' : ''}>${escape(c)}</td>`).join('')}</tr>`,
      )
      .join('')}</table>`;
  const pairs = (rows: [string, string][]) => table(['Mesure', 'Valeur'], rows, [false, true]);
  const image = (src: string, alt: string) => `<img src="${src}" alt="${escape(alt)}">`;
  const v = input.versions;
  const r = input.references;
  const zoneList = zones(list);
  const bandCols = BANDS.map((b) => `${b.label} (dB)`);

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Analyse — ${escape(input.title)} — ${escape(input.version.name)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d1d24; background: #fff; margin: 32px auto; max-width: 1000px; padding: 0 16px; line-height: 1.45; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; } h2 { font-size: 1.15rem; margin: 32px 0 10px; border-bottom: 1px solid #e3e3ea; padding-bottom: 4px; }
  h3 { font-size: 1rem; margin: 18px 0 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; margin: 6px 0 12px; } th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #ececf2; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } .muted { color: #6b6b78; font-size: 0.85rem; }
  img { display: block; width: 100%; height: auto; margin: 8px 0 14px; border: 1px solid #ececf2; }
  .head td { border: 0; padding: 2px 12px 2px 0; } .head th { border: 0; padding: 2px 12px 2px 0; color: #6b6b78; font-weight: normal; }
  table.wide { font-size: 0.76rem; } table.wide th, table.wide td { padding: 3px 4px; } table.wide th { white-space: normal; }
  .cols table { font-size: 0.78rem; } .cols td, .cols th { padding: 1px 6px; }
  @media print { body { margin: 0; max-width: none; } h2 { break-after: avoid; } img, table { break-inside: avoid; } }
</style></head><body>
<h1>${escape(input.title)} — ${escape(input.version.name)}</h1>
<table class="head">
<tr><th>Morceau</th><td>${escape(input.title)}</td></tr>
<tr><th>Version</th><td>${escape(input.version.name)}${v ? ` (comparée à ${escape(v.other)})` : ''}</td></tr>
<tr><th>Fichier</th><td>${escape(input.version.originalName)}</td></tr>
<tr><th>Format</th><td>${escape(file.format)} · ${escape(file.codec)} · ${file.sampleRate} Hz${file.bitDepth ? ` · ${file.bitDepth} bits` : ''} · ${file.channels} canal(aux) · ${clock(seconds)}${file.lossy ? ' · compressé avec perte' : ''}</td></tr>
<tr><th>Rapport</th><td>${escape(dateFr(input.generatedAt))}</td></tr>
</table>
<p class="muted">Analyse du master (ToolBox). Mesures seulement : le fichier n’a pas été modifié ; aucune interprétation.</p>

<h2>Chiffres clés</h2>
${pairs([
  ['Sonie intégrée', `${fr(m.integrated)} LUFS`],
  ['Crête vraie maximale', `${fr(m.truePeak, 1, true)} dBTP`],
  ['Plage de sonie (LRA)', `${fr(m.lra)} LU`],
  ['PLR (crête vraie − sonie intégrée)', `${fr(m.plr)} LU`],
  ['Perte au mono', `${fr(m.monoLoss)} dB`],
  [`Dépassements au-dessus de ${fr(input.threshold, 1, true)} dBTP`, String(overs.length)],
  ['Écrêtages', String(a.clipping.length)],
])}

<h2>Ligne de temps</h2>
${image(timelineChart(a, input.sections), 'Forme d’onde, sonie et énergie par bande dans le temps')}
${image(spectrogramChart(a), 'Spectrogramme')}

<h2>Volume et dynamique</h2>
${pairs([
  ['Sonie intégrée (BS.1770-4)', `${fr(m.integrated)} LUFS`],
  ['Plage de sonie (LRA, EBU 3342)', `${fr(m.lra)} LU`],
  ['PLR', `${fr(m.plr)} LU`],
  ['Facteur de crête (crête − RMS)', `${fr(m.crest)} dB`],
  ['RMS', `${fr(m.rms)} dBFS`],
])}
<h3>Normalisation des plateformes</h3>
${table(
  ['Plateforme', 'Cible (LUFS)', 'Gain (dB)', 'Résultat (LUFS)', 'Détail'],
  input.platforms.map((p) => [p.name, fr(p.target), fr(p.gain, 1, true), fr(p.result), p.note]),
  [false, true, true, true, false],
)}
<p class="muted">Gain appliqué par la plateforme à la lecture ; le fichier n’est pas changé.</p>

<h2>Crêtes et saturation</h2>
${pairs([
  ['Crête vraie maximale', `${fr(m.truePeak, 1, true)} dBTP`],
  ['Crête d’échantillon', `${fr(m.samplePeak, 1, true)} dBFS`],
  [`Dépassements au-dessus de ${fr(input.threshold, 1, true)} dBTP`, String(overs.length)],
  ['Écrêtages', String(a.clipping.length)],
  ['Échantillons au-delà de 0 dBFS', String(a.aboveFullScale)],
])}
<h3>Repères : ${list.length}, en ${zoneList.length} zone(s)</h3>
<p class="muted">Repères de même type à moins de 2 s regroupés ; la liste complète est en annexe.</p>
${table(
  ['Type', 'Début', 'Fin', 'Nombre', 'Valeur extrême'],
  zoneList.map((z) => [
    KIND[z.kind]!,
    clock(z.start, 2),
    clock(z.end, 2),
    String(z.count),
    zoneValue(z),
  ]),
  [false, true, true, true, true],
)}

<h2>Fréquences</h2>
${table(
  ['Bande', 'Énergie (dB)', 'Par rapport à la sonie (dB)'],
  m.bands.map((b, i) => [
    `${BANDS[i]!.label} (${BANDS[i]!.from}–${BANDS[i]!.to} Hz)`,
    fr(b.db),
    fr(b.relative, 1, true),
  ]),
  [false, true, true],
)}
${image(
  spectrumChart('Équilibre tonal : spectre moyen', [
    { label: 'Spectre moyen (lissé 1/3 d’octave)', points: a.spectrum },
  ]),
  'Spectre moyen',
)}

<h2>Stéréo et mono</h2>
${pairs([
  ['Corrélation de phase', fr(m.correlation, 2)],
  ['Largeur (part du côté)', pct(m.width)],
  ['Perte au mono', `${fr(m.monoLoss)} dB`],
])}
${table(
  ['Bande', 'Largeur (%)', 'Perte au mono (dB)'],
  m.bands.map((b, i) => [
    BANDS[i]!.label,
    fr(b.width === null ? null : b.width * 100, 0),
    fr(b.monoLoss),
  ]),
  [false, true, true],
)}
${image(stereoChart(a, input.sections), 'Largeur, corrélation et perte au mono dans le temps')}

<h2>Structure et sections</h2>
${table(
  [
    'Section',
    'Début',
    'Fin',
    'Sonie (LUFS)',
    'vs morceau (LU)',
    'PLR (LU)',
    'LRA (LU)',
    'Largeur (%)',
    'Densité (/s)',
  ],
  sections.map((s) => [
    s.section.label,
    clock(s.section.start),
    clock(s.section.end),
    fr(s.measures.integrated),
    fr(s.vsTrack.integrated, 1, true),
    fr(s.measures.plr),
    fr(s.measures.lra),
    fr(s.measures.width === null ? null : s.measures.width * 100, 0),
    fr(s.measures.density),
  ]),
  [false, true, true, true, true, true, true, true, true],
)}
<h3>Contrastes entre sections (par rapport au morceau entier)</h3>
${table(
  ['Section', 'Sonie (LU)', ...bandCols],
  sections.map((s) => [
    s.section.label,
    fr(s.vsTrack.integrated, 1, true),
    ...s.vsTrack.bands.map((b) => fr(b.db, 1, true)),
  ]),
  [false, true, ...BANDS.map(() => true)],
)}
${image(
  contrastsChart(
    sections.map((s) => ({
      label: s.section.label,
      values: [s.vsTrack.integrated, ...s.vsTrack.bands.map((b) => b.db)],
    })),
    ['Sonie', ...BANDS.map((b) => b.label)],
  ),
  'Contrastes entre sections',
)}

<h2>Fichier</h2>
${pairs([
  ['Format', `${file.format} · ${file.codec}${file.lossy ? ' (avec perte)' : ' (sans perte)'}`],
  ['Fréquence', `${file.sampleRate} Hz`],
  [
    'Résolution',
    file.bitDepth
      ? `${file.bitDepth} bits${file.sampleFormat === 'float' ? ' (virgule flottante)' : ''}`
      : '—',
  ],
  ['Canaux', String(file.channels)],
  ['Durée', clock(seconds)],
  ['Silence au début / à la fin', `${fr(a.leadingSilence, 2)} s / ${fr(a.trailingSilence, 2)} s`],
  ['Décalage continu (DC)', a.dc.map((d) => `${fr(d * 100, 3)} %`).join(' / ')],
])}
${
  v
    ? `<h2>Écarts avec ${escape(v.other)}</h2>
<p class="muted">Écarts de ${escape(input.version.name)} par rapport à ${escape(v.other)} ; versions alignées (décalage ${fr(v.comparison.offset, 2, true)} s, ${v.manual ? 'réglé à la main' : `trouvé automatiquement, confiance ${pct(v.confidence)}`}).</p>
${table(
  ['Mesure', v.other, input.version.name, 'Écart'],
  (
    [
      ['Sonie intégrée', 'integrated', 'LUFS', 'LU'],
      ['Crête vraie', 'truePeak', 'dBTP', 'dB'],
      ['PLR', 'plr', 'LU', 'LU'],
      ['LRA', 'lra', 'LU', 'LU'],
      ['Facteur de crête', 'crest', 'dB', 'dB'],
      ['Perte au mono', 'monoLoss', 'dB', 'dB'],
    ] as const
  ).map(([label, key, unit, du]) => {
    const x = v.measures.a[key];
    const y = v.measures.b[key];
    return [
      label,
      `${fr(x)} ${unit}`,
      `${fr(y)} ${unit}`,
      x === null || y === null ? '—' : `${fr(y - x, 1, true)} ${du}`,
    ];
  }),
  [false, true, true, true],
)}
${table(
  ['Bande', 'Écart (dB)'],
  v.comparison.global.bands.map((b, i) => [BANDS[i]!.label, fr(b.db, 1, true)]),
  [false, true],
)}
<h3>Par section (sections de ${escape(v.other)})</h3>
${table(
  ['Section', 'Sonie (LU)', 'Crête vraie (dB)', 'PLR (LU)', ...bandCols],
  v.comparison.sections.map(({ section, difference: d }) => [
    section.label,
    fr(d.integrated, 1, true),
    fr(d.truePeak, 1, true),
    fr(d.plr, 1, true),
    ...d.bands.map((b) => fr(b.db, 1, true)),
  ]),
  [false, true, true, true, ...BANDS.map(() => true)],
)}
${image(versionsChart(v.overlay, { a: v.other, b: input.version.name }), 'Sonie court terme des deux versions')}`
    : ''
}
${
  r
    ? `<h2>Écarts avec les références (profil « ${escape(r.profile)} »)</h2>
<p class="muted">Références : ${r.names.map(escape).join(', ')}. Équilibre comparé à sonie égale (les références ramenées à la sonie du master pour le calcul seulement).</p>
${table(
  ['Mesure', 'Master', 'Références (moyenne)'],
  [
    [
      'Sonie intégrée (LUFS)',
      fr(r.result.global.integrated.track),
      fr(r.result.global.integrated.references),
    ],
    [
      'Crête vraie (dBTP)',
      fr(r.result.global.truePeak.track, 1, true),
      fr(r.result.global.truePeak.references, 1, true),
    ],
    ['PLR (LU)', fr(r.result.global.plr.track), fr(r.result.global.plr.references)],
    ['LRA (LU)', fr(r.result.global.lra.track), fr(r.result.global.lra.references)],
    ['Largeur', pct(r.result.global.width.track), pct(r.result.global.width.references)],
    [
      'Corrélation',
      fr(r.result.global.correlation.track, 2),
      fr(r.result.global.correlation.references, 2),
    ],
  ],
  [false, true, true],
)}
${table(
  ['Bande', 'Écart du master (dB)'],
  r.result.bands.map((b) => [b.label, fr(b.difference, 1, true)]),
  [false, true],
)}
${table(
  ['Section', 'Sonie master / réf. (LUFS)', ...bandCols],
  r.result.sections.map((s) => [
    s.section.label,
    `${fr(s.integrated.track)} / ${fr(s.integrated.references)}`,
    ...s.bands.map((b) => fr(b.difference, 1, true)),
  ]),
  [false, true, ...BANDS.map(() => true)],
)}
${image(
  spectrumChart('Tiers d’octave à sonie égale', [
    { label: 'Master', points: r.result.thirdOctave.map((p) => ({ f: p.f, db: p.track })) },
    {
      label: 'Références (moyenne)',
      points: r.result.thirdOctave.map((p) => ({ f: p.f, db: p.references })),
    },
  ]),
  'Tiers d’octave du master et des références',
)}`
    : ''
}
${
  list.length
    ? `<h2>Annexe : tous les repères (${list.length})</h2>
<div class="cols">${table(
        ['Type', 'Début', 'Durée (s)', 'Valeur'],
        list.map((x) => [
          `${KIND[x.kind]}${x.channel !== undefined ? ` (${x.channel === 0 ? 'G' : 'D'})` : ''}`,
          clock(x.start, 2),
          fr(x.end - x.start, 2),
          markerValue(x),
        ]),
        [false, true, true, true],
      )}</div>`
    : ''
}
</body></html>
`;
}

// ---------------------------------------------------------------------------
// Markdown summary (to paste into a conversation)
// ---------------------------------------------------------------------------

export function markdownSummary(input: ExportInput): string {
  const { a, m, list, overs, seconds, sections } = facts(input);
  const file = a.file;
  const lines: string[] = [];
  const row = (cells: string[]) => lines.push(`| ${cells.join(' | ')} |`);
  const head = (cells: string[]) => {
    row(cells);
    row(cells.map(() => '---'));
  };
  lines.push(`# Analyse du master — ${input.title} — ${input.version.name}`);
  lines.push('');
  lines.push(
    `Fichier : ${input.version.originalName} · ${file.format} ${file.codec} · ${file.sampleRate} Hz${file.bitDepth ? ` · ${file.bitDepth} bits` : ''} · ${file.channels} canal(aux) · ${clock(seconds)}${file.lossy ? ' · avec perte' : ''}. Rapport du ${dateFr(input.generatedAt)}. Mesures seulement (ToolBox).`,
  );
  lines.push('');
  lines.push('## Chiffres clés');
  lines.push(
    `- Sonie intégrée ${fr(m.integrated)} LUFS · LRA ${fr(m.lra)} LU · PLR ${fr(m.plr)} LU · facteur de crête ${fr(m.crest)} dB · RMS ${fr(m.rms)} dBFS`,
  );
  lines.push(
    `- Crête vraie ${fr(m.truePeak, 1, true)} dBTP · crête d’échantillon ${fr(m.samplePeak, 1, true)} dBFS · ${overs.length} dépassement(s) au-dessus de ${fr(input.threshold, 1, true)} dBTP · ${a.clipping.length} écrêtage(s)`,
  );
  lines.push(
    `- Corrélation ${fr(m.correlation, 2)} · largeur ${pct(m.width)} · perte au mono ${fr(m.monoLoss)} dB`,
  );
  lines.push(
    `- Silence début / fin ${fr(a.leadingSilence, 2)} s / ${fr(a.trailingSilence, 2)} s · DC ${a.dc.map((d) => `${fr(d * 100, 3)} %`).join(' / ')}`,
  );
  lines.push('');
  lines.push('## Plateformes (gain à la lecture)');
  lines.push(
    input.platforms
      .map(
        (p) => `${p.name} ${fr(p.gain, 1, true)} dB → ${fr(p.result)} LUFS (cible ${fr(p.target)})`,
      )
      .join(' · '),
  );
  lines.push('');
  lines.push('## Bandes');
  head(['Bande', 'Énergie dB', 'vs sonie dB', 'Largeur %', 'Mono dB']);
  m.bands.forEach((b, i) =>
    row([
      `${BANDS[i]!.label} ${BANDS[i]!.from}–${BANDS[i]!.to} Hz`,
      fr(b.db),
      fr(b.relative, 1, true),
      fr(b.width === null ? null : b.width * 100, 0),
      fr(b.monoLoss),
    ]),
  );
  lines.push('');
  lines.push('## Sections');
  head([
    'Section',
    'Début',
    'Fin',
    'Sonie LUFS',
    'vs morceau LU',
    'PLR',
    'LRA',
    'Largeur %',
    'Densité /s',
  ]);
  for (const s of sections)
    row([
      s.section.label,
      clock(s.section.start, 0),
      clock(s.section.end, 0),
      fr(s.measures.integrated),
      fr(s.vsTrack.integrated, 1, true),
      fr(s.measures.plr),
      fr(s.measures.lra),
      fr(s.measures.width === null ? null : s.measures.width * 100, 0),
      fr(s.measures.density),
    ]);
  lines.push('');
  lines.push('## Contrastes (section − morceau entier)');
  head(['Section', 'Sonie LU', ...BANDS.map((b) => `${b.label} dB`)]);
  for (const s of sections)
    row([
      s.section.label,
      fr(s.vsTrack.integrated, 1, true),
      ...s.vsTrack.bands.map((b) => fr(b.db, 1, true)),
    ]);
  lines.push('');
  const zoneList = zones(list);
  lines.push(
    `## Repères (${list.length}, en ${zoneList.length} zone(s) : moins de 2 s d’écart regroupé)`,
  );
  if (zoneList.length === 0) lines.push('Aucun.');
  else
    for (const kind of ['clip', 'over', 'phase', 'silence'] as const) {
      const of = zoneList.filter((z) => z.kind === kind);
      if (!of.length) continue;
      lines.push(
        `- ${KIND[kind]} (${list.filter((x) => x.kind === kind).length}) : ${of
          .map(
            (z) =>
              `${clock(z.start, 1)}${z.count > 1 ? `–${clock(z.end, 1)} (${z.count})` : ''}${zoneValue(z) ? ` ${zoneValue(z)}` : ''}`,
          )
          .join(', ')}`,
      );
    }
  const v = input.versions;
  if (v) {
    lines.push('');
    lines.push(`## Écarts avec ${v.other} (${input.version.name} − ${v.other})`);
    lines.push(
      `Décalage ${fr(v.comparison.offset, 2, true)} s (${v.manual ? 'manuel' : `confiance ${pct(v.confidence)}`}). Sonie ${fr(v.comparison.global.integrated, 1, true)} LU · crête vraie ${fr(v.comparison.global.truePeak, 1, true)} dB · PLR ${fr(v.comparison.global.plr, 1, true)} LU · LRA ${fr(v.comparison.global.lra, 1, true)} LU`,
    );
    lines.push(
      `Bandes : ${v.comparison.global.bands.map((b, i) => `${BANDS[i]!.label} ${fr(b.db, 1, true)}`).join(' · ')} dB`,
    );
    head(['Section', 'Sonie LU', 'Crête dB', 'PLR LU', ...BANDS.map((b) => `${b.label} dB`)]);
    for (const { section, difference: d } of v.comparison.sections)
      row([
        section.label,
        fr(d.integrated, 1, true),
        fr(d.truePeak, 1, true),
        fr(d.plr, 1, true),
        ...d.bands.map((b) => fr(b.db, 1, true)),
      ]);
  }
  const r = input.references;
  if (r) {
    const g = r.result.global;
    lines.push('');
    lines.push(`## Écarts avec les références (profil « ${r.profile} » : ${r.names.join(', ')})`);
    lines.push(
      `Master / références : sonie ${fr(g.integrated.track)} / ${fr(g.integrated.references)} LUFS · crête vraie ${fr(g.truePeak.track, 1, true)} / ${fr(g.truePeak.references, 1, true)} dBTP · PLR ${fr(g.plr.track)} / ${fr(g.plr.references)} LU · LRA ${fr(g.lra.track)} / ${fr(g.lra.references)} LU · largeur ${pct(g.width.track)} / ${pct(g.width.references)} · corrélation ${fr(g.correlation.track, 2)} / ${fr(g.correlation.references, 2)}`,
    );
    lines.push(
      `Bandes à sonie égale (master − références) : ${r.result.bands.map((b) => `${b.label} ${fr(b.difference, 1, true)}`).join(' · ')} dB`,
    );
    head(['Section', 'Sonie master / réf.', ...BANDS.map((b) => `${b.label} dB`)]);
    for (const s of r.result.sections)
      row([
        s.section.label,
        `${fr(s.integrated.track)} / ${fr(s.integrated.references)}`,
        ...s.bands.map((b) => fr(b.difference, 1, true)),
      ]);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Complete data: curves (CSV, every 100 ms) + everything (JSON), in a zip
// ---------------------------------------------------------------------------

const num = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(digits);

/** One row per 100 ms block. Decimal point « . » and « ; » separator (opens in Excel FR). */
export function curvesCsv(a: Analysis): string {
  const momentary = loudnessCurve(a, 'momentary');
  const short = loudnessCurve(a, 'short');
  const { crest, plr } = dynamicsCurves(a);
  const bands = BANDS.map((_, b) => bandCurve(a, b, 1));
  const width = widthCurve(a, null, 1);
  const mono = monoLossCurve(a, 1);
  const header = [
    'temps_s',
    'sonie_momentanee_lufs',
    'sonie_court_terme_lufs',
    'crete_vraie_dbtp',
    'crete_echantillon_dbfs',
    'facteur_crete_1s_db',
    'plr_3s_lu',
    ...BANDS.map((b) => `energie_${b.id}_db`),
    'largeur',
    'correlation',
    'perte_mono_db',
    'densite_par_s',
  ];
  const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : null);
  const rows = [header.join(';')];
  for (let i = 0; i < a.blocks; i++)
    rows.push(
      [
        num(i * BLOCK, 1),
        num(momentary[i]),
        num(short[i]),
        num(db(a.truePeak[i]!)),
        num(db(a.peak[i]!)),
        num(crest[i]),
        num(plr[i]),
        ...bands.map((c) => num(c[i])),
        num(width[i], 4),
        num(a.meanSquare[i]! > 1e-9 ? a.correlation[i] : null, 4),
        num(mono[i]),
        num(a.density[i], 2),
      ].join(';'),
    );
  return `${rows.join('\n')}\n`;
}

/** Everything the report shows, as numbers (no rounding beyond the measure itself). */
export function exportJson(input: ExportInput) {
  const { a, m, list, sections } = facts(input);
  return {
    generator: 'ToolBox — Analyse du master',
    generatedAt: input.generatedAt.toISOString(),
    track: input.title,
    version: input.version,
    file: a.file,
    durationSec: a.blocks * BLOCK,
    threshold: input.threshold,
    measures: m,
    bands: BANDS.map((b, i) => ({ ...b, ...m.bands[i] })),
    platforms: input.platforms,
    hygiene: {
      leadingSilence: a.leadingSilence,
      trailingSilence: a.trailingSilence,
      dc: a.dc,
      aboveFullScale: a.aboveFullScale,
      clipping: a.clipping,
    },
    markers: list,
    sections: sections.map((s) => ({ ...s.section, measures: s.measures, vsTrack: s.vsTrack })),
    spectrum: a.spectrum,
    thirdOctave: a.thirdOctave,
    versions: input.versions
      ? {
          other: input.versions.other,
          offset: input.versions.comparison.offset,
          confidence: input.versions.confidence,
          manual: input.versions.manual,
          measures: input.versions.measures,
          global: input.versions.comparison.global,
          sections: input.versions.comparison.sections,
        }
      : null,
    references: input.references
      ? {
          profile: input.references.profile,
          names: input.references.names,
          global: input.references.result.global,
          bands: input.references.result.bands,
          sections: input.references.result.sections,
          thirdOctave: input.references.result.thirdOctave,
        }
      : null,
  };
}

/** The zip: courbes.csv + analyse.json + LISEZMOI.txt. */
export function dataZip(input: ExportInput): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(curvesCsv(input.analysis), 'utf8'), 'courbes.csv');
  zip.addBuffer(Buffer.from(JSON.stringify(exportJson(input), null, 2), 'utf8'), 'analyse.json');
  zip.addBuffer(
    Buffer.from(
      [
        `Analyse du master — ${input.title} — ${input.version.name} (ToolBox)`,
        '',
        'courbes.csv : une ligne par bloc de 100 ms (séparateur « ; », point décimal).',
        '  Sonie momentanée et court terme (LUFS), crêtes (dBTP, dBFS), facteur de crête (1 s) et PLR (3 s),',
        '  énergie des 7 bandes (dB, sans lissage), largeur (0 mono, 0,5 sans lien, 1 opposition),',
        '  corrélation (−1 à +1), perte au mono (dB), densité (attaques par seconde).',
        'analyse.json : toutes les mesures du rapport (globales, bandes, plateformes, repères, sections,',
        '  spectre, écarts avec une autre version et avec les références quand il y en a).',
        '',
      ].join('\r\n'),
      'utf8',
    ),
    'LISEZMOI.txt',
  );
  zip.end();
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => parts.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(parts)));
    zip.outputStream.on('error', reject);
  });
}
