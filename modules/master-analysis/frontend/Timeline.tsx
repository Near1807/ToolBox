// The shared timeline: every curve of the analysis on the same time axis,
// zoomable, with the playback cursor. Click = play from there; hover = the
// exact values at that instant. Canvases are redrawn only when the view
// changes; the cursor and the hover line are plain elements on top.
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Button } from '@hub/sdk/frontend';
import { clock, fr, pct } from '../shared/format';
import {
  bandCurve,
  dynamicsCurves,
  integrated,
  loudnessCurve,
  markers,
  monoLossCurve,
  widthCurve,
} from '../shared/measures';
import { BANDS, BLOCK, FINE, type Analysis, type Marker, type Section } from '../shared/types';
import { Help } from './guide/Help';
import { Choice, useStoredChoice } from './layout';
import { BAND_TOKENS, channelsOf, useColors, type Colors } from './theme';

export interface View {
  start: number;
  end: number;
}

type Series = (number | null)[];

interface Curves {
  momentary: Series;
  short: Series;
  integrated: number | null;
  bands: Series[];
  shares: number[][];
  crest: Series;
  plr: Series;
  width: Series;
  widthBands: Series[];
  correlation: Series;
  monoLoss: Series;
}

function curvesOf(a: Analysis): Curves {
  const total = Array.from({ length: a.blocks }, (_, i) =>
    BANDS.reduce((s, _b, b) => s + a.bandMid[b]![i]! + a.bandSide[b]![i]!, 0),
  );
  const { crest, plr } = dynamicsCurves(a);
  return {
    momentary: loudnessCurve(a, 'momentary'),
    short: loudnessCurve(a, 'short'),
    integrated: integrated(a),
    bands: BANDS.map((_, b) => bandCurve(a, b)),
    shares: BANDS.map((_, b) =>
      Array.from({ length: a.blocks }, (_x, i) =>
        total[i]! > 1e-12 ? (a.bandMid[b]![i]! + a.bandSide[b]![i]!) / total[i]! : 0,
      ),
    ),
    crest,
    plr,
    width: widthCurve(a, null),
    widthBands: BANDS.map((_, b) => widthCurve(a, b)),
    correlation: Array.from(a.correlation, (c, i) => (a.meanSquare[i]! > 1e-9 ? c : null)),
    monoLoss: monoLossCurve(a),
  };
}

const LANES = [
  { id: 'wave', label: 'Forme d’onde', short: 'Forme d’onde', height: 110, topic: 'forme-onde' },
  { id: 'loudness', label: 'Sonie (LUFS)', short: 'Sonie', height: 150, topic: 'sonie' },
  {
    id: 'bands',
    label: 'Énergie par bande (dB)',
    short: 'Bandes',
    height: 200,
    topic: 'bandes',
  },
  {
    id: 'spectrogram',
    label: 'Spectrogramme (Hz)',
    short: 'Spectrogramme',
    height: 150,
    topic: 'spectrogramme',
  },
  {
    id: 'dynamics',
    label: 'Dynamique (dB · LU)',
    short: 'Dynamique',
    height: 120,
    topic: 'facteur-crete',
  },
  { id: 'width', label: 'Largeur stéréo (%)', short: 'Largeur', height: 100, topic: 'largeur' },
  {
    id: 'correlation',
    label: 'Corrélation de phase (−1 à +1)',
    short: 'Corrélation',
    height: 100,
    topic: 'correlation',
  },
  { id: 'mono', label: 'Compatibilité mono (dB)', short: 'Mono', height: 100, topic: 'mono' },
  { id: 'markers', label: 'Repères', short: 'Repères', height: 44, topic: 'reperes' },
] as const;
type LaneId = (typeof LANES)[number]['id'];
/** Shown by default: the essentials; the others one click away (choice remembered). */
const DEFAULT_LANES: LaneId[] = ['wave', 'loudness', 'bands', 'markers'];

const MARKER_LABELS: Record<Marker['kind'], string> = {
  over: 'Crête vraie au-dessus du seuil',
  clip: 'Écrêtage',
  phase: 'Problème de phase',
  silence: 'Silence',
};
const markerColor = (c: Colors, kind: Marker['kind']) =>
  ({ over: c.warning, clip: c.danger, phase: c.info, silence: c['text-3'] })[kind];

function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/** A line over blocks, between min and max (values outside are clamped). */
function line(
  ctx: CanvasRenderingContext2D,
  values: Series | number[],
  step: number,
  view: View,
  width: number,
  height: number,
  min: number,
  max: number,
  color: string,
  dashed = false,
) {
  const first = Math.max(0, Math.floor(view.start / step) - 1);
  const last = Math.min(values.length - 1, Math.ceil(view.end / step) + 1);
  const x = (i: number) => (((i + 0.5) * step - view.start) / (view.end - view.start)) * width;
  const y = (v: number) =>
    4 + (1 - (Math.max(min, Math.min(max, v)) - min) / (max - min)) * (height - 8);
  // Several values per pixel: keep one point per pixel (the extreme of the column would be noisier).
  const stride = Math.max(1, Math.floor((last - first) / (width * 2)));
  ctx.beginPath();
  let open = false;
  for (let i = first; i <= last; i += stride) {
    const v = values[i];
    if (v === null || v === undefined) {
      open = false;
      continue;
    }
    if (open) ctx.lineTo(x(i), y(v));
    else ctx.moveTo(x(i), y(v));
    open = true;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function grid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  min: number,
  max: number,
  ticks: number[],
  c: Colors,
  format: (v: number) => string,
) {
  ctx.font = '10px sans-serif';
  ctx.fillStyle = c['text-3'];
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  for (const t of ticks) {
    const y = 4 + (1 - (t - min) / (max - min)) * (height - 8);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillText(format(t), 4, y - 2);
  }
}

function draw(
  lane: LaneId,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  a: Analysis,
  curves: Curves,
  view: View,
  c: Colors,
  options: {
    stacked: boolean;
    band: number | null;
    list: Marker[];
    spectrogram: HTMLCanvasElement | null;
  },
) {
  const ctx = setupCanvas(canvas, width, height);
  const span = view.end - view.start;
  const xOf = (t: number) => ((t - view.start) / span) * width;
  if (lane === 'wave') {
    const mid = height / 2;
    ctx.strokeStyle = c.border;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(width, mid + 0.5);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    for (let px = 0; px < width; px++) {
      const t0 = view.start + (px / width) * span;
      const t1 = view.start + ((px + 1) / width) * span;
      const i0 = Math.max(0, Math.floor(t0 / FINE));
      const i1 = Math.min(a.waveMax.length, Math.max(i0 + 1, Math.ceil(t1 / FINE)));
      let lo = 0;
      let hi = 0;
      for (let i = i0; i < i1; i++) {
        if (a.waveMin[i]! < lo) lo = a.waveMin[i]!;
        if (a.waveMax[i]! > hi) hi = a.waveMax[i]!;
      }
      const top = mid - Math.min(1, hi) * (mid - 2);
      const bottom = mid - Math.max(-1, lo) * (mid - 2);
      ctx.fillRect(px, top, 1, Math.max(1, bottom - top));
    }
  } else if (lane === 'loudness') {
    grid(ctx, width, height, -40, 0, [-36, -24, -12, 0], c, (v) => fr(v, 0));
    if (curves.integrated !== null) {
      const y = 4 + (1 - (curves.integrated + 40) / 40) * (height - 8);
      ctx.strokeStyle = c['text-3'];
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    line(ctx, curves.momentary, BLOCK, view, width, height, -40, 0, c['series-2']);
    line(ctx, curves.short, BLOCK, view, width, height, -40, 0, c['series-1']);
  } else if (lane === 'bands') {
    if (options.stacked) {
      // Share of the energy of each band (sum = 100 %), stacked from the sub up.
      const first = Math.max(0, Math.floor(view.start / BLOCK));
      const last = Math.min(a.blocks - 1, Math.ceil(view.end / BLOCK));
      for (let b = BANDS.length - 1; b >= 0; b--) {
        ctx.beginPath();
        ctx.moveTo(xOf(first * BLOCK), height);
        for (let i = first; i <= last; i++) {
          let cumulative = 0;
          for (let k = 0; k <= b; k++) cumulative += curves.shares[k]![i]!;
          ctx.lineTo(xOf((i + 0.5) * BLOCK), height - cumulative * (height - 2));
        }
        ctx.lineTo(xOf((last + 1) * BLOCK), height);
        ctx.closePath();
        ctx.fillStyle = c[BAND_TOKENS[b]!];
        ctx.fill();
      }
    } else {
      grid(ctx, width, height, -80, -10, [-70, -50, -30, -10], c, (v) => `${fr(v, 0)} dB`);
      BANDS.forEach((_, b) =>
        line(ctx, curves.bands[b]!, BLOCK, view, width, height, -80, -10, c[BAND_TOKENS[b]!]),
      );
    }
  } else if (lane === 'spectrogram' && options.spectrogram) {
    const s = a.spectrogram;
    const sx = view.start / s.hopSec;
    const sw = span / s.hopSec;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(options.spectrogram, sx, 0, sw, s.bins, 0, 0, width, height);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = c['text-2'];
    for (const f of [100, 1000, 10_000]) {
      const y = height - (Math.log(f / s.fmin) / Math.log(s.fmax / s.fmin)) * height;
      ctx.fillText(f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, 4, y);
    }
  } else if (lane === 'dynamics') {
    grid(ctx, width, height, 0, 24, [6, 12, 18], c, (v) => `${fr(v, 0)}`);
    line(ctx, curves.crest, BLOCK, view, width, height, 0, 24, c['series-3']);
    line(ctx, curves.plr, BLOCK, view, width, height, 0, 24, c['series-5']);
  } else if (lane === 'width') {
    grid(ctx, width, height, 0, 1, [0.25, 0.5, 0.75], c, (v) => pct(v));
    line(ctx, curves.width, BLOCK, view, width, height, 0, 1, c['series-1']);
    if (options.band !== null)
      line(
        ctx,
        curves.widthBands[options.band]!,
        BLOCK,
        view,
        width,
        height,
        0,
        1,
        c[BAND_TOKENS[options.band]!],
        true,
      );
  } else if (lane === 'correlation') {
    grid(ctx, width, height, -1, 1, [-1, 0, 1], c, (v) => fr(v, 0));
    line(ctx, curves.correlation, BLOCK, view, width, height, -1, 1, c['series-4']);
  } else if (lane === 'mono') {
    grid(ctx, width, height, -12, 0, [-9, -6, -3, 0], c, (v) => `${fr(v, 0)} dB`);
    line(ctx, curves.monoLoss, BLOCK, view, width, height, -12, 0, c['series-6']);
  } else if (lane === 'markers') {
    for (const m of options.list) {
      if (m.end < view.start || m.start > view.end) continue;
      const x0 = xOf(m.start);
      const x1 = Math.max(x0 + 3, xOf(m.end));
      const row = { over: 0, clip: 1, phase: 2, silence: 3 }[m.kind];
      ctx.fillStyle = markerColor(c, m.kind);
      ctx.fillRect(x0, 2 + row * 8, x1 - x0, 6);
    }
  }
}

/** The spectrogram as an image (one column per frame, one row per bin), coloured once. */
function spectrogramImage(a: Analysis, c: Colors): HTMLCanvasElement {
  const s = a.spectrogram;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, s.frames);
  canvas.height = s.bins;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  const low = channelsOf(c['surface-2']);
  const high = channelsOf(c.accent);
  const top = channelsOf(c.text);
  for (let f = 0; f < s.frames; f++)
    for (let b = 0; b < s.bins; b++) {
      // 0…240 = −120…0 dB; shown from −100 dB.
      const db = s.data[f * s.bins + b]! / 2 - 120;
      const v = Math.max(0, Math.min(1, (db + 100) / 90));
      const [r0, g0, b0] = v < 0.7 ? low : high;
      const [r1, g1, b1] = v < 0.7 ? high : top;
      const t = v < 0.7 ? v / 0.7 : (v - 0.7) / 0.3;
      const o = ((s.bins - 1 - b) * canvas.width + f) * 4;
      image.data[o] = r0 + (r1 - r0) * t;
      image.data[o + 1] = g0 + (g1 - g0) * t;
      image.data[o + 2] = b0 + (b1 - b0) * t;
      image.data[o + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Values of every lane at an instant (hover). */
function valuesAt(t: number, a: Analysis, curves: Curves, list: Marker[]) {
  const i = Math.max(0, Math.min(a.blocks - 1, Math.floor(t / BLOCK)));
  const f = Math.max(0, Math.min(a.truePeakFine.length - 1, Math.floor(t / FINE)));
  const tp = a.truePeakFine[f]!;
  const here = list.filter((m) => t >= m.start - 0.02 && t <= m.end + 0.02);
  return {
    time: clock(t, 2),
    rows: [
      ['Sonie momentanée', `${fr(curves.momentary[i])} LUFS`],
      ['Sonie court terme', `${fr(curves.short[i])} LUFS`],
      ['Crête vraie (10 ms)', tp > 0 ? `${fr(20 * Math.log10(tp), 1, true)} dBTP` : '—'],
      ...BANDS.map((band, b) => [band.label, `${fr(curves.bands[b]![i])} dB`]),
      ['Facteur de crête (1 s)', `${fr(curves.crest[i])} dB`],
      ['PLR (3 s)', `${fr(curves.plr[i])} LU`],
      ['Largeur', pct(curves.width[i])],
      ['Corrélation', fr(curves.correlation[i], 2)],
      ['Perte au mono', `${fr(curves.monoLoss[i])} dB`],
      ...here.map((m) => [
        MARKER_LABELS[m.kind],
        m.kind === 'over'
          ? `${fr(m.value, 1, true)} dBTP`
          : m.kind === 'clip'
            ? `${m.value} éch.`
            : m.kind === 'phase'
              ? fr(m.value, 2)
              : `${fr(m.end - m.start)} s`,
      ]),
    ] as [string, string][],
  };
}

export function Timeline(props: {
  analysis: Analysis;
  sections: Section[];
  threshold: number;
  audio: HTMLAudioElement | null;
  /** Seek (and play) at a time. */
  onSeek: (time: number) => void;
}) {
  const a = props.analysis;
  const duration = a.blocks * BLOCK;
  const colors = useColors();
  const curves = useMemo(() => curvesOf(a), [a]);
  const list = useMemo(() => markers(a, props.threshold), [a, props.threshold]);
  const spectrogram = useMemo(() => spectrogramImage(a, colors), [a, colors]);
  const [view, setView] = useState<View>({ start: 0, end: duration });
  const [stacked, setStacked] = useState(false);
  const [band, setBand] = useState<number | null>(null);
  const lanes = useStoredChoice('timeline-lanes', DEFAULT_LANES);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const canvases = useRef(new Map<LaneId, HTMLCanvasElement>());
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    for (const lane of LANES) {
      const canvas = canvases.current.get(lane.id);
      if (canvas)
        draw(lane.id, canvas, width, lane.height, a, curves, view, colors, {
          stacked,
          band,
          list,
          spectrogram,
        });
    }
  }, [a, curves, view, colors, stacked, band, list, spectrogram, width, lanes.shown]);

  // Playback cursor.
  useEffect(() => {
    const audio = props.audio;
    if (!audio) return;
    let frame = 0;
    const tick = () => {
      setCursor(audio.currentTime);
      if (!audio.paused) frame = requestAnimationFrame(tick);
    };
    const start = () => (frame = requestAnimationFrame(tick));
    audio.addEventListener('play', start);
    audio.addEventListener('seeked', tick);
    audio.addEventListener('timeupdate', tick);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener('play', start);
      audio.removeEventListener('seeked', tick);
      audio.removeEventListener('timeupdate', tick);
    };
  }, [props.audio]);

  const span = view.end - view.start;
  const timeAt = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(duration, view.start + ((clientX - rect.left) / rect.width) * span),
    );
  };
  const zoom = (factor: number, centre = (view.start + view.end) / 2) => {
    const next = Math.max(1, Math.min(duration, span * factor));
    let start = centre - ((centre - view.start) / span) * next;
    start = Math.max(0, Math.min(duration - next, start));
    setView({ start, end: start + next });
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.shiftKey) {
      const shift = (event.deltaY / 500) * span;
      const start = Math.max(0, Math.min(duration - span, view.start + shift));
      setView({ start, end: start + span });
    } else if (event.ctrlKey || event.metaKey || event.altKey) {
      zoom(event.deltaY > 0 ? 1.25 : 0.8, timeAt(event.clientX));
    }
  };
  const xPercent = (t: number) => `${((t - view.start) / span) * 100}%`;
  const values = hover !== null ? valuesAt(hover, a, curves, list) : null;
  const visible = LANES.filter((l) => lanes.shown.has(l.id));

  const legend: Partial<Record<LaneId, { label: string; color: string; dashed?: boolean }[]>> = {
    loudness: [
      { label: 'Court terme (3 s)', color: colors['series-1'] },
      { label: 'Momentanée (400 ms)', color: colors['series-2'] },
      { label: `Intégrée ${fr(curves.integrated)} LUFS`, color: colors['text-3'], dashed: true },
    ],
    bands: BANDS.map((b, i) => ({
      label: `${b.label} ${b.from}–${b.to >= 1000 ? `${b.to / 1000}k` : b.to}`,
      color: colors[BAND_TOKENS[i]!],
    })),
    dynamics: [
      { label: 'Facteur de crête 1 s (dB)', color: colors['series-3'] },
      { label: 'PLR 3 s (LU)', color: colors['series-5'] },
    ],
    width: [
      { label: 'Tout le spectre', color: colors['series-1'] },
      ...(band !== null
        ? [{ label: BANDS[band]!.label, color: colors[BAND_TOKENS[band]!], dashed: true }]
        : []),
    ],
    markers: (['over', 'clip', 'phase', 'silence'] as const).map((k) => ({
      label: `${MARKER_LABELS[k]} (${list.filter((m) => m.kind === k).length})`,
      color: markerColor(colors, k),
    })),
  };

  return (
    <div className="ma-timeline">
      <div className="toolbar ma-timeline__tools">
        <Button variant="secondary" small onClick={() => zoom(0.5)}>
          Zoom +
        </Button>
        <Button variant="secondary" small onClick={() => zoom(2)}>
          Zoom −
        </Button>
        <Button variant="secondary" small onClick={() => setView({ start: 0, end: duration })}>
          Tout
        </Button>
        <span className="small muted">
          {clock(view.start)} → {clock(view.end)} · Ctrl + molette : zoom · Maj + molette : défiler
          · clic : lire
        </span>
        {lanes.shown.has('bands') && (
          <label className="small">
            <input
              type="checkbox"
              checked={stacked}
              onChange={(e) => setStacked(e.target.checked)}
            />{' '}
            Bandes empilées
          </label>
        )}
        {lanes.shown.has('width') && (
          <label className="small">
            Largeur d’une bande{' '}
            <select
              className="input input--short"
              value={band ?? ''}
              onChange={(e) => setBand(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">—</option>
              {BANDS.map((b, i) => (
                <option key={b.id} value={i}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <Choice
        label="Pistes affichées"
        options={LANES.map((l) => ({ id: l.id, label: l.short }))}
        shown={lanes.shown}
        onToggle={lanes.toggle}
      />
      <Overview a={a} view={view} onView={setView} color={colors['text-3']} cursor={cursor} />
      <div className="ma-lanes-wrap">
        <div className="ma-lane-labels">
          <div className="ma-sections-label small muted">
            Sections
            <Help topic="vue-sections" />
          </div>
          {visible.map((lane) => (
            <div key={lane.id} className="ma-lane-label small" style={{ height: lane.height }}>
              <span>
                {lane.label}
                <Help topic={lane.topic} />
              </span>
              {legend[lane.id] && lane.id !== 'markers' && (
                <ul className="ma-legend">
                  {legend[lane.id]!.map((item) => (
                    <li key={item.label}>
                      <i
                        className={item.dashed ? 'ma-swatch ma-swatch--dashed' : 'ma-swatch'}
                        style={{
                          borderColor: item.color,
                          background: item.dashed ? undefined : item.color,
                        }}
                      />
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <div
          className="ma-lanes"
          ref={box}
          onWheel={onWheel}
          onPointerMove={(e: PointerEvent<HTMLDivElement>) => setHover(timeAt(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => props.onSeek(timeAt(e.clientX))}
          role="img"
          aria-label="Ligne de temps de l’analyse"
        >
          <div className="ma-sections">
            {props.sections.map((s, i) => (
              <div
                key={`${s.start}-${i}`}
                className={`ma-section ma-section--${i % 2}`}
                style={{ left: xPercent(s.start), width: `${((s.end - s.start) / span) * 100}%` }}
                title={`${s.label} : ${clock(s.start)} → ${clock(s.end)}`}
              >
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          {visible.map((lane) => (
            <canvas
              key={lane.id}
              className="ma-lane"
              ref={(el) => {
                if (el) canvases.current.set(lane.id, el);
                else canvases.current.delete(lane.id);
              }}
              style={{ height: lane.height }}
            />
          ))}
          {cursor >= view.start && cursor <= view.end && (
            <div className="ma-cursor" style={{ left: xPercent(cursor) }} />
          )}
          {hover !== null && <div className="ma-hover" style={{ left: xPercent(hover) }} />}
          {values && hover !== null && (
            <div
              className={`ma-tip small ${hover > view.start + span / 2 ? 'ma-tip--left' : ''}`}
              style={{ left: xPercent(hover) }}
            >
              <strong>{values.time}</strong>
              <table>
                <tbody>
                  {values.rows.map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {lanes.shown.has('markers') && (
        <ul className="ma-legend ma-legend--row ma-legend--markers" aria-label="Repères">
          {legend.markers!.map((item) => (
            <li key={item.label}>
              <i
                className="ma-swatch"
                style={{ borderColor: item.color, background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The whole file in small, with the window of the zoom (drag it to move). */
function Overview(props: {
  a: Analysis;
  view: View;
  onView: (v: View) => void;
  color: string;
  cursor: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const duration = props.a.blocks * BLOCK;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const width = canvas.parentElement?.clientWidth ?? 800;
    const ctx = setupCanvas(canvas, width, 28);
    ctx.fillStyle = props.color;
    const a = props.a;
    for (let px = 0; px < width; px++) {
      const i0 = Math.floor((px / width) * a.waveMax.length);
      const i1 = Math.max(i0 + 1, Math.floor(((px + 1) / width) * a.waveMax.length));
      let hi = 0;
      for (let i = i0; i < i1; i++) hi = Math.max(hi, a.waveMax[i]!, -a.waveMin[i]!);
      ctx.fillRect(px, 14 - hi * 13, 1, Math.max(1, hi * 26));
    }
  }, [props.a, props.color]);
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1 && event.type !== 'pointerdown') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const span = props.view.end - props.view.start;
    const centre = ((event.clientX - rect.left) / rect.width) * duration;
    const start = Math.max(0, Math.min(duration - span, centre - span / 2));
    props.onView({ start, end: start + span });
  };
  return (
    <div
      className="ma-overview"
      onPointerDown={drag}
      onPointerMove={drag}
      title="Faire glisser pour se déplacer"
    >
      <canvas ref={ref} />
      <div
        className="ma-overview__window"
        style={{
          left: `${(props.view.start / duration) * 100}%`,
          width: `${((props.view.end - props.view.start) / duration) * 100}%`,
        }}
      />
      <div className="ma-cursor" style={{ left: `${(props.cursor / duration) * 100}%` }} />
    </div>
  );
}
