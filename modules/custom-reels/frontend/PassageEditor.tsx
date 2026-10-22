// The video passage of a Reel: only its START is chosen, its duration is the
// Reel's (the same « Durée » as the track excerpt). A fixed-width window on the
// video's filmstrip, dragged or placed by a click, like the excerpt on the
// waveform. Chained passages (advanced) share the Reel's duration.
import { useRef, useState } from 'react';
import { Button, FilmstripWindow, formatDuration, useApi, useModule } from '@hub/sdk/frontend';
import type { Reel, Segment, Source } from './types';

export const CLIPS = [15, 20, 25, 28, 30, 35, 40, 45, 50, 55, 60];

const seconds = (n: number) => `${n.toFixed(1).replace('.', ',')} s`;

/** Frames of a source video, for its timeline and the focus picker. */
export function useFilmstrip(sourceId: number | null) {
  const module = useModule();
  return useApi<{ frames: string[] }>(
    sourceId === null ? null : module.url(`/sources/${sourceId}/filmstrip`),
  );
}

/** One exact frame of a video (first or last image of the passage). */
function FrameThumb(props: { sourceId: number; time: number; label: string }) {
  const module = useModule();
  const frame = useApi<{ url: string | null }>(
    module.url(`/sources/${props.sourceId}/frame?t=${props.time.toFixed(1)}`),
  );
  return (
    <figure className="cr-frame">
      {frame.data?.url ? <img src={frame.data.url} alt="" /> : <span className="cr-frame__empty" />}
      <figcaption className="small muted num">
        {props.label} · {formatDuration(props.time)}
      </figcaption>
    </figure>
  );
}

/** One passage: its video, the window on the filmstrip, start and end, first and last image. */
function PassageWindow(props: {
  passage: Segment;
  sources: Source[];
  locked: boolean;
  chained: boolean;
  onChange: (passage: Segment) => void;
}) {
  const { passage } = props;
  const source = props.sources.find((s) => s.id === passage.sourceId) ?? props.sources[0];
  const strip = useFilmstrip(source?.id ?? null);
  const video = useRef<HTMLVideoElement>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const start = preview ?? passage.start;
  const end = Math.min(source?.durationSec ?? 0, start + passage.duration);
  if (!source) return null;
  return (
    <div className="cr-passage">
      <div className="cr-passage__head">
        <select
          className="input"
          aria-label="Vidéo du passage"
          value={source.id}
          disabled={props.locked}
          onChange={(e) =>
            props.onChange({ ...passage, sourceId: Number(e.target.value), start: 0 })
          }
        >
          {props.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <strong className="num">
          de {formatDuration(start)} à {formatDuration(end)}
        </strong>
        <span className="muted small num">
          {seconds(passage.duration)}
          {source.durationSec < passage.duration && ' (vidéo bouclée)'}
        </span>
      </div>
      <div className="cr-passage__body">
        {source.url && (
          <video
            ref={video}
            className="cr-passage__video"
            src={`${source.url}#t=${start}`}
            muted
            playsInline
            preload="metadata"
          />
        )}
        <div className="cr-passage__frames">
          <FrameThumb sourceId={source.id} time={start} label="Première image" />
          <FrameThumb sourceId={source.id} time={Math.max(0, end - 0.1)} label="Dernière image" />
        </div>
      </div>
      <FilmstripWindow
        frames={strip.data?.frames ?? []}
        durationSec={source.durationSec}
        windowSec={passage.duration}
        start={passage.start}
        locked={props.locked}
        onPreview={(time) => {
          setPreview(time);
          if (video.current) video.current.currentTime = time;
        }}
        onMove={(time) => {
          setPreview(null);
          props.onChange({ ...passage, start: time });
        }}
        label={`Passage de ${seconds(passage.duration)} sur « ${source.name} »`}
      />
      {!props.chained && source.durationSec < passage.duration && (
        <p className="small cr-warning">
          Vidéo plus courte que le Reel ({seconds(source.durationSec)}) : elle sera bouclée
          (relancée au début).
        </p>
      )}
    </div>
  );
}

/** The « Vidéo » section of a Reel. */
export function PassageEditor(props: {
  reel: Reel;
  sources: Source[];
  locked: boolean;
  onPatch: (fields: Record<string, unknown>) => void;
}) {
  const { reel, locked } = props;
  const passages = reel.segments;
  const chained = passages.length > 1;
  const set = (next: Segment[]) =>
    props.onPatch({
      segments: next.map((p) => ({ sourceId: p.sourceId, start: p.start, duration: p.duration })),
    });
  const total = passages.reduce((sum, p) => sum + p.duration, 0);

  return (
    <div className="cr-passages">
      <div className="inline-form">
        <label className="cr-inline-field small">
          Durée du Reel
          <select
            className="input input--short"
            value={reel.durationSec}
            disabled={locked}
            onChange={(e) => props.onPatch({ durationSec: Number(e.target.value) })}
          >
            {CLIPS.map((clip) => (
              <option key={clip} value={clip}>
                {clip} s
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          {reel.audioMode === 'track'
            ? 'La même durée que l’extrait du morceau : chacun a son propre départ.'
            : 'Le son suit le passage choisi.'}{' '}
          Glisse la fenêtre sur la pellicule, ou clique pour placer le début.
        </p>
      </div>
      {passages.map((passage, index) => (
        <div key={`${index}-${passage.sourceId}`}>
          {chained && (
            <div className="cr-passage__chain">
              <span className="label">Passage {index + 1}</span>
              <label className="small">
                Durée{' '}
                <input
                  className="input input--short"
                  type="number"
                  min={0.5}
                  step={0.1}
                  value={passage.duration}
                  disabled={locked || index === passages.length - 1}
                  title={
                    index === passages.length - 1
                      ? 'Le dernier passage prend ce qui reste de la durée du Reel'
                      : undefined
                  }
                  onChange={(e) =>
                    set(
                      passages.map((p, i) =>
                        i === index ? { ...p, duration: Number(e.target.value) } : p,
                      ),
                    )
                  }
                />
              </label>
              <Button
                variant="secondary"
                small
                disabled={locked}
                onClick={() => set(passages.filter((_, i) => i !== index))}
              >
                Retirer
              </Button>
            </div>
          )}
          <PassageWindow
            passage={passage}
            sources={props.sources}
            locked={locked}
            chained={chained}
            onChange={(next) => set(passages.map((p, i) => (i === index ? next : p)))}
          />
        </div>
      ))}
      {reel.passagesError && <p className="small cr-warning">{reel.passagesError}</p>}
      <details className="cr-advanced" open={chained}>
        <summary className="small">Plusieurs passages enchaînés (avancé)</summary>
        <p className="muted small">
          Coupes franches entre les passages. Leurs durées font toujours exactement la durée du Reel
          : le dernier prend ce qui reste.{' '}
          {chained && (
            <strong className="num">
              Total : {seconds(total)} sur {reel.durationSec} s
            </strong>
          )}
        </p>
        <Button
          variant="secondary"
          small
          disabled={locked || passages.length >= 12 || props.sources.length === 0}
          onClick={() => {
            // The last passage is split in two: the new one takes half of it.
            const last = passages[passages.length - 1]!;
            const half = Math.max(0.5, Math.round((last.duration / 2) * 10) / 10);
            set([
              ...passages.slice(0, -1),
              { ...last, duration: last.duration - half },
              {
                sourceId: last.sourceId,
                start: last.start + last.duration - half,
                duration: half,
                end: 0,
              },
            ]);
          }}
        >
          Ajouter un passage
        </Button>
      </details>
    </div>
  );
}
