// Small charts of the panels (SVG, theme tokens only): a spectrum on a
// logarithmic frequency axis with hover values, and bars of differences
// around zero. One axis per chart, legend when there are two series.
import { useState } from 'react';
import { fr } from '../shared/format';

const freqLabel = (f: number) =>
  f >= 1000 ? `${fr(f / 1000, f >= 10_000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`;

export function SpectrumChart(props: {
  series: {
    label: string;
    points: { f: number; db: number | null }[];
    color: string;
    dashed?: boolean;
  }[];
  unit?: string;
  ariaLabel: string;
  height?: number;
}) {
  const width = 720;
  const height = props.height ?? 220;
  const pad = { left: 44, right: 10, top: 10, bottom: 24 };
  const values = props.series.flatMap((s) =>
    s.points.map((p) => p.db).filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  const max = Math.ceil((Math.max(...values, -100) + 3) / 6) * 6;
  const min = Math.max(max - 60, Math.floor((Math.min(...values, max - 12) - 3) / 6) * 6);
  const fmin = 20;
  const fmax = 20_000;
  const x = (f: number) =>
    pad.left + (Math.log(f / fmin) / Math.log(fmax / fmin)) * (width - pad.left - pad.right);
  const y = (v: number) =>
    pad.top +
    (1 - (Math.max(min, Math.min(max, v)) - min) / (max - min)) * (height - pad.top - pad.bottom);
  const [hover, setHover] = useState<number | null>(null);
  const ticks = Array.from({ length: Math.floor((max - min) / 12) + 1 }, (_, i) => min + i * 12);
  const near = (points: { f: number; db: number | null }[], f: number) =>
    points.reduce(
      (best, p) => (Math.abs(Math.log(p.f / f)) < Math.abs(Math.log(best.f / f)) ? p : best),
      points[0]!,
    );
  return (
    <div className="ma-chart">
      {props.series.length > 1 && (
        <ul className="ma-legend ma-legend--row small">
          {props.series.map((s) => (
            <li key={s.label}>
              <i
                className={s.dashed ? 'ma-swatch ma-swatch--dashed' : 'ma-swatch'}
                style={{ borderColor: s.color, background: s.dashed ? undefined : s.color }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={props.ariaLabel}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * width;
          const f = fmin * (fmax / fmin) ** ((px - pad.left) / (width - pad.left - pad.right));
          setHover(Math.max(fmin, Math.min(fmax, f)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="ma-grid" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
            <text className="ma-axis" x={pad.left - 4} y={y(t) + 4} textAnchor="end">
              {fr(t, 0)}
            </text>
          </g>
        ))}
        {[50, 100, 200, 500, 1000, 2000, 5000, 10_000].map((f) => (
          <text key={f} className="ma-axis" x={x(f)} y={height - 6} textAnchor="middle">
            {freqLabel(f)}
          </text>
        ))}
        {props.series.map((s) => (
          <path
            key={s.label}
            d={s.points
              .filter((p) => p.db !== null && Number.isFinite(p.db))
              .map((p, i) => `${i ? 'L' : 'M'}${x(p.f).toFixed(1)},${y(p.db!).toFixed(1)}`)
              .join('')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dashed ? '6 4' : undefined}
            strokeLinejoin="round"
          />
        ))}
        {hover !== null && (
          <line
            className="ma-crosshair"
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={height - pad.bottom}
          />
        )}
      </svg>
      {hover !== null && (
        <div className="ma-chart__tip small">
          <strong>{freqLabel(near(props.series[0]!.points, hover).f)}</strong>
          {props.series.map((s) => (
            <span key={s.label}>
              {s.label} : {fr(near(s.points, hover).db)} {props.unit ?? 'dB'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bars around zero (differences): one per label, value written next to it. */
export function DiffBars(props: {
  items: { label: string; value: number | null; color: string }[];
  unit: string;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...props.items.map((i) => Math.abs(i.value ?? 0)));
  return (
    <ul className="ma-diffbars" aria-label={props.ariaLabel}>
      {props.items.map((item) => {
        const v = item.value ?? 0;
        const share = (Math.abs(v) / max) * 50;
        return (
          <li key={item.label} title={`${item.label} : ${fr(item.value, 1, true)} ${props.unit}`}>
            <span className="small">{item.label}</span>
            <span className="ma-diffbars__track">
              <i className="ma-diffbars__zero" />
              <i
                className="ma-diffbars__bar"
                style={{
                  background: item.color,
                  left: v >= 0 ? '50%' : `${50 - share}%`,
                  width: `${share}%`,
                }}
              />
            </span>
            <span className="num small">
              {fr(item.value, 1, true)} {props.unit}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
