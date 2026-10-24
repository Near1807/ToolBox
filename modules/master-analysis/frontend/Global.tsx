// « Mesures globales »: loudness, dynamics, peaks, stereo and mono, tonal
// balance, platform normalisation, technical hygiene, the list of markers.
// Numbers and facts only.
import { clock, fr, pct } from '../shared/format';
import { markers, measures } from '../shared/measures';
import { BANDS, BLOCK, type Analysis, type PlatformResult } from '../shared/types';
import { SpectrumChart } from './charts';
import { Help } from './guide/Help';
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
  onSeek: (t: number) => void;
}) {
  const a = props.analysis;
  const m = measures(a);
  const colors = useColors();
  const list = markers(a, props.threshold);
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
    <div className="ma-panels">
      <section className="card">
        <h3>
          Sonie et dynamique <Help topic="sonie" />
        </h3>
        <table className="ma-table">
          <tbody>
            {row(
              'Sonie intégrée',
              `${fr(m.integrated)} LUFS`,
              'BS.1770-4, portes −70 LUFS et −10 LU',
              'sonie',
            )}
            {row('Plage de sonie (LRA)', `${fr(m.lra)} LU`, 'EBU Tech 3342', 'lra')}
            {row(
              'Crête vraie maximale',
              `${fr(m.truePeak, 1, true)} dBTP`,
              'suréchantillonnage ×4',
              'crete-vraie',
            )}
            {row('Crête d’échantillon', `${fr(m.samplePeak, 1, true)} dBFS`, undefined, 'ecretage')}
            {row('PLR', `${fr(m.plr)} LU`, 'crête vraie − sonie intégrée', 'plr')}
            {row('Facteur de crête', `${fr(m.crest)} dB`, 'crête − RMS', 'facteur-crete')}
            {row('RMS', `${fr(m.rms)} dBFS`, undefined, 'facteur-crete')}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>
          Stéréo et mono <Help topic="largeur" />
        </h3>
        <table className="ma-table">
          <tbody>
            {row(
              'Corrélation de phase',
              fr(m.correlation, 2),
              '1 = mono, 0 = sans lien, −1 = opposition',
              'correlation',
            )}
            {row('Largeur', pct(m.width), 'part du côté (S) dans l’énergie', 'largeur')}
            {row(
              'Perte au mono',
              `${fr(m.monoLoss)} dB`,
              'niveau de la somme mono par rapport à la stéréo',
              'mono',
            )}
          </tbody>
        </table>
        <table className="ma-table">
          <thead>
            <tr>
              <th>Bande</th>
              <th className="num">Largeur</th>
              <th className="num">Perte au mono</th>
            </tr>
          </thead>
          <tbody>
            {m.bands.map((b, i) => (
              <tr key={b.id}>
                <td>{BANDS[i]!.label}</td>
                <td className="num">{pct(b.width)}</td>
                <td className="num">{fr(b.monoLoss)} dB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card ma-panels__wide">
        <h3>
          Équilibre tonal <Help topic="bandes" />
        </h3>
        <table className="ma-table">
          <thead>
            <tr>
              <th>Bande</th>
              <th className="num">Énergie</th>
              <th className="num">Par rapport à la sonie</th>
            </tr>
          </thead>
          <tbody>
            {m.bands.map((b, i) => (
              <tr key={b.id}>
                <td>
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
                </td>
                <td className="num">{fr(b.db)} dB</td>
                <td className="num">{fr(b.relative, 1, true)} dB</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
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
      </section>
      <section className="card">
        <h3>
          Normalisation des plateformes <Help topic="normalisation" />
        </h3>
        <table className="ma-table">
          <thead>
            <tr>
              <th>Plateforme</th>
              <th className="num">Cible</th>
              <th className="num">Gain</th>
              <th className="num">Résultat</th>
            </tr>
          </thead>
          <tbody>
            {props.platforms.map((p) => (
              <tr key={p.name} title={p.note}>
                <td>
                  {p.name}
                  <div className="small muted">{p.note}</div>
                </td>
                <td className="num">{fr(p.target)} LUFS</td>
                <td className="num">{fr(p.gain, 1, true)} dB</td>
                <td className="num">{fr(p.result)} LUFS</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Le gain est appliqué par la plateforme à la lecture ; le fichier n’est pas changé. Cibles
          modifiables dans les réglages du module.
        </p>
      </section>
      <section className="card">
        <h3>
          Hygiène technique <Help topic="hygiene" />
        </h3>
        <table className="ma-table">
          <tbody>
            {row(
              'Format',
              `${file.format} · ${file.codec}`,
              file.lossy ? 'compressé avec perte' : 'sans perte',
            )}
            {row('Fréquence', `${file.sampleRate} Hz`)}
            {row(
              'Résolution',
              file.bitDepth ? `${file.bitDepth} bits` : '—',
              file.sampleFormat === 'float' ? 'virgule flottante' : undefined,
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
              file.sampleFormat === 'float' ? undefined : 'possible seulement en virgule flottante',
            )}
          </tbody>
        </table>
      </section>
      <section className="card ma-panels__wide">
        <h3>
          Dépassements et écrêtages ({list.filter((x) => x.kind === 'over').length} au-dessus de{' '}
          {fr(props.threshold, 1, true)} dBTP, {a.clipping.length} écrêtage(s)){' '}
          <Help topic="reperes" />
        </h3>
        {list.length === 0 ? (
          <p className="muted">Aucun repère.</p>
        ) : (
          <table className="ma-table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="num">Début</th>
                <th className="num">Durée</th>
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
                  <td className="num">{fr(x.end - x.start, 2)} s</td>
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
        )}
      </section>
    </div>
  );
}
