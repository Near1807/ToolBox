import type { MouseEvent } from 'react';

/**
 * Clickable waveform: a click sets the start of the excerpt; the selected
 * excerpt is highlighted and the playback position shown.
 */
export function Waveform(props: {
  peaks: number[];
  durationSec: number;
  start: number;
  clipSec: number;
  playheadSec: number | null;
  onSelect: (start: number) => void;
}) {
  const { peaks, durationSec, start, clipSec } = props;
  const percent = (seconds: number) =>
    `${(Math.min(durationSec, Math.max(0, seconds)) / durationSec) * 100}%`;

  const select = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    const wanted = fraction * durationSec;
    props.onSelect(
      Math.round(Math.min(Math.max(0, wanted), Math.max(0, durationSec - clipSec)) * 10) / 10,
    );
  };

  return (
    <div
      className="iv-wave"
      onClick={select}
      role="slider"
      aria-label="Point de départ de l’extrait"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationSec)}
      aria-valuenow={Math.round(start)}
      tabIndex={0}
    >
      <div
        className="iv-wave__selection"
        style={{ left: percent(start), width: percent(clipSec) }}
      />
      <div className="iv-wave__bars">
        {peaks.map((peak, index) => {
          const time = ((index + 0.5) / peaks.length) * durationSec;
          const inside = time >= start && time <= start + clipSec;
          return (
            <span
              key={index}
              className={`iv-wave__bar${inside ? ' iv-wave__bar--selected' : ''}`}
              style={{ height: `${Math.max(3, peak * 100)}%` }}
            />
          );
        })}
      </div>
      {props.playheadSec !== null && (
        <div className="iv-wave__playhead" style={{ left: percent(props.playheadSec) }} />
      )}
    </div>
  );
}
