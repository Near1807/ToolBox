import { useState, type MouseEvent } from 'react';
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
  useModule,
  type JobInfo,
  type StateTone,
} from '@hub/sdk/frontend';
import { PassageEditor, useFilmstrip } from './PassageEditor';
import { STATE_LABELS, type EffectInfo, type Reel, type Source } from './types';

const STATE_TONES: Record<Reel['state'], StateTone> = {
  draft: 'neutral',
  rendering: 'running',
  ready: 'success',
  outdated: 'warning',
  failed: 'danger',
  missing: 'warning',
};

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
  /** The track's audio, for « Lire le passage ». */
  audioUrl: string | null;
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
    reel.audioMode,
    reel.intensity,
    reel.overlayText,
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
  const [text, setText] = useState(reel.overlayText);
  const [syncing, setSyncing] = useState(false);
  const used = [...new Set(reel.segments.map((s) => s.sourceId))]
    .map((id) => props.sources.find((s) => s.id === id))
    .filter((s): s is Source => Boolean(s));
  const findTrack = async () => {
    setSyncing(true);
    await run(async () => {
      for (const source of used) await module.api.post(`/sources/${source.id}/sync`);
    });
    setSyncing(false);
  };
  const unreliable = used.filter((s) => s.sync && !s.sync.reliable);
  const notSearched = used.filter((s) => !s.sync);

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
          <h3>
            Son <span className="badge">Expérimental</span>
          </h3>
          <div className="cr-framing">
            {(
              [
                ['track', 'Son du morceau', 'L’extrait choisi sur la forme d’onde.'],
                [
                  'video',
                  'Son de la vidéo',
                  'Le son d’origine des passages choisis (volume normalisé, limité).',
                ],
                [
                  'synced',
                  'Morceau synchronisé',
                  'Le morceau retrouvé dans le son de la vidéo, remplacé par le master calé dessus.',
                ],
              ] as const
            ).map(([mode, label, hint]) => (
              <label key={mode}>
                <input
                  type="radio"
                  name={`audio-${reel.id}`}
                  checked={reel.audioMode === mode}
                  disabled={locked}
                  onChange={() => void patch({ audioMode: mode })}
                />
                {label} <span className="muted small">— {hint}</span>
              </label>
            ))}
          </div>
          {reel.audioMode !== 'track' && (
            <p className="muted small">
              Le Reel dure le temps des passages choisis ci-dessous (60 s au plus) ; l’extrait du
              morceau n’est pas utilisé.
            </p>
          )}
          {reel.audioMode === 'synced' && (
            <div className="cr-sync">
              {used.map((source) => (
                <p key={source.id} className="small">
                  <strong>{source.name}</strong> :{' '}
                  {!source.sync
                    ? 'pas encore cherché'
                    : source.sync.reliable
                      ? `morceau retrouvé (décalage ${source.sync.offset.toFixed(3)} s, confiance ${source.sync.score?.toFixed(2)})`
                      : `pas retrouvé de façon fiable (confiance ${source.sync.score?.toFixed(2)})`}
                </p>
              ))}
              <div className="inline-form">
                <Button
                  small
                  variant="secondary"
                  disabled={syncing || locked}
                  onClick={() => void findTrack()}
                >
                  {syncing
                    ? 'Recherche…'
                    : notSearched.length > 0
                      ? 'Retrouver le morceau dans la vidéo'
                      : 'Chercher à nouveau'}
                </Button>
                {unreliable.length > 0 && (
                  <Button small onClick={() => void patch({ audioMode: 'video' })}>
                    Utiliser « Son de la vidéo »
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>

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
          {(reel.effect === 'rhythm' || reel.effect === 'camera') && (
            <label className="cr-inline-field small">
              Intensité <span className="badge">Expérimental</span>
              <select
                className="input input--short"
                value={reel.intensity}
                disabled={locked}
                onChange={(e) => void patch({ intensity: e.target.value })}
              >
                <option value="light">Léger</option>
                <option value="medium">Moyen</option>
                <option value="max">À fond</option>
              </select>
            </label>
          )}
          <label className="cr-inline-field small">
            Texte à l’écran <span className="badge">Expérimental</span>
            <input
              className="input"
              value={text}
              maxLength={60}
              disabled={locked}
              placeholder="ex. en cours de création…"
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text !== reel.overlayText && void patch({ overlayText: text })}
            />
          </label>
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
          <PassageEditor
            reel={reel}
            sources={props.sources}
            audioUrl={props.audioUrl}
            locked={locked}
            onPatch={(fields) => void patch(fields)}
          />
        </section>
      </div>
    </div>
  );
}
