// « Mesures globales »: the numbers of the whole track, grouped by question
// (volume and dynamics, peaks and saturation, frequencies, stereo and mono,
// structure, file). A few key figures first, the detail folded below.
// Numbers and facts only.
import { Button } from '@hub/sdk/frontend';
import { clock, fr, pct } from '../shared/format';
import { markers, measures, sectionMeasures } from '../shared/measures';
import { BANDS, BLOCK, type Analysis, type PlatformResult, type Section } from '../shared/types';
import { SpectrumChart } from './charts';
import { Help } from './guide/Help';
import { Group } from './layout';
import { BAND_TOKENS, useColors } from './theme';

const KIND: Record<string, string> = {
  over: 'Crête vraie',
  clip: 'Écrêtage',
  phase: 'Phase',
  silence: 'Silence',
};

export function Global(props: {
  analysis: Analysis;
  threshold: number;
  platforms: PlatformResult[];
  sections: Section[];
  onSeek: (t: number) => void;
  onOpenSections: () => void;
}) {
  const a = props.analysis;
  const m = measures(a);
  const colors = useColors();
  const list = markers(a, props.threshold);
  const overs = list.filter((x) => x.kind === 'over').length;
  const parts = sectionMeasures(a, props.sections);
  const file = a.file;
  const row = (label: string, value: string, hint?: string, topic?: string) => (
    <tr>
      <th>
        {label}
        {topic && <Help topic={topic} />}
      </th>
      <td className="num">{value}</td>
      <td className="small muted">{hint}</td>
    </tr>
  );
  return (
    <div className="ma-groups">
      <Group
        title="Volume et dynamique"
        topic="sonie"
        figures={[
          { label: 'Sonie intégrée', value: fr(m.integrated), unit: 'LUFS', topic: 'sonie' },
          { label: 'LRA', value: fr(m.lra), unit: 'LU', topic: 'lra' },
          { label: 'PLR', value: fr(m.plr), unit: 'LU', topic: 'plr' },
          { label: 'Facteur de crête', value: fr(m.crest), unit: 'dB', topic: 'facteur-crete' },
        ]}
        detail={
          <table className="ma-table">
            <tbody>
              {row(
                'Sonie intégrée',
                `${fr(m.integrated)} LUFS`,
                'BS.1770-4, portes −70 LUFS et −10 LU',
                'sonie',
              )}
              {row('Plage de sonie (LRA)', `${fr(m.lra)} LU`, 'EBU Tech 3342', 'lra')}
              {row('PLR', `${fr(m.plr)} LU`, 'crête vraie − sonie intégrée', 'plr')}
              {row('Facteur de crête', `${fr(m.crest)} dB`, 'crête − RMS', 'facteur-crete')}
              {row('RMS', `${fr(m.rms)} dBFS`, undefined, 'facteur-crete')}
            </tbody>
          </table>
        }
      >
        <h4>
          Normalisation des plateformes <Help topic="normalisation" />
        </h4>
        <table className="ma-table">
          <thead>
            <tr>
              <th>Plateforme</th>
              <th className="num">Cible (LUFS)</th>
              <th className="num">Gain (dB)</th>
              <th className="num">Résultat (LUFS)</th>
            </tr>
          </thead>
          <tbody>
            {props.platforms.map((p) => (
              <tr key={p.name} title={p.note}>
                <th>
                  {p.name}
                  <div className="small muted">{p.note}</div>
                </th>
                <td className="num">{fr(p.target)}</td>
                <td className="num">{fr(p.gain, 1, true)}</td>
                <td className="num">{fr(p.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ma-note">
          Gain appliqué par la plateforme à la lecture ; le fichier n’est pas changé. Cibles
          modifiables dans les réglages du module.
        </p>
      </Group>

      <Group
        title="Crêtes et saturation"
        topic="crete-vraie"
        figures={[
          {
            label: 'Crête vraie max.',
            value: fr(m.truePeak, 1, true),
            unit: 'dBTP',
            topic: 'crete-vraie',
          },
          {
            label: 'Crête d’échantillon',
            value: fr(m.samplePeak, 1, true),
            unit: 'dBFS',
            topic: 'ecretage',
          },
          {
            label: 'Dépassements',
            value: String(overs),
            sub: `au-dessus de ${fr(props.threshold, 1, true)} dBTP`,
            topic: 'reperes',
          },
          { label: 'Écrêtages', value: String(a.clipping.length), topic: 'ecretage' },
        ]}
        detailLabel={`la liste des repères (${list.length})`}
        detail={
          list.length === 0 ? (
            <p className="muted">Aucun repère.</p>
          ) : (
            <table className="ma-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="num">Début</th>
                  <th className="num">Durée (s)</th>
                  <th className="num">Valeur</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 500).map((x, i) => (
                  <tr key={i}>
                    <td>
                      {KIND[x.kind]}
                      {x.channel !== undefined ? ` (canal ${x.channel === 0 ? 'G' : 'D'})` : ''}
                    </td>
                    <td className="num">{clock(x.start, 2)}</td>
                    <td className="num">{fr(x.end - x.start, 2)}</td>
                    <td className="num">
                      {x.kind === 'over'
                        ? `${fr(x.value, 1, true)} dBTP`
                        : x.kind === 'clip'
                          ? `${x.value} éch.`
                          : x.kind === 'phase'
                            ? fr(x.value, 2)
                            : ''}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ma-link small"
                        onClick={() => props.onSeek(Math.max(0, x.start - 1))}
                      >
                        Écouter
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      />

      <Group
        title="Fréquences"
        topic="bandes"
        wide
        detailLabel="le spectre moyen"
        detail={
          <>
            <p className="ma-note">
              Spectre moyen <Help topic="spectre" />
            </p>
            <SpectrumChart
              ariaLabel="Spectre moyen lissé au tiers d’octave"
              series={[
                {
                  label: 'Spectre moyen (lissé 1/3 d’octave)',
                  points: a.spectrum,
                  color: colors['series-1'],
                },
                {
                  label: 'Bandes de tiers d’octave',
                  points: a.thirdOctave,
                  color: colors['series-3'],
                  dashed: true,
                },
              ]}
            />
          </>
        }
      >
        <table className="ma-table">
          <thead>
            <tr>
              <th>Bande</th>
              <th className="num">Énergie (dB)</th>
              <th className="num">Par rapport à la sonie (dB)</th>
            </tr>
          </thead>
          <tbody>
            {m.bands.map((b, i) => (
              <tr key={b.id}>
                <th className="ma-band-name">
                  <i
                    className="ma-swatch"
                    style={{
                      background: colors[BAND_TOKENS[i]!],
                      borderColor: colors[BAND_TOKENS[i]!],
                    }}
                  />{' '}
                  {BANDS[i]!.label}{' '}
                  <span className="muted small">
                    {BANDS[i]!.from}–{BANDS[i]!.to} Hz
                  </span>
                </th>
                <td className="num">{fr(b.db)}</td>
                <td className="num">{fr(b.relative, 1, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Group>

      <Group
        title="Stéréo et mono"
        topic="largeur"
        figures={[
          {
            label: 'Corrélation',
            value: fr(m.correlation, 2),
            sub: '1 = mono · 0 = sans lien · −1 = opposition',
            topic: 'correlation',
          },
          { label: 'Largeur', value: pct(m.width), sub: 'part du côté (S)', topic: 'largeur' },
          { label: 'Perte au mono', value: fr(m.monoLoss), unit: 'dB', topic: 'mono' },
        ]}
        detailLabel="le détail par bande"
        detail={
          <table className="ma-table">
            <thead>
              <tr>
                <th>Bande</th>
                <th className="num">Largeur (%)</th>
                <th className="num">Perte au mono (dB)</th>
              </tr>
            </thead>
            <tbody>
              {m.bands.map((b, i) => (
                <tr key={b.id}>
                  <th>{BANDS[i]!.label}</th>
                  <td className="num">{fr(b.width === null ? null : b.width * 100, 0)}</td>
                  <td className="num">{fr(b.monoLoss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />

      <Group
        title="Structure et sections"
        topic="vue-sections"
        figures={[
          { label: 'Sections', value: String(parts.length), topic: 'vue-sections' },
          { label: 'Durée', value: clock(a.blocks * BLOCK, 0) },
        ]}
      >
        <table className="ma-table">
          <thead>
            <tr>
              <th>Section</th>
              <th className="num">Début</th>
              <th className="num">Sonie (LUFS)</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(({ section, measures: s }, i) => (
              <tr key={`${section.start}-${i}`}>
                <th>
                  <button
                    type="button"
                    className="ma-link"
                    onClick={() => props.onSeek(section.start)}
                  >
                    {section.label}
                  </button>
                </th>
                <td className="num">{clock(section.start, 0)}</td>
                <td className="num">{fr(s.integrated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ma-details">
          <Button variant="secondary" small onClick={props.onOpenSections}>
            Ouvrir la vue Sections
          </Button>
        </div>
      </Group>

      <Group
        title="Fichier"
        topic="hygiene"
        figures={[
          { label: 'Format', value: file.format, sub: file.lossy ? 'avec perte' : 'sans perte' },
          { label: 'Fréquence', value: String(file.sampleRate), unit: 'Hz' },
          {
            label: 'Résolution',
            value: file.bitDepth ? String(file.bitDepth) : '—',
            unit: file.bitDepth ? 'bits' : undefined,
            sub: file.sampleFormat === 'float' ? 'virgule flottante' : undefined,
          },
          { label: 'Canaux', value: String(file.channels) },
        ]}
        detail={
          <table className="ma-table">
            <tbody>
              {row(
                'Format',
                `${file.format} · ${file.codec}`,
                file.lossy ? 'compressé avec perte' : 'sans perte',
                'hygiene',
              )}
              {row(
                'Canaux',
                String(file.channels),
                file.channels > 2 ? 'mixés en stéréo pour l’analyse' : undefined,
              )}
              {row('Durée', clock(a.blocks * BLOCK))}
              {row('Silence au début', `${fr(a.leadingSilence, 2)} s`, 'sous −60 dBFS')}
              {row('Silence à la fin', `${fr(a.trailingSilence, 2)} s`)}
              {row('Décalage continu (DC)', a.dc.map((d) => `${fr(d * 100, 3)} %`).join(' / '))}
              {row(
                'Échantillons au-delà de 0 dBFS',
                String(a.aboveFullScale),
                file.sampleFormat === 'float'
                  ? undefined
                  : 'possible seulement en virgule flottante',
              )}
            </tbody>
          </table>
        }
      />
    </div>
  );
}
