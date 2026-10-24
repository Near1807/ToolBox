// « Sections »: the parts of the track (found automatically, edited by hand:
// rename, move a boundary, cut at the cursor, merge), the measures of each
// part and how they differ from one another.
import { useState } from 'react';
import { Button, errorMessage, ErrorMessage, useModule } from '@hub/sdk/frontend';
import { clock, fr, pct } from '../shared/format';
import { sectionMeasures } from '../shared/measures';
import { BANDS, type Analysis, type Section } from '../shared/types';
import { DiffBars } from './charts';
import { Help } from './guide/Help';
import { BAND_TOKENS, useColors } from './theme';

export function Sections(props: {
  versionId: number;
  analysis: Analysis;
  sections: Section[];
  cursor: () => number;
  onChange: (sections: Section[]) => void;
  onSeek: (t: number) => void;
}) {
  const module = useModule();
  const colors = useColors();
  const [error, setError] = useState<string | null>(null);
  const list = sectionMeasures(props.analysis, props.sections);
  const save = async (sections: Section[]) => {
    setError(null);
    try {
      const result = await module.api.put<{ sections: Section[] }>(
        `/versions/${props.versionId}/sections`,
        { sections },
      );
      props.onChange(result.sections);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const reset = async () => {
    try {
      props.onChange(
        (
          await module.api.post<{ sections: Section[] }>(
            `/versions/${props.versionId}/sections/reset`,
          )
        ).sections,
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const update = (i: number, change: Partial<Section>) =>
    save(
      props.sections.map((s, k) => {
        if (k === i) return { ...s, ...change };
        // Moving a start moves the end of the section before.
        if (k === i - 1 && change.start !== undefined) return { ...s, end: change.start };
        return s;
      }),
    );
  const cut = () => {
    const t = Math.round(props.cursor() * 10) / 10;
    const i = props.sections.findIndex((s) => t > s.start && t < s.end);
    if (i < 0) return;
    const s = props.sections[i]!;
    void save([
      ...props.sections.slice(0, i),
      { ...s, end: t },
      { start: t, end: s.end, label: 'Partie' },
      ...props.sections.slice(i + 1),
    ]);
  };
  const merge = (i: number) => {
    const a = props.sections[i]!;
    const b = props.sections[i + 1]!;
    void save([
      ...props.sections.slice(0, i),
      { start: a.start, end: b.end, label: a.label },
      ...props.sections.slice(i + 2),
    ]);
  };

  return (
    <div className="ma-panels">
      <section className="card ma-panels__wide">
        <div className="toolbar">
          <Button variant="secondary" small onClick={cut}>
            Couper au curseur ({clock(props.cursor())})
          </Button>
          <Button variant="secondary" small onClick={() => void reset()}>
            Revenir au découpage automatique
          </Button>
          <Help topic="vue-sections" />
          <span className="small muted">
            Découpage automatique d’après la sonie, le bas et le haut du spectre, la densité et la
            largeur : un point de départ, modifiable.
          </span>
        </div>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <table className="ma-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th className="num">Début</th>
              <th className="num">Fin</th>
              <th className="num">
                Sonie <Help topic="sonie" />
              </th>
              <th className="num">
                vs morceau <Help topic="contrastes" />
              </th>
              <th className="num">
                PLR <Help topic="plr" />
              </th>
              <th className="num">
                LRA <Help topic="lra" />
              </th>
              <th className="num">
                Largeur <Help topic="largeur" />
              </th>
              <th className="num">
                Densité <Help topic="densite" />
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map(({ section, measures: m, vsTrack }, i) => (
              <tr key={`${section.start}-${i}`}>
                <td>
                  <input
                    className="input input--short"
                    defaultValue={section.label}
                    aria-label="Nom de la section"
                    onBlur={(e) =>
                      e.target.value.trim() !== section.label &&
                      void update(i, { label: e.target.value })
                    }
                  />
                </td>
                <td className="num">
                  {i === 0 ? (
                    clock(section.start)
                  ) : (
                    <input
                      className="input input--short num"
                      type="number"
                      step={0.1}
                      defaultValue={section.start.toFixed(1)}
                      aria-label="Début (secondes)"
                      onBlur={(e) =>
                        Number(e.target.value) !== section.start &&
                        void update(i, { start: Number(e.target.value) })
                      }
                    />
                  )}
                </td>
                <td className="num">{clock(section.end)}</td>
                <td className="num">{fr(m.integrated)} LUFS</td>
                <td className="num">{fr(vsTrack.integrated, 1, true)} LU</td>
                <td className="num">{fr(m.plr)} LU</td>
                <td className="num">{fr(m.lra)} LU</td>
                <td className="num">{pct(m.width)}</td>
                <td className="num" title="attaques par seconde">
                  {fr(m.density)} /s
                </td>
                <td className="nowrap">
                  <button
                    type="button"
                    className="ma-link small"
                    onClick={() => props.onSeek(section.start)}
                  >
                    Écouter
                  </button>{' '}
                  {i < list.length - 1 && (
                    <button type="button" className="ma-link small" onClick={() => merge(i)}>
                      Fusionner avec la suivante
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card ma-panels__wide">
        <h3>
          Contrastes entre sections <Help topic="contrastes" />
        </h3>
        <p className="small muted">
          Chaque section par rapport au morceau entier : sonie (LU) et énergie de chaque bande (dB).
        </p>
        <div className="ma-contrasts">
          {list.map(({ section, vsTrack }, i) => (
            <div key={`${section.start}-${i}`} className="ma-contrast">
              <strong className="small">{section.label}</strong>
              <DiffBars
                ariaLabel={`Contrastes de ${section.label}`}
                unit="dB"
                items={[
                  { label: 'Sonie', value: vsTrack.integrated, color: colors.accent },
                  ...BANDS.map((b, k) => ({
                    label: b.label,
                    value: vsTrack.bands[k]!.db,
                    color: colors[BAND_TOKENS[k]!],
                  })),
                ]}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
