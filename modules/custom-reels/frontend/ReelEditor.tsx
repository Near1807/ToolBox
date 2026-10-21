import { useRef, useState, type MouseEvent } from 'react';
import {
  Button,
  confirmDelete,
  ErrorMessage,
  errorMessage,
  FileActions,
  formatDuration,
  MediaThumb,
  OutputCard,
  outputs,
  PublishedCheck,
  StateBadge,
  TextFields,
  useApi,
  useModule,
  type JobInfo,
  type StateTone,
} from '@hub/sdk/frontend';
import { STATE_LABELS, type EffectInfo, type Reel, type Segment, type Source } from './types';

const STATE_TONES: Record<Reel['state'], StateTone> = {
  draft: 'neutral',
  rendering: 'running',
  ready: 'success',
  outdated: 'warning',
  failed: 'danger',
  missing: 'warning',
};

/** Frames of a source video, for its timeline and the focus picker. */
function useFilmstrip(sourceId: number | null) {
  const module = useModule();
  return useApi<{ frames: string[] }>(
    sourceId === null ? null : module.url(`/sources/${sourceId}/filmstrip`),
  );
}

/** One passage of a video: source, start and end on a filmstrip, with a preview of its start. */
function SegmentEditor(props: {
  segment: Segment;
  index: number;
  sources: Source[];
  onChange: (segment: Segment) => void;
  onRemove?: () => void;
}) {
  const { segment } = props;
  const source = props.sources.find((s) => s.id === segment.sourceId) ?? props.sources[0];
  const strip = useFilmstrip(source?.id ?? null);
  const video = useRef<HTMLVideoElement>(null);
  const [draft, setDraft] = useState(segment);
  const [base, setBase] = useState(segment);
  if (base !== segment) {
    setBase(segment);
    setDraft(segment);
  }
  const duration = source?.durationSec ?? 0;
  const seek = (time: number) => {
    if (video.current) video.current.currentTime = time;
  };
  const commit = (next: Segment) => {
    if (next.end - next.start >= 0.5) props.onChange(next);
  };
  const percent = (t: number) =>
    `${(Math.min(duration, Math.max(0, t)) / Math.max(0.1, duration)) * 100}%`;

  return (
    <div className="cr-segment">
      <div className="cr-segment__head">
        <span className="label">Passage {props.index + 1}</span>
        <select
          className="input"
          aria-label="Vidéo du passage"
          value={source?.id}
          onChange={(e) => {
            const next = props.sources.find((s) => s.id === Number(e.target.value));
            if (next)
              commit({
                sourceId: next.id,
                start: 0,
                end: Math.min(next.durationSec, segment.end - segment.start),
              });
          }}
        >
          {props.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="num small">
          {formatDuration(draft.start)} → {formatDuration(draft.end)} ·{' '}
          {(draft.end - draft.start).toFixed(1)} s
        </span>
        {props.onRemove && (
          <Button variant="secondary" small onClick={props.onRemove}>
            Retirer
          </Button>
        )}
      </div>
      <div className="cr-segment__body">
        {source?.url && (
          <video
            ref={video}
            className="cr-segment__video"
            src={`${source.url}#t=${segment.start}`}
            muted
            playsInline
            preload="metadata"
            onClick={(e) =>
              e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause()
            }
            onTimeUpdate={(e) => {
              if (e.currentTarget.currentTime >= draft.end) {
                e.currentTarget.pause();
                e.currentTarget.currentTime = draft.start;
              }
            }}
            title="Clic : lire le passage (sans son)"
          />
        )}
        <div className="cr-timeline">
          <div className="cr-timeline__strip">
            {(strip.data?.frames ?? []).map((frame) => (
              <img key={frame} src={frame} alt="" draggable={false} />
            ))}
            <div
              className="cr-timeline__range"
              style={{
                left: percent(draft.start),
                width: `calc(${percent(draft.end)} - ${percent(draft.start)})`,
              }}
            />
          </div>
          <label className="cr-timeline__slider">
            <span className="small muted">Début</span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={draft.start}
              onChange={(e) => {
                const start = Math.min(Number(e.target.value), draft.end - 0.5);
                setDraft({ ...draft, start });
                seek(start);
              }}
              onPointerUp={() => commit(draft)}
              onKeyUp={() => commit(draft)}
            />
          </label>
          <label className="cr-timeline__slider">
            <span className="small muted">Fin</span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={draft.end}
              onChange={(e) => {
                const end = Math.max(Number(e.target.value), draft.start + 0.5);
                setDraft({ ...draft, end });
                seek(end);
              }}
              onPointerUp={() => commit(draft)}
              onKeyUp={() => commit(draft)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

/** Click on the picture to choose what stays in the frame (« Remplir »). */
function FocusPicker(props: {
  sourceId: number;
  focus: { x: number; y: number };
  onChange: (focus: { x: number; y: number }) => void;
}) {
  const strip = useFilmstrip(props.sourceId);
  const frame = strip.data?.frames[Math.floor((strip.data.frames.length - 1) / 2)];
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    props.onChange({
      x: Math.round(((event.clientX - rect.left) / rect.width) * 100) / 100,
      y: Math.round(((event.clientY - rect.top) / rect.height) * 100) / 100,
    });
  };
  if (!frame) return <p className="muted small">Chargement de l’image…</p>;
  return (
    <div className="cr-focus" onClick={pick} title="Clique sur ce qui doit rester dans le cadre">
      <img src={frame} alt="" draggable={false} />
      <span
        className="cr-focus__dot"
        style={{ left: `${props.focus.x * 100}%`, top: `${props.focus.y * 100}%` }}
      />
    </div>
  );
}

/** Everything about one Reel: the file (shared card), effect, framing, passages, caption. */
export function ReelEditor(props: {
  reel: Reel;
  sources: Source[];
  effects: EffectInfo[];
  job: JobInfo | null;
  onChanged: () => void;
  onCancel: (jobId: string) => void;
}) {
  const module = useModule();
  const { reel } = props;
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; looped: boolean; key: string } | null>(
    null,
  );
  const [previewing, setPreviewing] = useState(false);
  const rendering = reel.state === 'rendering';
  const locked = Boolean(reel.publishedAt);

  // A changed setting makes the preview stale: it is shown only for the settings it was made with.
  const settingsKey = JSON.stringify([
    reel.effect,
    reel.framing,
    reel.focus,
    reel.segments,
    reel.startSec,
  ]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      props.onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const patch = (fields: Record<string, unknown>) =>
    run(() => module.api.patch(`/reels/${reel.id}`, fields));
  const setSegments = (segments: Segment[]) => patch({ segments });

  const makePreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      const key = settingsKey;
      const result = await module.api.post<{ url: string; looped: boolean }>(
        `/reels/${reel.id}/preview`,
      );
      setPreview({ ...result, key });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="cr-reel">
      <div className="cr-reel__file">
        <OutputCard
          title={reel.label}
          badge={<StateBadge tone={STATE_TONES[reel.state]}>{STATE_LABELS[reel.state]}</StateBadge>}
          dimmed={locked}
          thumb={
            <MediaThumb
              src={reel.thumbnailUrl}
              aspect="vertical"
              dragUrl={reel.url}
              placeholder="Reel 9:16"
            />
          }
          meta={`${formatDuration(reel.startSec)} → ${formatDuration(reel.startSec + reel.durationSec)}`}
          rendering={rendering && props.job !== null}
          progress={props.job?.status === 'running' ? props.job.progress : null}
          onCancel={props.job ? () => props.onCancel(props.job!.id) : undefined}
          error={reel.error}
          missing={
            reel.state === 'missing' && reel.outputId !== null
              ? {
                  onForget: () => void run(() => outputs.forget([reel.outputId!])),
                  onRegenerate: () => void run(() => module.api.post(`/reels/${reel.id}/render`)),
                }
              : null
          }
          published={
            <PublishedCheck
              publishedAt={reel.publishedAt}
              onChange={(change) => void patch(change)}
            />
          }
          actions={
            <FileActions
              busy={rendering}
              onOpen={
                reel.url
                  ? () => void run(() => module.api.post(`/reels/${reel.id}/open`))
                  : undefined
              }
              onReveal={
                reel.url
                  ? () => void run(() => module.api.post(`/reels/${reel.id}/reveal`))
                  : undefined
              }
              onRegenerate={() => void run(() => module.api.post(`/reels/${reel.id}/render`))}
              regenerateLabel={reel.state === 'draft' ? 'Générer' : 'Régénérer'}
              onDelete={() => {
                if (
                  confirmDelete(`le ${reel.label}${reel.fileName ? ` (« ${reel.fileName} »)` : ''}`)
                ) {
                  void run(() => module.api.delete(`/reels/${reel.id}`));
                }
              }}
            />
          }
        >
          <TextFields
            fields={[
              { key: 'caption', label: 'Légende', multiline: true, rows: 4, max: 2200, copy: true },
            ]}
            values={{ caption: reel.caption }}
            custom={reel.captionCustom}
            readOnly={locked}
            onSave={async ({ caption }) => {
              await module.api.patch(`/reels/${reel.id}`, { caption });
              props.onChanged();
            }}
            onReset={async () => {
              await module.api.patch(`/reels/${reel.id}`, { caption: null });
              props.onChanged();
            }}
            onSaveAsTemplate={async ({ caption }) => {
              await module.api.post(`/reels/${reel.id}/caption/template`, { caption });
              props.onChanged();
            }}
          />
        </OutputCard>
      </div>

      <div className="cr-reel__settings">
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {locked && (
          <p className="muted small">
            Publié : ses réglages sont figés (décoche « Publié » pour les changer).
          </p>
        )}

        <section>
          <h3>Effet</h3>
          <div className="cr-effects" role="radiogroup" aria-label="Effet">
            {props.effects.map((effect) => (
              <button
                key={effect.id}
                type="button"
                role="radio"
                aria-checked={reel.effect === effect.id}
                disabled={locked}
                className={`cr-effect${reel.effect === effect.id ? ' cr-effect--active' : ''}`}
                onClick={() => void patch({ effect: effect.id })}
              >
                <strong>{effect.label}</strong>
                <span className="small muted">{effect.description}</span>
              </button>
            ))}
          </div>
          <div className="inline-form cr-preview-row">
            <Button
              variant="secondary"
              small
              disabled={previewing}
              onClick={() => void makePreview()}
            >
              {previewing ? 'Aperçu en cours…' : 'Aperçu (4 s)'}
            </Button>
            <span className="muted small">Basse résolution, pour juger l’effet et le cadrage.</span>
          </div>
          {preview?.key === settingsKey && (
            <video className="cr-preview" src={preview.url} controls autoPlay playsInline />
          )}
        </section>

        <section>
          <h3>Cadrage 9:16</h3>
          <div className="cr-framing">
            <label>
              <input
                type="radio"
                name={`framing-${reel.id}`}
                checked={reel.framing === 'fit'}
                disabled={locked}
                onChange={() => void patch({ framing: 'fit' })}
              />
              Vidéo entière, fond flou fait avec la vidéo (rien n’est coupé)
            </label>
            <label>
              <input
                type="radio"
                name={`framing-${reel.id}`}
                checked={reel.framing === 'fill'}
                disabled={locked}
                onChange={() => void patch({ framing: 'fill' })}
              />
              Remplir l’écran : recadrer autour d’un point choisi
            </label>
          </div>
          {reel.framing === 'fill' && reel.segments[0] && (
            <FocusPicker
              sourceId={reel.segments[0].sourceId}
              focus={reel.focus}
              onChange={(focus) => void patch({ focusX: focus.x, focusY: focus.y })}
            />
          )}
        </section>

        <section>
          <h3>Vidéo</h3>
          <p className="muted small">
            Un passage, ou plusieurs enchaînés en coupe franche. Le son des vidéos n’est jamais
            utilisé : seul l’extrait du morceau.
          </p>
          {reel.segments.map((segment, index) => (
            <SegmentEditor
              key={`${index}-${segment.sourceId}`}
              segment={segment}
              index={index}
              sources={props.sources}
              onChange={(next) =>
                void setSegments(reel.segments.map((s, i) => (i === index ? next : s)))
              }
              onRemove={
                reel.segments.length > 1
                  ? () => void setSegments(reel.segments.filter((_, i) => i !== index))
                  : undefined
              }
            />
          ))}
          <div className="inline-form">
            <Button
              variant="secondary"
              small
              disabled={locked || reel.segments.length >= 12 || props.sources.length === 0}
              onClick={() => {
                const last = reel.segments[reel.segments.length - 1];
                const source =
                  props.sources.find((s) => s.id === last?.sourceId) ?? props.sources[0]!;
                const start = last && last.end + 1 < source.durationSec ? last.end : 0;
                void setSegments([
                  ...reel.segments,
                  { sourceId: source.id, start, end: Math.min(source.durationSec, start + 5) },
                ]);
              }}
            >
              Ajouter un passage
            </Button>
            <span className={`small ${reel.loops ? 'cr-warning' : 'muted'}`}>
              Vidéo : {reel.videoSeconds.toFixed(1)} s pour un extrait de {reel.durationSec} s
              {reel.loops && ' — plus courte que le son : elle sera bouclée (relancée au début).'}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
