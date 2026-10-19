import { useRef, useState, type PointerEvent } from 'react';

export interface WaveRegion {
  id: number;
  /** 1..4, used for the colour and the number shown. */
  position: number;
  start: number;
  clipSec: number;
  /** Published Reels cannot be moved. */
  locked: boolean;
}

/**
 * Waveform with one coloured region per Reel. Drag a region to move its
 * start; a click outside the regions moves the active Reel there.
 */
export function Waveform(props: {
  peaks: number[];
  durationSec: number;
  regions: WaveRegion[];
  activeId: number | null;
  playheadSec: number | null;
  onActivate: (id: number) => void;
  onMove: (id: number, start: number) => void;
}) {
  const { peaks, durationSec, regions } = props;
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: number; offset: number; start: number } | null>(null);
  const percent = (seconds: number) =>
    `${(Math.min(durationSec, Math.max(0, seconds)) / durationSec) * 100}%`;

  const timeAt = (event: PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * durationSec;
  };
  const fit = (start: number, clip: number) =>
    Math.round(Math.min(Math.max(0, start), Math.max(0, durationSec - clip)) * 10) / 10;
  const startOf = (region: WaveRegion) => (drag?.id === region.id ? drag.start : region.start);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    const time = timeAt(event);
    const under = regions.filter(
      (r) => !r.locked && time >= startOf(r) && time <= startOf(r) + r.clipSec,
    );
    const target = under.find((r) => r.id === props.activeId) ?? under[0];
    if (target) {
      props.onActivate(target.id);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ id: target.id, offset: time - target.start, start: target.start });
      return;
    }
    const active = regions.find((r) => r.id === props.activeId && !r.locked);
    if (active) props.onMove(active.id, fit(time, active.clipSec));
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const region = regions.find((r) => r.id === drag.id)!;
    setDrag({ ...drag, start: fit(timeAt(event) - drag.offset, region.clipSec) });
  };

  const up = () => {
    if (!drag) return;
    const region = regions.find((r) => r.id === drag.id);
    if (region && drag.start !== region.start) props.onMove(drag.id, drag.start);
    setDrag(null);
  };

  return (
    <div
      ref={box}
      className="iv-wave"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      role="group"
      aria-label="Extraits des Reels sur la forme d’onde"
    >
      <div className="iv-wave__bars">
        {peaks.map((peak, index) => (
          <span
            key={index}
            className="iv-wave__bar"
            style={{ height: `${Math.max(3, peak * 100)}%` }}
          />
        ))}
      </div>
      {regions.map((region) => (
        <div
          key={region.id}
          className={[
            'iv-wave__region',
            `iv-wave__region--${region.position}`,
            region.id === props.activeId ? 'iv-wave__region--active' : '',
            region.locked ? 'iv-wave__region--locked' : '',
          ].join(' ')}
          style={{ left: percent(startOf(region)), width: percent(region.clipSec) }}
        >
          <span>{region.position}</span>
        </div>
      ))}
      {props.playheadSec !== null && (
        <div className="iv-wave__playhead" style={{ left: percent(props.playheadSec) }} />
      )}
    </div>
  );
}
