// The video passage of a Reel: only its START is chosen, its duration is the
// Reel's (the same « Durée » as the track excerpt). A fixed-width window on the
// video's filmstrip, dragged or placed by a click, like the excerpt on the
// waveform; a large player above it, and « Lire le passage » that plays the
// passage exactly, with the sound of the chosen mode (no render). Chained
// passages (advanced) share the Reel's duration.
import { useEffect, useRef, useState } from 'react';
import { Button, FilmstripWindow, formatDuration, useApi, useModule } from '@hub/sdk/frontend';
import type { Reel, Segment, Source } from './types';

export const CLIPS = [15, 20, 25, 28, 30, 35, 40, 45, 50, 55, 60];

const seconds = (n: number) => `${n.toFixed(1).replace('.', ',')} s`;

/** Frames of a source video: 12 for the focus picker, more for the zoomable timeline. */
export function useFilmstrip(sourceId: number | null, count = 12) {
  const module = useModule();
  return useApi<{ frames: string[] }>(
    sourceId === null
      ? null
      : module.url(`/sources/${sourceId}/filmstrip${count === 12 ? '' : `?count=${count}`}`),
  );
}

/** About one frame every 2 s (24 to 120): enough to zoom on long videos. */
const timelineFrames = (duration: number) => Math.min(120, Math.max(24, Math.round(duration / 2)));

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

/** One passage: its video, start and end, first and last image, the window on the filmstrip. */
function PassageWindow(props: {
  passage: Segment;
  sources: Source[];
  locked: boolean;
  chained: boolean;
  active: boolean;
  playheadSec: number | null;
  onSeek: (sourceId: number, time: number) => void;
  onChange: (passage: Segment) => void;
}) {
  const { passage } = props;
  const source = props.sources.find((s) => s.id === passage.sourceId) ?? props.sources[0];
  const strip = useFilmstrip(source?.id ?? null, timelineFrames(source?.durationSec ?? 0));
  const [preview, setPreview] = useState<number | null>(null);
  if (!source) return null;
  const start = preview ?? passage.start;
  const end = Math.min(source.durationSec, start + passage.duration);
  return (
    <div className={`cr-passage${props.active ? ' cr-passage--active' : ''}`}>
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
        <FilmstripWindow
          frames={strip.data?.frames ?? []}
          durationSec={source.durationSec}
          windowSec={passage.duration}
          start={passage.start}
          playheadSec={props.active ? props.playheadSec : null}
          locked={props.locked}
          onPreview={(time) => {
            setPreview(time);
            props.onSeek(source.id, time);
          }}
          onMove={(time) => {
            setPreview(null);
            props.onSeek(source.id, time);
            props.onChange({ ...passage, start: time });
          }}
          label={`Passage de ${seconds(passage.duration)} sur « ${source.name} »`}
        />
        <div className="cr-passage__frames">
          <FrameThumb sourceId={source.id} time={start} label="Première image" />
          <FrameThumb sourceId={source.id} time={Math.max(0, end - 0.1)} label="Dernière image" />
        </div>
      </div>
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
  /** The track's audio (« Son du morceau », « Morceau synchronisé »). */
  audioUrl: string | null;
  locked: boolean;
  onPatch: (fields: Record<string, unknown>) => void;
}) {
  const { reel, locked } = props;
  const passages = reel.segments;
  const chained = passages.length > 1;
  const total = passages.reduce((sum, p) => sum + p.duration, 0);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const frame = useRef<number | null>(null);
  const [shown, setShown] = useState<{ sourceId: number; time: number }>({
    sourceId: passages[0]?.sourceId ?? props.sources[0]?.id ?? 0,
    time: passages[0]?.start ?? 0,
  });
  const [active, setActive] = useState(0);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sourceOf = (id: number) => props.sources.find((s) => s.id === id);
  const shownSource = sourceOf(shown.sourceId) ?? props.sources[0];

  const set = (next: Segment[]) =>
    props.onPatch({
      segments: next.map((p) => ({ sourceId: p.sourceId, start: p.start, duration: p.duration })),
    });

  /** Shows a time of a video in the large player (paused). */
  const seek = (sourceId: number, time: number) => {
    stop();
    setShown({ sourceId, time });
    const el = video.current;
    if (el && sourceOf(sourceId)?.url && el.dataset.source === String(sourceId)) {
      el.currentTime = time;
    }
  };

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    video.current?.pause();
    audio.current?.pause();
    setPlaying(false);
  };
  useEffect(() => () => stop(), []);

  /**
   * « Lire le passage »: the passages one after the other, exactly their
   * durations, with the sound of the mode: the track excerpt (continuous),
   * the video's own sound, or the master placed with the detected offset.
   */
  const play = async () => {
    stop();
    setNotice(null);
    const mode = reel.audioMode;
    if (mode !== 'video' && !props.audioUrl) return setNotice('Son du morceau introuvable');
    if (mode === 'synced') {
      const missing = passages.find((p) => !sourceOf(p.sourceId)?.sync?.reliable);
      if (missing) {
        return setNotice(
          'Morceau pas (encore) retrouvé de façon fiable dans cette vidéo : « Retrouver le morceau dans la vidéo », ou choisis « Son de la vidéo ».',
        );
      }
    }
    const el = video.current;
    const sound = audio.current;
    if (!el || !sound) return;
    const bounds = passages.reduce<number[]>(
      (list, p) => [...list, (list.at(-1) ?? 0) + p.duration],
      [],
    );
    let current = -1;
    const enter = async (index: number, offsetInPassage: number) => {
      const p = passages[index]!;
      const src = sourceOf(p.sourceId)!;
      current = index;
      setActive(index);
      if (el.dataset.source !== String(src.id)) {
        el.src = src.url ?? '';
        el.dataset.source = String(src.id);
        await new Promise((resolve) =>
          el.addEventListener('loadedmetadata', resolve, { once: true }),
        );
      }
      const inVideo = src.durationSec > 0 ? (p.start + offsetInPassage) % src.durationSec : 0;
      el.currentTime = inVideo;
      el.muted = mode !== 'video';
      if (mode === 'synced') {
        sound.currentTime = p.start + offsetInPassage + (src.sync?.offset ?? 0);
      }
      await el.play();
    };
    setPlaying(true);
    if (mode !== 'video') {
      sound.src = props.audioUrl!;
      sound.currentTime = mode === 'track' ? reel.startSec : 0;
    }
    await enter(0, 0);
    if (mode !== 'video') await sound.play();
    const t0 = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000;
      if (elapsed >= total) {
        stop();
        setPlayhead(null);
        return;
      }
      const index = bounds.findIndex((b) => elapsed < b);
      const passageStart = index > 0 ? bounds[index - 1]! : 0;
      if (index !== current) void enter(index, elapsed - passageStart);
      // A video shorter than the Reel is looped, like in the render.
      if (el.ended || (el.duration && el.currentTime >= el.duration - 0.04)) {
        el.currentTime = 0;
        void el.play();
      }
      setPlayhead(el.currentTime);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  return (
    <div className="cr-passages">
      <div className="cr-player">
        {shownSource?.url ? (
          <video
            ref={video}
            className="cr-player__video"
            src={`${shownSource.url}#t=${shown.time}`}
            data-source={shownSource.id}
            playsInline
            preload="auto"
            muted
            onLoadedMetadata={(e) => {
              if (!playing) e.currentTarget.currentTime = shown.time;
            }}
            onTimeUpdate={(e) => !playing && setPlayhead(e.currentTarget.currentTime)}
          />
        ) : (
          <div className="cr-player__video cr-player__empty muted">Vidéo introuvable</div>
        )}
        <audio ref={audio} preload="auto" />
        <div className="inline-form cr-player__bar">
          <Button small onClick={() => void (playing ? stop() : play())}>
            {playing ? 'Arrêter' : 'Lire le passage'}
          </Button>
          <span className="muted small">
            {reel.audioMode === 'track'
              ? 'Avec l’extrait du morceau.'
              : reel.audioMode === 'video'
                ? 'Avec le son de la vidéo (non normalisé à l’écoute).'
                : 'Avec le master calé sur la vidéo.'}{' '}
            Sans rendu : pour valider l’intervalle avant de générer.
          </span>
        </div>
        {notice && <p className="small cr-warning">{notice}</p>}
      </div>
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
            active={index === active}
            playheadSec={playhead}
            onSeek={(sourceId, time) => {
              setActive(index);
              seek(sourceId, time);
            }}
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
            // The last passage is split in two: the new one takes its second half.
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
