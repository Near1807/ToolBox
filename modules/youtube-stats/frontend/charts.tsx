// Charts of the module, drawn in SVG with the theme's tokens only (no colour
// written here). Thin marks, one hairline grid, a hover layer on every chart
// (crosshair on lines, per-mark tooltip on bars, cells and dots), legends for
// two series, the long video always dashed (identity never colour alone).
import { useEffect, useRef, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const SERIES = {
  short: 'var(--series-1)',
  video: 'var(--series-4)',
  third: 'var(--series-2)',
};

export const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : Math.round(n).toLocaleString('fr-FR');

export const fmtNum = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtCompact = (n: number) =>
  Math.abs(n) >= 1000 ? `${fmtNum(n / 1000, Math.abs(n) >= 10000 ? 0 : 1)} k` : fmtInt(n);

export const fmtDay = (day: string) => {
  const [y, m, d] = day.split('-');
  return `${d}/${m}${y && y !== String(new Date().getFullYear()) ? `/${y.slice(2)}` : ''}`;
};

function useWidth(fallback = 640): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(240, Math.floor(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function TipBox(props: { tip: Tip | null; width: number }) {
  if (!props.tip) return null;
  const left = Math.min(Math.max(8, props.tip.x + 14), props.width - 200);
  return (
    <div className="ys-tip" style={{ left, top: Math.max(0, props.tip.y - 10) }} role="status">
      {props.tip.content}
    </div>
  );
}

export function TipRow(props: {
  color?: string;
  dashed?: boolean;
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="ys-tip__row">
      {props.color && (
        <svg width="14" height="8" aria-hidden="true">
          <line
            x1="0"
            y1="4"
            x2="14"
            y2="4"
            stroke={props.color}
            strokeWidth="2"
            strokeDasharray={props.dashed ? '4 3' : undefined}
          />
        </svg>
      )}
      <strong>{props.value}</strong>
      <span className="muted">{props.label}</span>
    </div>
  );
}

/** A round maximum for an axis of 4 steps (0, 25, 50, 75, 100 / 0, 50…). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const raw = value / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= raw) return step * power * 4;
  return 40 * power;
}

export function Legend(props: {
  items: { label: string; color: string; dashed?: boolean; box?: boolean }[];
}) {
  return (
    <div className="ys-legend">
      {props.items.map((item) => (
        <span key={item.label}>
          <svg width="18" height="10" aria-hidden="true">
            {item.box ? (
              <rect x="2" y="1" width="12" height="8" rx="2" fill={item.color} />
            ) : (
              <line
                x1="0"
                y1="5"
                x2="18"
                y2="5"
                stroke={item.color}
                strokeWidth="2"
                strokeDasharray={item.dashed ? '4 3' : undefined}
              />
            )}
          </svg>
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lines over time
// ---------------------------------------------------------------------------

export interface LineSeries {
  key: string;
  label: string;
  values: (number | null)[];
  color: string;
  dashed?: boolean;
}

export function LineChart(props: {
  x: string[];
  series: LineSeries[];
  height?: number;
  format?: (n: number) => string;
  /** Vertical marks (publications…), by index of x. */
  marks?: { index: number; label: string }[];
  /** Horizontal reference (e.g. 1 = as usual). */
  reference?: { value: number; label: string };
  xFormat?: (x: string) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = props.height ?? 220;
  const pad = { left: 44, right: 12, top: 12, bottom: 24 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const format = props.format ?? fmtCompact;
  const xFormat = props.xFormat ?? fmtDay;
  const n = props.x.length;
  const all = props.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = niceMax(Math.max(props.reference?.value ?? 0, ...all, 0));
  const xAt = (i: number) => pad.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const yAt = (v: number) => pad.top + h - (v / max) * h;
  const path = (values: (number | null)[]) => {
    let d = '';
    let open = false;
    values.forEach((v, i) => {
      if (v === null) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const xTicks = n > 1 ? [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1] : [0];
  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))));
  };
  return (
    <div className="ys-chart" ref={ref}>
      {props.series.length > 1 && (
        <Legend
          items={props.series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))}
        />
      )}
      <svg width={width} height={height} role="img" aria-label={props.ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              className="ys-grid"
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(t)}
              y2={yAt(t)}
            />
            <text className="ys-axis" x={pad.left - 6} y={yAt(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text
            key={i}
            className="ys-axis"
            x={xAt(i)}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
          >
            {props.x[i] ? xFormat(props.x[i]!) : ''}
          </text>
        ))}
        {props.marks?.map((m, k) => (
          <line
            key={k}
            className="ys-mark"
            x1={xAt(m.index)}
            x2={xAt(m.index)}
            y1={pad.top}
            y2={pad.top + h}
          />
        ))}
        {props.reference && (
          <g>
            <line
              className="ys-reference"
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(props.reference.value)}
              y2={yAt(props.reference.value)}
            />
            <text
              className="ys-axis"
              x={width - pad.right}
              y={yAt(props.reference.value) - 4}
              textAnchor="end"
            >
              {props.reference.label}
            </text>
          </g>
        )}
        {props.series.map((s) => (
          <path
            key={s.key}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={s.dashed ? '6 4' : undefined}
          />
        ))}
        {hover !== null && (
          <g>
            <line
              className="ys-crosshair"
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={pad.top}
              y2={pad.top + h}
            />
            {props.series.map((s) =>
              s.values[hover] !== null && s.values[hover] !== undefined ? (
                <circle
                  key={s.key}
                  cx={xAt(hover)}
                  cy={yAt(s.values[hover]!)}
                  r={4}
                  fill={s.color}
                  className="ys-dot"
                />
              ) : null,
            )}
          </g>
        )}
        <rect
          x={pad.left}
          y={pad.top}
          width={w}
          height={h}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <TipBox
        width={width}
        tip={
          hover === null
            ? null
            : {
                x: xAt(hover),
                y: pad.top,
                content: (
                  <>
                    <div className="ys-tip__title">
                      {props.x[hover] ? xFormat(props.x[hover]!) : ''}
                    </div>
                    {props.series.map((s) => (
                      <TipRow
                        key={s.key}
                        color={s.color}
                        dashed={s.dashed}
                        label={s.label}
                        value={
                          s.values[hover] === null || s.values[hover] === undefined
                            ? '—'
                            : format(s.values[hover]!)
                        }
                      />
                    ))}
                    {props.marks
                      ?.filter((m) => m.index === hover)
                      .map((m, k) => (
                        <div key={k} className="ys-tip__note">
                          {m.label}
                        </div>
                      ))}
                  </>
                ),
              }
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bars (breakdowns, groups)
// ---------------------------------------------------------------------------

export function BarList(props: {
  rows: { key: string; label: ReactNode; value: number; hint?: ReactNode; badge?: ReactNode }[];
  format?: (n: number) => string;
  color?: string;
  /** A reference line (e.g. 1 = as usual for an index). */
  reference?: number;
}) {
  const format = props.format ?? fmtInt;
  const max = Math.max(props.reference ?? 0, ...props.rows.map((r) => r.value), 1e-9);
  const [hover, setHover] = useState<string | null>(null);
  const badges = props.rows.some((r) => r.badge);
  return (
    <div className={badges ? 'ys-bars ys-bars--badges' : 'ys-bars'} role="list">
      {props.rows.map((row) => (
        <div
          key={row.key}
          className={`ys-bars__row${hover === row.key ? ' ys-bars__row--hover' : ''}`}
          role="listitem"
          tabIndex={0}
          onPointerEnter={() => setHover(row.key)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(row.key)}
          onBlur={() => setHover(null)}
          title={typeof row.hint === 'string' ? row.hint : undefined}
        >
          <span className="ys-bars__label">{row.label}</span>
          <span className="ys-bars__track">
            <span
              className="ys-bars__fill"
              style={{
                width: `${Math.max(0, (row.value / max) * 100)}%`,
                background: props.color ?? 'var(--series-1)',
              }}
            />
            {props.reference !== undefined && (
              <span
                className="ys-bars__ref"
                style={{ left: `${(props.reference / max) * 100}%` }}
              />
            )}
          </span>
          <span className="ys-bars__value num">{format(row.value)}</span>
          {badges && <span>{row.badge}</span>}
          {hover === row.key && row.hint && typeof row.hint !== 'string' && (
            <span className="ys-bars__hint">{row.hint}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns (correlation by lag, small categories)
// ---------------------------------------------------------------------------

export function Columns(props: {
  labels: string[];
  values: number[];
  format?: (n: number) => string;
  highlight?: number | null;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth(360);
  const [hover, setHover] = useState<number | null>(null);
  const height = props.height ?? 140;
  const format = props.format ?? ((n: number) => fmtNum(n, 2));
  const pad = { left: 8, right: 8, top: 14, bottom: 22 };
  const h = height - pad.top - pad.bottom;
  const maxAbs = Math.max(...props.values.map((v) => Math.abs(v)), 1e-9);
  const hasNegative = props.values.some((v) => v < 0);
  const zero = hasNegative ? pad.top + h / 2 : pad.top + h;
  const scale = hasNegative ? h / 2 / maxAbs : h / maxAbs;
  const slot = (width - pad.left - pad.right) / props.values.length;
  const barWidth = Math.min(24, slot - 6);
  return (
    <div className="ys-chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={props.ariaLabel}>
        <line className="ys-grid" x1={pad.left} x2={width - pad.right} y1={zero} y2={zero} />
        {props.values.map((v, i) => {
          const x = pad.left + i * slot + (slot - barWidth) / 2;
          const y = v >= 0 ? zero - v * scale : zero;
          const barHeight = Math.max(1, Math.abs(v) * scale);
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={h}
                fill="transparent"
              />
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={3}
                fill={i === props.highlight ? 'var(--accent)' : 'var(--series-1)'}
                opacity={hover === null || hover === i ? 1 : 0.6}
              />
              <text className="ys-axis" x={x + barWidth / 2} y={height - 6} textAnchor="middle">
                {props.labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
      <TipBox
        width={width}
        tip={
          hover === null
            ? null
            : {
                x: pad.left + hover * slot,
                y: pad.top,
                content: (
                  <TipRow label={props.labels[hover]} value={format(props.values[hover]!)} />
                ),
              }
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retention × music
// ---------------------------------------------------------------------------

export interface SectionBand {
  from: number;
  to: number;
  label: string;
}

export function RetentionChart(props: {
  points: { ratio: number; watch: number }[];
  energy: number[] | null;
  sections: SectionBand[];
  events: { ratio: number; kind: 'drop' | 'rewatch'; section: string | null; change: number }[];
  /** Duration of the video, to show times. */
  durationSec: number;
  /** Start of the excerpt in the track (Shorts), to show track times. */
  trackStart: number;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 260;
  const pad = { left: 44, right: 12, top: 26, bottom: 26 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(1, ...props.points.map((p) => p.watch));
  const xAt = (ratio: number) => pad.left + ratio * w;
  const yAt = (v: number) => pad.top + h - (v / max) * h;
  const time = (ratio: number) => {
    const seconds = Math.round(props.trackStart + ratio * props.durationSec);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const line = props.points
    .map((p, i) => `${i ? 'L' : 'M'}${xAt(p.ratio).toFixed(1)},${yAt(p.watch).toFixed(1)}`)
    .join('');
  const energyPath = props.energy
    ? `M${xAt(0)},${pad.top + h}` +
      props.energy
        .map(
          (e, i) =>
            `L${xAt((i + 0.5) / props.energy!.length).toFixed(1)},${(pad.top + h - e * h * 0.55).toFixed(1)}`,
        )
        .join('') +
      `L${xAt(1)},${pad.top + h}Z`
    : null;
  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    let best = 0;
    props.points.forEach((p, i) => {
      if (Math.abs(p.ratio - ratio) < Math.abs(props.points[best]!.ratio - ratio)) best = i;
    });
    setHover(best);
  };
  const hovered = hover !== null ? props.points[hover]! : null;
  const sectionAt = (ratio: number) =>
    props.sections.find((s) => ratio >= s.from && ratio < s.to)?.label ?? null;
  return (
    <div className="ys-chart" ref={ref}>
      <Legend
        items={[
          { label: 'Audience restante', color: 'var(--series-1)' },
          ...(props.energy
            ? [{ label: 'Énergie de la musique', color: 'var(--text-3)', box: true }]
            : []),
        ]}
      />
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Rétention de la vidéo superposée à l’énergie de la musique"
      >
        {props.sections.map((s, i) => (
          <g key={i}>
            <rect
              className={i % 2 ? 'ys-band ys-band--alt' : 'ys-band'}
              x={xAt(s.from)}
              y={pad.top}
              width={Math.max(0, xAt(s.to) - xAt(s.from))}
              height={h}
            />
            {xAt(s.to) - xAt(s.from) > 34 && (
              <text
                className="ys-axis"
                x={(xAt(s.from) + xAt(s.to)) / 2}
                y={pad.top - 8}
                textAnchor="middle"
              >
                {s.label}
              </text>
            )}
          </g>
        ))}
        {energyPath && <path d={energyPath} className="ys-energy" />}
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              className="ys-grid"
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(t * max)}
              y2={yAt(t * max)}
            />
            <text className="ys-axis" x={pad.left - 6} y={yAt(t * max) + 4} textAnchor="end">
              {Math.round(t * max * 100)} %
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <text
            key={t}
            className="ys-axis"
            x={xAt(t)}
            y={height - 8}
            textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}
          >
            {time(t)}
          </text>
        ))}
        <path
          d={line}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {props.events.map((e, i) => (
          <g key={i}>
            <line
              className="ys-mark"
              x1={xAt(e.ratio)}
              x2={xAt(e.ratio)}
              y1={pad.top}
              y2={pad.top + h}
            />
            <text className="ys-event" x={xAt(e.ratio)} y={pad.top + 12} textAnchor="middle">
              {e.kind === 'drop' ? '▼' : '▲'}
            </text>
          </g>
        ))}
        {hovered && (
          <g>
            <line
              className="ys-crosshair"
              x1={xAt(hovered.ratio)}
              x2={xAt(hovered.ratio)}
              y1={pad.top}
              y2={pad.top + h}
            />
            <circle
              cx={xAt(hovered.ratio)}
              cy={yAt(hovered.watch)}
              r={4}
              fill="var(--series-1)"
              className="ys-dot"
            />
          </g>
        )}
        <rect
          x={pad.left}
          y={pad.top}
          width={w}
          height={h}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <TipBox
        width={width}
        tip={
          hovered
            ? {
                x: xAt(hovered.ratio),
                y: pad.top,
                content: (
                  <>
                    <div className="ys-tip__title">
                      {time(hovered.ratio)}
                      {props.trackStart > 0 ? ' dans le morceau' : ''}
                      {sectionAt(hovered.ratio) ? ` · ${sectionAt(hovered.ratio)}` : ''}
                    </div>
                    <TipRow
                      color="var(--series-1)"
                      label="audience restante"
                      value={`${Math.round(hovered.watch * 100)} %`}
                    />
                    {props.energy && (
                      <TipRow
                        label="énergie"
                        value={`${Math.round((props.energy[Math.min(props.energy.length - 1, Math.floor(hovered.ratio * props.energy.length))] ?? 0) * 100)} %`}
                      />
                    )}
                  </>
                ),
              }
            : null
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Growth curves (cumulative views by age, normalised)
// ---------------------------------------------------------------------------

export function GrowthChart(props: {
  curves: { id: string; title: string; points: number[] }[];
  usual: number[];
  color: string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<string | null>(null);
  const height = 240;
  const pad = { left: 40, right: 12, top: 10, bottom: 24 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const values = [...props.curves.flatMap((c) => c.points), ...props.usual.filter(Number.isFinite)];
  const max = niceMax(Math.max(1, ...values));
  const xAt = (age: number) => pad.left + (age / 30) * w;
  const yAt = (v: number) => pad.top + h - (Math.min(v, max) / max) * h;
  const path = (points: number[]) =>
    points
      .map((v, i) =>
        Number.isFinite(v) ? `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}` : '',
      )
      .join('');
  const active = props.curves.find((c) => c.id === hover);
  return (
    <div className="ys-chart" ref={ref}>
      <Legend
        items={[
          { label: 'Ta médiane', color: props.color },
          { label: 'Chaque vidéo (survole)', color: 'var(--text-3)' },
        ]}
      />
      <svg width={width} height={height} role="img" aria-label="Courbes de croissance normalisées">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              className="ys-grid"
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(t * max)}
              y2={yAt(t * max)}
            />
            <text className="ys-axis" x={pad.left - 6} y={yAt(t * max) + 4} textAnchor="end">
              ×{fmtNum(t * max, t * max >= 10 ? 0 : 1)}
            </text>
          </g>
        ))}
        {[0, 7, 14, 21, 30].map((age) => (
          <text key={age} className="ys-axis" x={xAt(age)} y={height - 6} textAnchor="middle">
            J+{age}
          </text>
        ))}
        {props.curves.map((c) => (
          <path
            key={c.id}
            d={path(c.points)}
            fill="none"
            className={hover === c.id ? 'ys-curve ys-curve--active' : 'ys-curve'}
            onPointerEnter={() => setHover(c.id)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
        <path d={path(props.usual)} fill="none" stroke={props.color} strokeWidth={2.5} />
      </svg>
      <TipBox
        width={width}
        tip={
          active
            ? {
                x: xAt(Math.min(30, active.points.length - 1)),
                y: yAt(active.points[active.points.length - 1] ?? 0),
                content: (
                  <>
                    <div className="ys-tip__title">{active.title}</div>
                    <TipRow
                      label={`à J+${active.points.length - 1}, en « médianes à J+7 »`}
                      value={`×${fmtNum(active.points[active.points.length - 1] ?? 0)}`}
                    />
                  </>
                ),
              }
            : null
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heatmap (weekday × hour) — diverging around 1 (= as usual)
// ---------------------------------------------------------------------------

export function Heatmap(props: {
  rows: string[];
  columns: string[];
  cell: (row: number, column: number) => { value: number | null; n: number };
}) {
  const [hover, setHover] = useState<string | null>(null);
  const tone = (value: number | null) => {
    if (value === null) return {};
    const strength = Math.min(1, Math.abs(Math.log2(value)) / 1.5);
    const color = value >= 1 ? 'var(--series-1)' : 'var(--series-4)';
    return {
      background: `color-mix(in srgb, ${color} ${Math.round(12 + strength * 70)}%, var(--surface))`,
    };
  };
  return (
    <table className="ys-heat">
      <thead>
        <tr>
          <th />
          {props.columns.map((c) => (
            <th key={c} className="small muted">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r, i) => (
          <tr key={r}>
            <th className="small muted">{r}</th>
            {props.columns.map((c, j) => {
              const cell = props.cell(i, j);
              const key = `${i}-${j}`;
              return (
                <td
                  key={c}
                  style={tone(cell.n ? cell.value : null)}
                  className={`num${hover === key ? ' ys-heat--hover' : ''}${cell.n === 0 ? ' ys-heat--empty' : ''}`}
                  title={
                    cell.n
                      ? `${r}, ${c} : indice ${fmtNum(cell.value, 2)} sur ${cell.n} vidéo(s)`
                      : `${r}, ${c} : aucune publication`
                  }
                  onPointerEnter={() => setHover(key)}
                  onPointerLeave={() => setHover(null)}
                >
                  {cell.n ? (
                    <>
                      ×{fmtNum(cell.value, 1)}
                      <span className="ys-heat__n">{cell.n}</span>
                    </>
                  ) : (
                    '·'
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Scatter (excerpts: energy vs retention)
// ---------------------------------------------------------------------------

export function Scatter(props: {
  points: { x: number; y: number; label: string; detail: string }[];
  xLabel: string;
  yLabel: string;
  xFormat?: (n: number) => string;
  yFormat?: (n: number) => string;
}) {
  const [ref, width] = useWidth(360);
  const [hover, setHover] = useState<number | null>(null);
  const height = 240;
  const pad = { left: 44, right: 12, top: 10, bottom: 36 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const xs = props.points.map((p) => p.x);
  const ys = props.points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs, 0), Math.max(...xs, 1e-9)];
  const [y0, y1] = [Math.min(...ys, 0), niceMax(Math.max(...ys, 1e-9))];
  const xAt = (v: number) => pad.left + ((v - x0) / (x1 - x0 || 1)) * w;
  const yAt = (v: number) => pad.top + h - ((v - y0) / (y1 - y0 || 1)) * h;
  const xFormat = props.xFormat ?? ((n: number) => fmtNum(n, 2));
  const yFormat = props.yFormat ?? ((n: number) => fmtNum(n, 0));
  return (
    <div className="ys-chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${props.yLabel} selon ${props.xLabel}`}
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              className="ys-grid"
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(y0 + t * (y1 - y0))}
              y2={yAt(y0 + t * (y1 - y0))}
            />
            <text
              className="ys-axis"
              x={pad.left - 6}
              y={yAt(y0 + t * (y1 - y0)) + 4}
              textAnchor="end"
            >
              {yFormat(y0 + t * (y1 - y0))}
            </text>
          </g>
        ))}
        <text className="ys-axis" x={pad.left + w / 2} y={height - 4} textAnchor="middle">
          {props.xLabel} →
        </text>
        {[0, 1].map((t) => (
          <text
            key={t}
            className="ys-axis"
            x={xAt(x0 + t * (x1 - x0))}
            y={height - 20}
            textAnchor={t ? 'end' : 'start'}
          >
            {xFormat(x0 + t * (x1 - x0))}
          </text>
        ))}
        {props.points.map((p, i) => (
          <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <circle cx={xAt(p.x)} cy={yAt(p.y)} r={12} fill="transparent" />
            <circle
              cx={xAt(p.x)}
              cy={yAt(p.y)}
              r={hover === i ? 6 : 4.5}
              fill="var(--series-1)"
              className="ys-dot"
            />
          </g>
        ))}
      </svg>
      <TipBox
        width={width}
        tip={
          hover === null
            ? null
            : {
                x: xAt(props.points[hover]!.x),
                y: yAt(props.points[hover]!.y),
                content: (
                  <>
                    <div className="ys-tip__title">{props.points[hover]!.label}</div>
                    <div className="ys-tip__note">{props.points[hover]!.detail}</div>
                  </>
                ),
              }
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (KPI tiles)
// ---------------------------------------------------------------------------

export function Sparkline(props: { values: number[]; label: string }) {
  const width = 120;
  const height = 32;
  const max = Math.max(...props.values, 1e-9);
  const n = props.values.length;
  if (n < 2) return null;
  const d = props.values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i / (n - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`,
    )
    .join('');
  return (
    <svg width={width} height={height} role="img" aria-label={props.label} className="ys-spark">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
