// « Versions »: two versions of the same project, aligned in time (found
// automatically, adjustable), their differences over the whole track, per
// section and second by second (difference map).
import { useState } from 'react';
import { Button, ErrorMessage, errorMessage, useApi, useModule } from '@hub/sdk/frontend';
import { clock, fr, pct } from '../shared/format';
import { BANDS, type Measures } from '../shared/types';
import { DiffBars } from './charts';
import { Help } from './guide/Help';
import { Choice, emphasis, Group, KeyFigures, useStoredChoice } from './layout';
import { BAND_TOKENS, useColors } from './theme';
import type { CompareDto, VersionDto } from './types';

const ROWS: {
  key: keyof Measures;
  label: string;
  unit: string;
  format?: (v: number | null) => string;
}[] = [
  { key: 'integrated', label: 'Sonie intégrée', unit: 'LUFS' },
  { key: 'truePeak', label: 'Crête vraie', unit: 'dBTP' },
  { key: 'plr', label: 'PLR', unit: 'LU' },
  { key: 'lra', label: 'LRA', unit: 'LU' },
  { key: 'crest', label: 'Facteur de crête', unit: 'dB' },
  { key: 'correlation', label: 'Corrélation', unit: '', format: (v) => fr(v, 2) },
  { key: 'width', label: 'Largeur', unit: '', format: (v) => pct(v) },
  { key: 'monoLoss', label: 'Perte au mono', unit: 'dB' },
];

const SECTION_COLUMNS = [
  { id: 'width', label: 'Largeur' },
  { id: 'bands', label: 'Bandes' },
] as const;

export function Versions(props: {
  versions: VersionDto[];
  current: VersionDto;
  onSeek: (t: number) => void;
}) {
  const module = useModule();
  const colors = useColors();
  const done = props.versions.filter((v) => v.status === 'done');
  const previous =
    done.filter((v) => v.number < props.current.number).at(-1) ??
    done.find((v) => v.id !== props.current.id) ??
    null;
  const [aId, setA] = useState<number | null>(previous?.id ?? null);
  const [manual, setManual] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const columns = useStoredChoice('versions-columns', []);
  const query =
    aId !== null
      ? `/compare?a=${aId}&b=${props.current.id}${manual !== '' ? `&offset=${manual}` : ''}`
      : null;
  const data = useApi<CompareDto>(query === null ? null : module.url(query));
  if (done.length < 2 || aId === null)
    return (
      <p className="muted">
        Une seule version analysée : ajoute une autre version du master pour les comparer.
      </p>
    );
  const c = data.data;
  const isPrevious = previous?.id === aId;
  const saveOffset = async (offset: number | null) => {
    setError(null);
    try {
      await module.api.put(`/versions/${props.current.id}/offset`, { offset });
      setManual('');
      data.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const diff = (key: keyof Measures) => {
    const a = c?.measures.a[key] as number | null | undefined;
    const b = c?.measures.b[key] as number | null | undefined;
    return a === null || b === null || a === undefined || b === undefined ? null : b - a;
  };
  const show = (id: string) => columns.shown.has(id);
  return (
    <div className="ma-groups">
      <Group title="Versions comparées" topic="vue-versions" wide>
        <div className="toolbar">
          <label className="small">
            Comparer <strong>{props.current.name}</strong> à{' '}
            <select
              className="input input--short"
              value={aId}
              onChange={(e) => {
                setA(Number(e.target.value));
                setManual('');
              }}
            >
              {done
                .filter((v) => v.id !== props.current.id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
          </label>
          {c && (
            <span className="small">
              Décalage : <strong className="num">{fr(c.offset, 2, true)} s</strong>
              {c.manual
                ? ' (réglé à la main)'
                : ` (trouvé automatiquement, confiance ${pct(c.auto.confidence)})`}
              <Help topic="alignement" />
            </span>
          )}
          <label className="small">
            Régler{' '}
            <input
              className="input input--short num"
              type="number"
              step={0.01}
              value={manual}
              placeholder={c ? c.offset.toFixed(2) : ''}
              onChange={(e) => setManual(e.target.value)}
              aria-label="Décalage en secondes"
            />{' '}
            s
          </label>
          {isPrevious && manual !== '' && (
            <Button variant="secondary" small onClick={() => void saveOffset(Number(manual))}>
              Garder ce décalage
            </Button>
          )}
          {isPrevious && c?.manual && manual === '' && (
            <Button variant="secondary" small onClick={() => void saveOffset(null)}>
              Revenir à l’automatique
            </Button>
          )}
        </div>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {data.error && <ErrorMessage>{data.error}</ErrorMessage>}
        {c && (
          <>
            <p className="ma-note">
              Écarts de {c.b.name} par rapport à {c.a.name}. En gras : écart de 3 ou plus ; en gris
              : moins de 1.
            </p>
            <KeyFigures
              label="Écarts entre les versions"
              items={[
                {
                  label: 'Sonie intégrée',
                  value: fr(diff('integrated'), 1, true),
                  unit: 'LU',
                  tone: emphasis(diff('integrated')),
                  topic: 'sonie',
                },
                {
                  label: 'Crête vraie',
                  value: fr(diff('truePeak'), 1, true),
                  unit: 'dB',
                  tone: emphasis(diff('truePeak')),
                  topic: 'crete-vraie',
                },
                {
                  label: 'PLR',
                  value: fr(diff('plr'), 1, true),
                  unit: 'LU',
                  tone: emphasis(diff('plr')),
                  topic: 'plr',
                },
                {
                  label: 'LRA',
                  value: fr(diff('lra'), 1, true),
                  unit: 'LU',
                  tone: emphasis(diff('lra')),
                  topic: 'lra',
                },
                {
                  label: 'Perte au mono',
                  value: fr(diff('monoLoss'), 1, true),
                  unit: 'dB',
                  tone: emphasis(diff('monoLoss')),
                  topic: 'mono',
                },
              ]}
            />
          </>
        )}
      </Group>
      {c && (
        <>
          <Group
            title="Volume et dynamique"
            topic="sonie-superposee"
            wide
            detailLabel="toutes les différences globales"
            detail={
              <table className="ma-table">
                <thead>
                  <tr>
                    <th />
                    <th className="num">{c.a.name}</th>
                    <th className="num">{c.b.name}</th>
                    <th className="num">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => {
                    const format = r.format ?? ((v: number | null) => `${fr(v)} ${r.unit}`);
                    const a = c.measures.a[r.key] as number | null;
                    const b = c.measures.b[r.key] as number | null;
                    const tone =
                      a === null || b === null
                        ? ''
                        : r.key === 'width'
                          ? emphasis((b - a) * 100, 10, 3)
                          : r.key === 'correlation'
                            ? emphasis(b - a, 0.3, 0.1)
                            : emphasis(b - a);
                    return (
                      <tr key={r.key}>
                        <th>{r.label}</th>
                        <td className="num">{format(a)}</td>
                        <td className="num">{format(b)}</td>
                        <td className={`num ${tone}`}>
                          {a === null || b === null
                            ? '—'
                            : r.key === 'width'
                              ? `${fr((b - a) * 100, 1, true)} pts`
                              : `${fr(b - a, r.key === 'correlation' ? 2 : 1, true)} ${r.unit === 'LUFS' ? 'LU' : r.unit === 'dBTP' ? 'dB' : r.unit}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            }
          >
            <h4>
              Sonie court terme superposée (versions alignées) <Help topic="sonie-superposee" />
            </h4>
            <Overlay
              points={c.overlay}
              a={c.a.name}
              b={c.b.name}
              colorA={colors['series-2']}
              colorB={colors['series-1']}
            />
          </Group>
          <Group title={`Fréquences (${c.b.name} − ${c.a.name})`} topic="bandes">
            <DiffBars
              ariaLabel="Écart par bande"
              unit="dB"
              items={BANDS.map((b, i) => ({
                label: b.label,
                value: c.global.bands[i]!.db,
                color: colors[BAND_TOKENS[i]!],
              }))}
            />
          </Group>
          <Group title="Structure et sections" topic="vue-versions" wide>
            <p className="ma-note">
              Sections de {c.a.name} ; écarts de {c.b.name} (LU ou dB).
            </p>
            <Choice
              label="Colonnes"
              options={SECTION_COLUMNS}
              shown={columns.shown}
              onToggle={columns.toggle}
            />
            <div className="ma-scroll">
              <table className="ma-table">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th className="num">Sonie (LU)</th>
                    <th className="num">Crête vraie (dB)</th>
                    <th className="num">PLR (LU)</th>
                    {show('width') && <th className="num">Largeur (pts)</th>}
                    {show('bands') &&
                      BANDS.map((b) => (
                        <th key={b.id} className="num">
                          {b.label} (dB)
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {c.sections.map(({ section, difference: d }, i) => (
                    <tr key={i}>
                      <th>
                        <button
                          type="button"
                          className="ma-link"
                          onClick={() => props.onSeek(section.start)}
                        >
                          {section.label}
                        </button>{' '}
                        <span className="small muted">{clock(section.start, 0)}</span>
                      </th>
                      <td className={`num ${emphasis(d.integrated)}`}>
                        {fr(d.integrated, 1, true)}
                      </td>
                      <td className={`num ${emphasis(d.truePeak)}`}>{fr(d.truePeak, 1, true)}</td>
                      <td className={`num ${emphasis(d.plr)}`}>{fr(d.plr, 1, true)}</td>
                      {show('width') && (
                        <td
                          className={`num ${d.width === null ? '' : emphasis(d.width * 100, 10, 3)}`}
                        >
                          {d.width === null ? '—' : fr(d.width * 100, 1, true)}
                        </td>
                      )}
                      {show('bands') &&
                        d.bands.map((b) => (
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
          <Group
            title="Dans le temps"
            topic="carte-differences"
            wide
            detailLabel="la carte des différences, seconde par seconde"
            detail={<DifferenceMap map={c.map} onSeek={props.onSeek} />}
          />
        </>
      )}
    </div>
  );
}

function Overlay(props: {
  points: CompareDto['overlay'];
  a: string;
  b: string;
  colorA: string;
  colorB: string;
}) {
  const width = 900;
  const height = 160;
  const t1 = props.points.at(-1)?.t ?? 1;
  const x = (t: number) => 36 + (t / Math.max(1, t1)) * (width - 44);
  const y = (v: number) => 6 + (1 - (Math.max(-40, Math.min(0, v)) + 40) / 40) * (height - 26);
  const path = (key: 'a' | 'b') => {
    let d = '';
    let open = false;
    for (const p of props.points) {
      const v = p[key];
      if (v === null) {
        open = false;
        continue;
      }
      d += `${open ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      open = true;
    }
    return d;
  };
  return (
    <div className="ma-chart">
      <ul className="ma-legend ma-legend--row small">
        <li>
          <i className="ma-swatch ma-swatch--dashed" style={{ borderColor: props.colorA }} />
          {props.a}
        </li>
        <li>
          <i
            className="ma-swatch"
            style={{ borderColor: props.colorB, background: props.colorB }}
          />
          {props.b}
        </li>
      </ul>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Sonie court terme des deux versions"
      >
        {[-36, -24, -12, 0].map((t) => (
          <g key={t}>
            <line className="ma-grid" x1={36} x2={width - 8} y1={y(t)} y2={y(t)} />
            <text className="ma-axis" x={32} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} className="ma-axis" x={x(f * t1)} y={height - 4} textAnchor="middle">
            {clock(f * t1, 0)}
          </text>
        ))}
        <path
          d={path('a')}
          fill="none"
          stroke={props.colorA}
          strokeWidth={2}
          strokeDasharray="6 4"
        />
        <path d={path('b')} fill="none" stroke={props.colorB} strokeWidth={2} />
      </svg>
    </div>
  );
}

/** One row per measure (loudness, then the bands), one cell per second, coloured around zero. */
function DifferenceMap(props: { map: CompareDto['map']; onSeek: (t: number) => void }) {
  const [hover, setHover] = useState<{ row: string; second: number; value: number | null } | null>(
    null,
  );
  const rows = [
    { label: 'Sonie', values: props.map.loudness },
    ...BANDS.map((b, i) => ({ label: b.label, values: props.map.bands[i]! })),
  ];
  const tone = (v: number | null) => {
    if (v === null) return undefined;
    const share = Math.round((Math.min(6, Math.abs(v)) / 6) * 100);
    return `color-mix(in oklab, var(${v >= 0 ? '--series-1' : '--series-2'}) ${share}%, var(--surface-2))`;
  };
  return (
    <div className="ma-map">
      <div
        className="ma-map__grid"
        style={{ gridTemplateColumns: `100px repeat(${props.map.seconds}, minmax(2px, 1fr))` }}
        onPointerLeave={() => setHover(null)}
      >
        {rows.map((r) => (
          <div key={r.label} className="ma-map__row">
            <span className="small ma-map__label">{r.label}</span>
            {r.values.map((v, s) => (
              <span
                key={s}
                className="ma-map__cell"
                style={{ background: tone(v) }}
                onPointerEnter={() => setHover({ row: r.label, second: s, value: v })}
                onClick={() => props.onSeek(s)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="toolbar small">
        <span className="ma-map__scale">
          <i style={{ background: tone(-6) }} /> −6 dB <i style={{ background: tone(-3) }} />{' '}
          <i style={{ background: 'var(--surface-2)' }} /> 0 <i style={{ background: tone(3) }} />{' '}
          <i style={{ background: tone(6) }} /> +6 dB et plus
        </span>
        {hover && (
          <span>
            {hover.row} à {clock(hover.second, 0)} :{' '}
            <strong className="num">{fr(hover.value, 1, true)} dB</strong>
          </span>
        )}
      </div>
    </div>
  );
}
