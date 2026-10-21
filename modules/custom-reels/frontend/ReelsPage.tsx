import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  errorMessage,
  ExcerptChip,
  ExcerptWaveform,
  formatDuration,
  getFilePath,
  Page,
  pickFiles,
  useApi,
  useJobs,
  useModule,
} from '@hub/sdk/frontend';
import { ReelEditor } from './ReelEditor';
import type { EffectInfo, TrackDetail, TrackSummary } from './types';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
const CLIPS = [15, 20, 25, 28, 30, 35, 40, 45, 50, 55, 60];

/** Videos of a track: drop them here or pick them; they are copied into ToolBox. */
function Sources(props: { track: TrackDetail; onChanged: () => void }) {
  const module = useModule();
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [over, setOver] = useState(false);

  const add = async (paths: string[]) => {
    if (paths.length === 0) return;
    setBusy(true);
    setMessages([]);
    try {
      const result = await module.api.post<{ added: number[]; errors: string[] }>(
        `/tracks/${props.track.id}/sources`,
        { paths },
      );
      setMessages(result.errors);
      props.onChanged();
    } catch (err) {
      setMessages([errorMessage(err)]);
    } finally {
      setBusy(false);
    }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const paths = [...event.dataTransfer.files]
      .map((file) => getFilePath(file))
      .filter((p): p is string => p !== null);
    void add(paths);
  };
  const remove = async (id: number) => {
    try {
      await module.api.delete(`/sources/${id}`);
      props.onChanged();
    } catch (err) {
      setMessages([errorMessage(err)]);
    }
  };

  return (
    <Card title="Tes vidéos">
      <div
        className={`cr-drop${over ? ' cr-drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <p>
          {busy
            ? 'Import en cours (copie dans ToolBox)…'
            : 'Glisse ici une ou plusieurs vidéos (MP4, MOV…), ou'}
        </p>
        <Button
          variant="secondary"
          small
          disabled={busy}
          onClick={() =>
            void pickFiles({
              title: 'Choisis tes vidéos',
              multiple: true,
              filters: [{ name: 'Vidéo', extensions: VIDEO_EXTENSIONS }],
            }).then(add)
          }
        >
          Ajouter des vidéos
        </Button>
        <p className="faint small">
          Elles sont copiées dans ToolBox : déplacer les originaux ne casse rien. Leur son n’est
          jamais utilisé.
        </p>
      </div>
      {messages.map((message) => (
        <ErrorMessage key={message}>{message}</ErrorMessage>
      ))}
      {props.track.sources.length > 0 && (
        <ul className="list cr-sources">
          {props.track.sources.map((source) => (
            <li key={source.id} className="list__item">
              <span>
                <strong>{source.name}</strong>{' '}
                <span className="muted small num">
                  {formatDuration(source.durationSec)} · {source.width}×{source.height}
                </span>
                {!source.exists && <span className="badge badge--warning">Introuvable</span>}
              </span>
              <Button
                variant="secondary"
                small
                onClick={() => {
                  if (
                    window.confirm(
                      `Retirer « ${source.name} » de ToolBox ? L’original n’est pas touché.`,
                    )
                  ) {
                    void remove(source.id);
                  }
                }}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TrackPanel(props: { trackId: number; effects: EffectInfo[]; onChange: () => void }) {
  const module = useModule();
  const detail = useApi<TrackDetail>(module.url(`/tracks/${props.trackId}`));
  const waveform = useApi<{ durationSec: number; peaks: number[] }>(
    module.url(`/tracks/${props.trackId}/waveform`),
  );
  const { jobs, cancel } = useJobs(module.id);
  const [count, setCount] = useState(1);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [playing, setPlaying] = useState<{ id: number; time: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const { reload } = detail;
  const { onChange } = props;
  const refresh = useCallback(() => {
    reload();
    onChange();
  }, [reload, onChange]);

  // Reload when a render of this track ends.
  const reels = detail.data?.reels ?? [];
  const trackJobs = jobs.filter((job) => reels.some((r) => r.jobId === job.id));
  const finished = trackJobs.filter(
    (job) => job.status !== 'queued' && job.status !== 'running',
  ).length;
  useEffect(() => {
    if (finished > 0) reload();
  }, [finished, reload]);

  if (detail.error) return <ErrorMessage>{detail.error}</ErrorMessage>;
  if (!detail.data) return <p className="muted">Chargement…</p>;
  const track = detail.data;
  const active = reels.find((r) => r.id === activeId) ?? reels[0] ?? null;
  const playingReel = reels.find((r) => r.id === playing?.id);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const patch = (id: number, fields: Record<string, unknown>) =>
    run(() => module.api.patch(`/reels/${id}`, fields));
  const toRender = reels.filter((r) =>
    ['draft', 'outdated', 'failed', 'missing'].includes(r.state),
  );

  const listen = (id: number) => {
    const reel = reels.find((r) => r.id === id);
    if (!reel || !audio.current) return;
    if (playing?.id === id) {
      audio.current.pause();
      return;
    }
    audio.current.currentTime = reel.startSec;
    setPlaying({ id, time: reel.startSec });
    void audio.current.play();
  };

  return (
    <>
      <Card>
        <div className="cr-track">
          {track.coverUrl ? (
            <img className="cr-track__cover" src={track.coverUrl} alt="" />
          ) : (
            <div className="cr-track__cover" />
          )}
          <div>
            <h2>{track.title}</h2>
            <p className="muted">
              {track.artist} · {formatDuration(track.durationSec)}
            </p>
          </div>
        </div>
      </Card>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      <Sources track={track} onChanged={refresh} />

      {track.sources.length > 0 && reels.length === 0 && (
        <Card title="Créer les Reels">
          <div className="inline-form">
            <label>
              Nombre de Reels{' '}
              <select
                className="input"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Button
              onClick={() =>
                void run(() => module.api.post(`/tracks/${track.id}/reels`, { count }))
              }
            >
              Créer {count > 1 ? `les ${count} Reels` : 'le Reel'}
            </Button>
          </div>
          <p className="muted small">
            Chaque Reel reçoit un extrait de {track.defaultClip} s sur un passage fort du morceau et
            une de tes vidéos ; tout se règle ensuite.
          </p>
        </Card>
      )}

      {reels.length > 0 && (
        <Card
          title="Extraits du morceau"
          actions={
            <span className="inline-form">
              {reels.length < 4 && (
                <Button
                  variant="secondary"
                  small
                  onClick={() =>
                    void run(() => module.api.post(`/tracks/${track.id}/reels`, { count: 1 }))
                  }
                >
                  Ajouter un Reel
                </Button>
              )}
              <Button
                small
                disabled={toRender.length === 0}
                onClick={() => void run(() => module.api.post(`/tracks/${track.id}/render`))}
              >
                Lancer le rendu ({toRender.length})
              </Button>
            </span>
          }
        >
          {waveform.data && (
            <ExcerptWaveform
              label="Extraits des Reels perso sur la forme d’onde"
              peaks={waveform.data.peaks}
              durationSec={waveform.data.durationSec}
              regions={reels.map((r) => ({
                id: r.id,
                position: r.position,
                start: r.startSec,
                clipSec: r.durationSec,
                locked: Boolean(r.publishedAt),
              }))}
              activeId={active?.id ?? null}
              playheadSec={playing?.time ?? null}
              onActivate={setActiveId}
              onMove={(id, start) => void patch(id, { startSec: start })}
            />
          )}
          {!waveform.data && !waveform.error && <p className="muted">Analyse du son…</p>}
          {waveform.error && <ErrorMessage>{waveform.error}</ErrorMessage>}
          {track.audioUrl && (
            <audio
              ref={audio}
              src={track.audioUrl}
              onTimeUpdate={(e) => {
                const time = e.currentTarget.currentTime;
                if (!playingReel) return;
                if (time >= playingReel.startSec + playingReel.durationSec) e.currentTarget.pause();
                else setPlaying({ id: playingReel.id, time });
              }}
              onPause={() => setPlaying(null)}
            />
          )}
          <ul className="cr-excerpts">
            {reels.map((reel) => (
              <li
                key={reel.id}
                className={reel.id === active?.id ? 'cr-excerpts--active' : undefined}
              >
                <ExcerptChip
                  position={reel.position}
                  active={reel.id === active?.id}
                  onClick={() => setActiveId(reel.id)}
                  title="Choisir cet extrait sur la forme d’onde"
                />
                <span className="num">
                  {formatDuration(reel.startSec)} →{' '}
                  {formatDuration(reel.startSec + reel.durationSec)}
                </span>
                <select
                  className="input"
                  aria-label={`Durée du ${reel.label}`}
                  value={reel.durationSec}
                  disabled={Boolean(reel.publishedAt)}
                  onChange={(e) => void patch(reel.id, { durationSec: Number(e.target.value) })}
                >
                  {[...new Set([...CLIPS, reel.durationSec])]
                    .sort((a, b) => a - b)
                    .map((s) => (
                      <option key={s} value={s}>
                        {s} s
                      </option>
                    ))}
                </select>
                <Button variant="secondary" small onClick={() => listen(reel.id)}>
                  {playing?.id === reel.id ? 'Arrêter' : 'Écouter'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {reels.map((reel) => (
        <Card key={reel.id} title={reel.label}>
          <ReelEditor
            reel={reel}
            sources={track.sources}
            effects={props.effects}
            job={jobs.find((job) => job.id === reel.jobId) ?? null}
            onChanged={refresh}
            onCancel={(id) => void cancel(id)}
          />
        </Card>
      ))}
    </>
  );
}

export function ReelsPage() {
  const module = useModule();
  const tracks = useApi<TrackSummary[]>(module.url('/tracks'));
  const effects = useApi<EffectInfo[]>(module.url('/effects'));
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const selected = Number(params.get('track')) || tracks.data?.[0]?.id || null;
  const visible = (tracks.data ?? []).filter((t) =>
    `${t.title} ${t.artist}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Page
      title="Reels depuis mes vidéos"
      subtitle="Tes vidéos, sur un extrait du morceau, en 9:16 avec un effet au choix. Seul le son du morceau est gardé."
    >
      {tracks.error && <ErrorMessage>{tracks.error}</ErrorMessage>}
      {tracks.data?.length === 0 && (
        <EmptyState title="Aucun morceau dans la Bibliothèque.">
          Ajoute d’abord un son et sa cover dans la Bibliothèque.
        </EmptyState>
      )}
      {tracks.data && tracks.data.length > 0 && (
        <div className="cr-layout">
          <aside className="cr-tracks">
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
                    className={`cr-tracks__item${track.id === selected ? ' cr-tracks__item--active' : ''}`}
                    onClick={() => setParams({ track: String(track.id) })}
                  >
                    {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <span />}
                    <span>
                      <strong>{track.title}</strong>
                      <span className="muted small">
                        {track.reels
                          ? `Reels : ${track.reels.published}/${track.reels.total} publiés`
                          : formatDuration(track.durationSec)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="cr-panel">
            {selected && (
              <TrackPanel
                key={selected}
                trackId={selected}
                effects={effects.data ?? []}
                onChange={tracks.reload}
              />
            )}
          </div>
        </div>
      )}
    </Page>
  );
}
