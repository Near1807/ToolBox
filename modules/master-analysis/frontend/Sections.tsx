// « Sections »: the parts of the track (found automatically, edited by hand:
// rename, move a boundary, cut at the cursor, merge), the measures of each
// part and how they differ from one another.
import { useState } from 'react';
import { Button, errorMessage, ErrorMessage, useModule } from '@hub/sdk/frontend';
import { clock, fr } from '../shared/format';
import { sectionMeasures } from '../shared/measures';
import { BANDS, type Analysis, type Section } from '../shared/types';
import { DiffBars } from './charts';
import { Help } from './guide/Help';
import { Choice, emphasis, Group, useStoredChoice } from './layout';
import { BAND_TOKENS, useColors } from './theme';

const SECONDARY = [
  { id: 'plr', label: 'PLR' },
  { id: 'lra', label: 'LRA' },
  { id: 'width', label: 'Largeur' },
  { id: 'density', label: 'Densité' },
] as const;

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
  const columns = useStoredChoice('sections-columns', []);
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

  const loudest = list.reduce<(typeof list)[number] | null>(
    (best, x) =>
      x.measures.integrated !== null &&
      (best === null || x.measures.integrated > (best.measures.integrated ?? -Infinity))
        ? x
        : best,
    null,
  );
  const quietest = list.reduce<(typeof list)[number] | null>(
    (best, x) =>
      x.measures.integrated !== null &&
      (best === null || x.measures.integrated < (best.measures.integrated ?? Infinity))
        ? x
        : best,
    null,
  );
  const show = (id: string) => columns.shown.has(id);

  return (
    <div className="ma-groups">
      <Group
        title="Structure et sections"
        topic="vue-sections"
        wide
        figures={[
          { label: 'Sections', value: String(list.length), topic: 'vue-sections' },
          {
            label: 'La plus forte',
            value: fr(loudest?.measures.integrated),
            unit: 'LUFS',
            sub: loudest?.section.label,
            topic: 'sonie',
          },
          {
            label: 'La plus calme',
            value: fr(quietest?.measures.integrated),
            unit: 'LUFS',
            sub: quietest?.section.label,
            topic: 'sonie',
          },
        ]}
      >
        <div className="toolbar">
          <Button variant="secondary" small onClick={cut}>
            Couper au curseur ({clock(props.cursor())})
          </Button>
          <Button variant="secondary" small onClick={() => void reset()}>
            Revenir au découpage automatique
          </Button>
          <Help topic="vue-sections" />
        </div>
        <p className="ma-note">
          Découpage automatique d’après la sonie, le bas et le haut du spectre, la densité et la
          largeur : un point de départ, modifiable.
        </p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <Choice
          label="Colonnes"
          options={SECONDARY}
          shown={columns.shown}
          onToggle={columns.toggle}
        />
        <div className="ma-stack">
          <table className="ma-table ma-table--stack">
            <thead>
              <tr>
                <th>Nom</th>
                <th className="num">Début (s)</th>
                <th className="num">Fin</th>
                <th className="num">
                  Sonie (LUFS) <Help topic="sonie" />
                </th>
                <th className="num">
                  vs morceau (LU) <Help topic="contrastes" />
                </th>
                {show('plr') && (
                  <th className="num">
                    PLR (LU) <Help topic="plr" />
                  </th>
                )}
                {show('lra') && (
                  <th className="num">
                    LRA (LU) <Help topic="lra" />
                  </th>
                )}
                {show('width') && (
                  <th className="num">
                    Largeur (%) <Help topic="largeur" />
                  </th>
                )}
                {show('density') && (
                  <th className="num">
                    Densité (/s) <Help topic="densite" />
                  </th>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map(({ section, measures: m, vsTrack }, i) => (
                <tr key={`${section.start}-${i}`}>
                  <td data-label="Nom">
                    <input
                      className="input ma-section-name"
                      defaultValue={section.label}
                      aria-label="Nom de la section"
                      onBlur={(e) =>
                        e.target.value.trim() !== section.label &&
                        void update(i, { label: e.target.value })
                      }
                    />
                  </td>
                  <td className="num" data-label="Début (s)">
                    {i === 0 ? (
                      clock(section.start)
                    ) : (
                      <input
                        className="input ma-section-start num"
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
                  <td className="num" data-label="Fin">
                    {clock(section.end)}
                  </td>
                  <td className="num" data-label="Sonie (LUFS)">
                    {fr(m.integrated)}
                  </td>
                  <td
                    className={`num ${emphasis(vsTrack.integrated)}`}
                    data-label="vs morceau (LU)"
                  >
                    {fr(vsTrack.integrated, 1, true)}
                  </td>
                  {show('plr') && (
                    <td className="num" data-label="PLR (LU)">
                      {fr(m.plr)}
                    </td>
                  )}
                  {show('lra') && (
                    <td className="num" data-label="LRA (LU)">
                      {fr(m.lra)}
                    </td>
                  )}
                  {show('width') && (
                    <td className="num" data-label="Largeur (%)">
                      {fr(m.width === null ? null : m.width * 100, 0)}
                    </td>
                  )}
                  {show('density') && (
                    <td className="num" data-label="Densité (/s)" title="attaques par seconde">
                      {fr(m.density)}
                    </td>
                  )}
                  <td className="ma-row-actions">
                    <button
                      type="button"
                      className="ma-link small"
                      onClick={() => props.onSeek(section.start)}
                    >
                      Écouter
                    </button>
                    {i < list.length - 1 && (
                      <button
                        type="button"
                        className="ma-link small"
                        title="Fusionner avec la suivante"
                        onClick={() => merge(i)}
                      >
                        Fusionner avec la suivante
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Group>
      <Group
        title="Contrastes entre sections"
        topic="contrastes"
        wide
        detailLabel="les contrastes en barres"
        detail={
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
        }
      >
        <p className="ma-note">
          Chaque section par rapport au morceau entier : sonie (LU) et énergie de chaque bande (dB).
          En gras : écart de 3 ou plus ; en gris : moins de 1.
        </p>
        <div className="ma-scroll">
          <table className="ma-table">
            <thead>
              <tr>
                <th>Section</th>
                <th className="num">Sonie (LU)</th>
                {BANDS.map((b) => (
                  <th key={b.id} className="num">
                    {b.label} (dB)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(({ section, vsTrack }, i) => (
                <tr key={`${section.start}-${i}`}>
                  <th>{section.label}</th>
                  <td className={`num ${emphasis(vsTrack.integrated)}`}>
                    {fr(vsTrack.integrated, 1, true)}
                  </td>
                  {vsTrack.bands.map((b) => (
                    <td key={b.id} className={`num ${emphasis(b.db)}`}>
                      {fr(b.db, 1, true)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Group>
    </div>
  );
}
