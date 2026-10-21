import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  confirmDelete,
  CopyButton,
  EmptyState,
  ErrorMessage,
  errorMessage,
  FileActions,
  formatDuration,
  MediaThumb,
  OutputCard,
  outputs,
  Page,
  ProgressBar,
  SelectionBar,
  StateBadge,
  useApi,
  useJobs,
  useModule,
  useSelection,
} from '@hub/sdk/frontend';

interface TrackSummary {
  id: number;
  title: string;
  artist: string;
  durationSec: number | null;
  coverUrl: string | null;
}

interface VideoItem {
  id: number;
  outputId: number;
  fileName: string;
  createdAt: string;
  exists: boolean;
  url: string | null;
  youtubeUrl: string | null;
}

interface TrackDetail extends TrackSummary {
  videoTitle: string;
  description: string;
  videos: VideoItem[];
}

function CopyField(props: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="yv-copy">
      <div className="yv-copy__header">
        <strong>{props.label}</strong>
        <CopyButton text={props.value} />
      </div>
      {props.multiline ? (
        <textarea className="input" readOnly rows={8} value={props.value} />
      ) : (
        <input className="input" readOnly value={props.value} />
      )}
    </div>
  );
}

function TrackPanel(props: { trackId: number }) {
  const module = useModule();
  const detail = useApi<TrackDetail>(module.url(`/tracks/${props.trackId}`));
  const { jobs, cancel } = useJobs(module.id);
  const [preview, setPreview] = useState<{
    loading: boolean;
    url: string | null;
    error: string | null;
  }>({
    loading: false,
    url: null,
    error: null,
  });
  const [error, setError] = useState<string | null>(null);
  const finishedJobs = useRef(new Set<string>());
  const selection = useSelection<number>();

  const title = detail.data ? `Vidéo YouTube — ${detail.data.title}` : null;
  const trackJobs = jobs.filter((job) => job.title === title);
  const active = trackJobs.find((job) => job.status === 'queued' || job.status === 'running');
  const lastFailed = trackJobs.find((job) => job.status === 'failed');

  // Refresh the list of videos when a render of this track finishes.
  const { reload } = detail;
  useEffect(() => {
    for (const job of trackJobs) {
      if (job.status === 'succeeded' && !finishedJobs.current.has(job.id)) {
        finishedJobs.current.add(job.id);
        reload();
      }
    }
  }, [trackJobs, reload]);

  if (detail.error) return <ErrorMessage>{detail.error}</ErrorMessage>;
  if (!detail.data) return null;
  const track = detail.data;

  const makePreview = async () => {
    setPreview({ loading: true, url: null, error: null });
    try {
      const { url } = await module.api.post<{ url: string }>(`/tracks/${track.id}/preview`);
      setPreview({ loading: false, url, error: null });
    } catch (err) {
      setPreview({ loading: false, url: null, error: errorMessage(err) });
    }
  };

  const render = async () => {
    setError(null);
    try {
      await module.api.post(`/tracks/${track.id}/render`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const videoAction = async (video: VideoItem, action: 'open' | 'reveal') => {
    try {
      await module.api.post(`/videos/${video.id}/${action}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  /** Deletion (Recycle Bin) and « Retirer de la liste » go through the core (ctx.outputs). */
  const changeOutputs = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
    selection.clear();
    reload();
  };
  const deleteVideos = (list: VideoItem[], what: string) => {
    if (confirmDelete(what)) void changeOutputs(() => outputs.delete(list.map((v) => v.outputId)));
  };
  const missing = track.videos.filter((video) => !video.exists);

  return (
    <>
      <Card>
        <div className="yv-track">
          {track.coverUrl ? (
            <img className="yv-track__cover" src={track.coverUrl} alt="" />
          ) : (
            <div className="yv-track__cover yv-track__cover--empty">♪</div>
          )}
          <div className="yv-track__body">
            <h2>{track.title}</h2>
            <p className="muted">
              {track.artist || 'Artiste non renseigné'} · {formatDuration(track.durationSec)} ·
              vidéo 1920×1080
            </p>
            {!track.coverUrl && (
              <p className="error">
                Ce morceau n’a pas de cover : ajoute-la dans la Bibliothèque pour créer la vidéo.
              </p>
            )}
            <div className="inline-form">
              <Button
                variant="secondary"
                disabled={!track.coverUrl || preview.loading}
                onClick={() => void makePreview()}
              >
                {preview.loading ? 'Aperçu en cours…' : 'Aperçu (6 s)'}
              </Button>
              <Button disabled={!track.coverUrl || Boolean(active)} onClick={() => void render()}>
                Générer la vidéo
              </Button>
              <Button
                variant="secondary"
                onClick={() => void module.api.post('/open-output-folder')}
              >
                Ouvrir le dossier des vidéos
              </Button>
            </div>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            {preview.error && <ErrorMessage>{preview.error}</ErrorMessage>}
          </div>
        </div>

        {active && (
          <div className="yv-progress">
            <div className="job-row__meta">
              <span>
                {active.message ?? (active.status === 'queued' ? 'En attente…' : 'Rendu en cours…')}
              </span>
              <Button variant="secondary" small onClick={() => void cancel(active.id)}>
                Annuler
              </Button>
            </div>
            <ProgressBar value={active.status === 'running' ? active.progress : null} />
          </div>
        )}
        {!active && lastFailed && trackJobs[0]?.id === lastFailed.id && (
          <ErrorMessage>Le dernier rendu a échoué : {lastFailed.error}</ErrorMessage>
        )}

        {preview.url && (
          <video className="yv-preview" src={preview.url} controls autoPlay>
            <track kind="captions" />
          </video>
        )}
      </Card>

      <Card title="Vidéos générées">
        {track.videos.length === 0 ? (
          <p className="muted">
            Aucune vidéo pour ce morceau. Le rendu prend à peu près la durée du morceau.
          </p>
        ) : (
          <>
            <SelectionBar
              total={track.videos.length}
              count={selection.selected.size}
              onSelectAll={() => selection.setAll(track.videos.map((v) => v.id))}
              onClear={selection.clear}
              onDelete={() =>
                deleteVideos(
                  track.videos.filter((v) => selection.has(v.id)),
                  `les ${selection.selected.size} vidéos sélectionnées`,
                )
              }
            >
              {missing.length > 0 && (
                <Button
                  variant="secondary"
                  small
                  onClick={() =>
                    void changeOutputs(() => outputs.forget(missing.map((v) => v.outputId)))
                  }
                >
                  Nettoyer les éléments introuvables ({missing.length})
                </Button>
              )}
            </SelectionBar>
            <div className="ui-cards ui-cards--wide">
              {track.videos.map((video) => (
                <OutputCard
                  key={video.id}
                  title={video.fileName}
                  badge={
                    video.youtubeUrl ? (
                      <StateBadge tone="success">Sur YouTube</StateBadge>
                    ) : video.exists ? (
                      <StateBadge tone="success">Générée</StateBadge>
                    ) : (
                      <StateBadge tone="warning">Introuvable</StateBadge>
                    )
                  }
                  selected={selection.has(video.id)}
                  thumb={
                    <MediaThumb
                      src={track.coverUrl}
                      dragUrl={video.exists ? video.url : null}
                      placeholder="Vidéo 16:9"
                      selected={selection.has(video.id)}
                      onSelect={() => selection.toggle(video.id)}
                      selectLabel={`Sélectionner ${video.fileName}`}
                    />
                  }
                  meta={new Date(video.createdAt).toLocaleString('fr-FR')}
                  missing={
                    video.exists
                      ? null
                      : {
                          onForget: () =>
                            void changeOutputs(() => outputs.forget([video.outputId])),
                          onRegenerate: () =>
                            void changeOutputs(async () => {
                              await outputs.forget([video.outputId]);
                              await module.api.post(`/tracks/${track.id}/render`);
                            }),
                        }
                  }
                  actions={
                    video.exists && (
                      <FileActions
                        onOpen={() => void videoAction(video, 'open')}
                        onReveal={() => void videoAction(video, 'reveal')}
                        onDelete={() => deleteVideos([video], `la vidéo « ${video.fileName} »`)}
                      >
                        {video.youtubeUrl && (
                          <a
                            className="button button--secondary button--small"
                            href={video.youtubeUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Envoyée par le Planning de sortie"
                          >
                            Sur YouTube ↗
                          </a>
                        )}
                      </FileActions>
                    )
                  }
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <Card title="Texte pour YouTube">
        <p className="muted small">
          Liens et hashtags par défaut : Réglages › Vidéo YouTube. Les tags du morceau deviennent
          des hashtags.
        </p>
        <CopyField label="Titre" value={track.videoTitle} />
        <CopyField label="Description" value={track.description} multiline />
      </Card>
    </>
  );
}

export function YouTubePage() {
  const module = useModule();
  const tracks = useApi<TrackSummary[]>(module.url('/tracks'));
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const selected = Number(params.get('track')) || tracks.data?.[0]?.id || null;
  const visible = (tracks.data ?? []).filter((t) =>
    `${t.title} ${t.artist}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Page
      title="Vidéo YouTube"
      subtitle="Choisis un morceau : ToolBox crée une vidéo 16:9 du morceau entier."
    >
      {tracks.error && <ErrorMessage>{tracks.error}</ErrorMessage>}
      {tracks.data?.length === 0 && (
        <EmptyState title="Aucun morceau dans la Bibliothèque.">
          Ajoute d’abord un son et sa cover dans la Bibliothèque.
        </EmptyState>
      )}
      {tracks.data && tracks.data.length > 0 && (
        <div className="yv-layout">
          <aside className="yv-tracks">
            <input
              className="input"
              placeholder="Rechercher…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul>
              {visible.map((track) => (
                <li key={track.id}>
                  <button
                    type="button"
                    className={`yv-tracks__item${track.id === selected ? ' yv-tracks__item--active' : ''}`}
                    onClick={() => setParams({ track: String(track.id) })}
                  >
                    {track.coverUrl ? (
                      <img src={track.coverUrl} alt="" />
                    ) : (
                      <span className="yv-tracks__placeholder">♪</span>
                    )}
                    <span>
                      <strong>{track.title}</strong>
                      <span className="muted small">{formatDuration(track.durationSec)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="yv-main">
            {selected && <TrackPanel key={selected} trackId={selected} />}
          </div>
        </div>
      )}
    </Page>
  );
}
