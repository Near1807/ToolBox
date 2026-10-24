// The light summary of an analysis (database, lists, badges, assistant), the
// quick check before a generation, and the sentences of the assistant.
import { markers, measures, type Difference } from '../shared/measures';
import { clock, fr, pct } from '../shared/format';
import { BANDS, type Analysis, type QuickCheck } from '../shared/types';
import type { AnalysisSummary } from './store';

export function summaryOf(a: Analysis, threshold: number): AnalysisSummary {
  const m = measures(a);
  const list = markers(a, threshold);
  return {
    integrated: m.integrated,
    lra: m.lra,
    truePeak: m.truePeak,
    samplePeak: m.samplePeak,
    plr: m.plr,
    crest: m.crest,
    correlation: m.correlation,
    width: m.width,
    monoLoss: m.monoLoss,
    durationSec: a.blocks * 0.1,
    sampleRate: a.file.sampleRate,
    bitDepth: a.file.bitDepth,
    channels: a.file.channels,
    codec: a.file.codec,
    format: a.file.format,
    overs: list
      .filter((x) => x.kind === 'over')
      .map((x) => ({ start: x.start, end: x.end, value: x.value })),
    clips: a.clipping.length,
    leadingSilence: a.leadingSilence,
    trailingSilence: a.trailingSilence,
    dc: a.dc,
    bands: m.bands.map((b) => ({ id: b.id, db: b.db, relative: b.relative })),
  };
}

/** « −9,1 LUFS · +0,3 dBTP » */
export const badgeOf = (s: AnalysisSummary) =>
  `${fr(s.integrated)} LUFS · ${fr(s.truePeak, 1, true)} dBTP`;

/** What the quick check reports: facts only, nothing blocks. */
export function quickIssues(a: Analysis): QuickCheck['issues'] {
  const m = measures(a);
  const issues: QuickCheck['issues'] = [];
  if (m.truePeak !== null && m.truePeak > 0)
    issues.push({
      kind: 'truePeak',
      text: `Crête vraie à ${fr(m.truePeak, 1, true)} dBTP (au-dessus de 0 dBTP).`,
    });
  if (a.clipping.length > 0)
    issues.push({
      kind: 'clipping',
      text: `${a.clipping.length} écrêtage(s), le premier à ${clock(a.clipping[0]!.time)}.`,
    });
  const silences = markers(a).filter((x) => x.kind === 'silence');
  const long = silences.filter((s) =>
    s.start === 0
      ? s.end - s.start >= 2
      : s.end >= a.blocks * 0.1 - 0.05
        ? s.end - s.start >= 5
        : s.end - s.start >= 3,
  );
  for (const s of long)
    issues.push({
      kind: 'silence',
      text:
        s.start === 0
          ? `Silence de ${fr(s.end - s.start)} s au début.`
          : s.end >= a.blocks * 0.1 - 0.05
            ? `Silence de ${fr(s.end - s.start)} s à la fin.`
            : `Silence de ${fr(s.end - s.start)} s à ${clock(s.start, 0)}.`,
    });
  const phase = markers(a).filter((x) => x.kind === 'phase');
  const phaseSeconds = phase.reduce((sum, p) => sum + p.end - p.start, 0);
  if (
    (m.correlation !== null && m.correlation < 0) ||
    (m.monoLoss !== null && m.monoLoss < -6) ||
    phaseSeconds >= 1
  )
    issues.push({
      kind: 'mono',
      text: `Mono : corrélation ${fr(m.correlation, 2)}, le mono perd ${fr(-(m.monoLoss ?? 0))} dB${phaseSeconds >= 1 ? ` ; ${fr(phaseSeconds)} s en opposition de phase` : ''}.`,
    });
  return issues;
}

/** Sentence of the assistant about a version (facts only). */
export function describe(
  trackName: string,
  versionName: string,
  s: AnalysisSummary,
  threshold: number,
): string {
  const overs = s.overs.length;
  return [
    `${trackName}, ${versionName} : ${fr(s.integrated)} LUFS intégrés, crête vraie ${fr(s.truePeak, 1, true)} dBTP, PLR ${fr(s.plr)} LU, LRA ${fr(s.lra)} LU.`,
    overs
      ? `${overs} dépassement(s) au-dessus de ${fr(threshold, 1, true)} dBTP.`
      : `Aucun dépassement au-dessus de ${fr(threshold, 1, true)} dBTP.`,
    s.clips ? `${s.clips} écrêtage(s).` : 'Aucun écrêtage.',
    `Corrélation ${fr(s.correlation, 2)}, largeur ${pct(s.width)}.`,
  ].join(' ');
}

export function describePeaks(trackName: string, s: AnalysisSummary, threshold: number): string {
  if (s.overs.length === 0)
    return `${trackName} : aucun passage au-dessus de ${fr(threshold, 1, true)} dBTP ; la crête vraie la plus haute est ${fr(s.truePeak, 1, true)} dBTP.`;
  const top = [...s.overs].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]!;
  const first = s.overs.slice(0, 5).map((o) => `${clock(o.start, 0)} (${fr(o.value, 1, true)})`);
  return `${trackName} : ${s.overs.length} passage(s) au-dessus de ${fr(threshold, 1, true)} dBTP : ${first.join(', ')}${s.overs.length > 5 ? '…' : ''}. Le plus haut : ${fr(top.value, 1, true)} dBTP à ${clock(top.start, 0)}.`;
}

export function describeDifference(a: string, b: string, d: Difference, offset: number): string {
  const bands = d.bands
    .map((x, i) => ({ label: BANDS[i]!.label.toLowerCase(), v: x.db }))
    .filter((x) => x.v !== null && Math.abs(x.v) >= 0.5)
    .sort((x, y) => Math.abs(y.v!) - Math.abs(x.v!))
    .slice(0, 3)
    .map((x) => `${x.label} ${fr(x.v, 1, true)} dB`);
  return `${b} par rapport à ${a} : intégrée ${fr(d.integrated, 1, true)} LU, crête vraie ${fr(d.truePeak, 1, true)} dB, PLR ${fr(d.plr, 1, true)} LU, LRA ${fr(d.lra, 1, true)} LU${bands.length ? `, ${bands.join(', ')}` : ', bandes à moins de 0,5 dB'}. Décalage ${fr(offset, 2, true)} s.`;
}
