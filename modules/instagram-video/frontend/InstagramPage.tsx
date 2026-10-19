import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  copyText,
  EmptyState,
  ErrorMessage,
  errorMessage,
  formatDuration,
  Page,
  ProgressBar,
  useApi,
  useJobs,
  useModule,
} from '@hub/sdk/frontend';
import { Waveform } from './Waveform';

interface TrackSummary {
  id: number;
  title: string;
  artist: string;
  durationSec: number | null;
  coverUrl: string | null;
}

interface ReelItem {
  id: number;
  fileName: string;
  startSec: number;
  durationSec: number;
  createdAt: string;
  exists: boolean;
}

interface TrackDetail extends TrackSummary {
  audioUrl: string;
  defaultDuration: number;
  caption: string;
  reels: ReelItem[];
}

interface WaveformData {
  durationSec: number;
  peaks: number[];
  suggestedStart: number;
}

function TrackPanel(props: { trackId: number }) {
  const module = useModule();
  const detail = useApi<TrackDetail>(module.url(`/tracks/${props.trackId}`));
  const waveform = useApi<WaveformData>(module.url(`/tracks/${props.trackId}/waveform`));
  const { jobs, cancel } = useJobs(module.id);
  const [start, setStart] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ loading: boolean; url: string | null }>({
    loading: false,
    url: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const finishedJobs = useRef(new Set<string>());

  const title = detail.data ? `Reel Instagram — ${detail.data.title}` : null;
  const trackJobs = jobs.filter((job) => job.title === title);
  const active = trackJobs.find((job) => job.status === 'queued' || job.status === 'running');
  const lastFailed = trackJobs[0]?.status === 'failed' ? trackJobs[0] : null;

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
  // Until the user picks something, use the default duration and the suggested passage.
  const clip = duration ?? track.defaultDuration;
  const from = start ?? waveform.data?.suggestedStart ?? 0;
  const trackLength = waveform.data?.durationSec ?? track.durationSec ?? 0;
  const maxDuration = Math.max(15, Math.min(90, Math.floor(trackLength)));

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const suggest = () =>
    run(async () => {
      const result = await module.api.post<{ start: number }>(`/tracks/${track.id}/suggest`, {
        duration: clip,
      });
      setStart(result.start);
    });

  const listen = () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      setPlayhead(null);
      return;
    }
    element.currentTime = from;
    void element.play();
  };

  const makePreview = () =>
    run(async () => {
      setPreview({ loading: true, url: null });
      try {
        const { url } = await module.api.post<{ url: string }>(`/tracks/${track.id}/preview`, {
          start: from,
          duration: clip,
        });
        setPreview({ loading: false, url });
      } catch (err) {
        setPreview({ loading: false, url: null });
        throw err;
      }
    });

  const render = () =>
    run(() => module.api.post(`/tracks/${track.id}/render`, { start: from, duration: clip }));

  const reelAction = (reel: ReelItem, action: 'open' | 'reveal') =>
    run(() => module.api.post(`/reels/${reel.id}/${action}`));

  return (
    <>
      <Card>
        <div className="iv-track">
          {track.coverUrl ? (
            <img className="iv-track__cover" src={track.coverUrl} alt="" />
          ) : (
            <div className="iv-track__cover iv-track__cover--empty">♪</div>
          )}
          <div>
            <h2>{track.title}</h2>
            <p className="muted">
              {track.artist || 'Artiste non renseigné'} · {formatDuration(track.durationSec)} ·
              vidéo verticale 1080×1920
            </p>
            <p className="muted small">
              La même vidéo sert aussi de <strong>YouTube Short</strong>.
            </p>
            {!track.coverUrl && (
              <p className="error">
                Ce morceau n’a pas de cover : ajoute-la dans la Bibliothèque pour créer le Reel.
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card title="Choisir l’extrait">
        <div className="iv-controls">
          <label htmlFor="iv-duration">Durée</label>
          <input
            id="iv-duration"
            type="range"
            min={15}
            max={maxDuration}
            step={1}
            value={Math.min(clip, maxDuration)}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
          <strong>{Math.min(clip, maxDuration)} s</strong>
          <span className="muted">
            · de {formatDuration(from)} à {formatDuration(Math.min(trackLength, from + clip))}
          </span>
        </div>
        {waveform.error && <ErrorMessage>{waveform.error}</ErrorMessage>}
        {!waveform.data && !waveform.error && <p className="muted">Analyse du son…</p>}
        {waveform.data && (
          <Waveform
            peaks={waveform.data.peaks}
            durationSec={waveform.data.durationSec}
            start={from}
            clipSec={clip}
            playheadSec={playhead}
            onSelect={setStart}
          />
        )}
        <p className="muted small">
          Clique sur la forme d’onde pour choisir où commence l’extrait.
        </p>
        <audio
          ref={audio}
          src={track.audioUrl}
          onTimeUpdate={(e) => {
            const time = e.currentTarget.currentTime;
            setPlayhead(time);
            if (time >= from + clip) {
              e.currentTarget.pause();
              setPlayhead(null);
            }
          }}
          onPause={() => setPlayhead(null)}
        />
        <div className="inline-form">
          <Button variant="secondary" onClick={() => void suggest()}>
            Suggérer un passage
          </Button>
          <Button variant="secondary" onClick={listen}>
            {playhead !== null ? 'Stop' : 'Écouter l’extrait'}
          </Button>
          <Button
            variant="secondary"
            disabled={!track.coverUrl || preview.loading}
            onClick={() => void makePreview()}
          >
            {preview.loading ? 'Aperçu en cours…' : 'Aperçu (6 s)'}
          </Button>
          <Button disabled={!track.coverUrl || Boolean(active)} onClick={() => void render()}>
            Générer le Reel
          </Button>
          <Button
            variant="secondary"
            onClick={() => void run(() => module.api.post('/open-output-folder'))}
          >
            Ouvrir le dossier
          </Button>
        </div>
        {error && <ErrorMessage>{error}</ErrorMessage>}

        {active && (
          <div className="iv-progress">
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
        {!active && lastFailed && (
          <ErrorMessage>Le dernier rendu a échoué : {lastFailed.error}</ErrorMessage>
        )}

        {preview.url && (
          <video className="iv-preview" src={preview.url} controls autoPlay>
            <track kind="captions" />
          </video>
        )}
      </Card>

      <Card title="Reels générés">
        {track.reels.length === 0 ? (
          <p className="muted">Aucun Reel pour ce morceau.</p>
        ) : (
          <ul className="list">
            {track.reels.map((reel) => (
              <li key={reel.id} className="list__item">
                <div>
                  <strong>{reel.fileName}</strong>
                  <div className="muted small">
                    {new Date(reel.createdAt).toLocaleString('fr-FR')} · extrait de{' '}
                    {formatDuration(reel.startSec)} ({Math.round(reel.durationSec)} s)
                    {!reel.exists && ' · fichier déplacé ou supprimé'}
                  </div>
                </div>
                {reel.exists && (
                  <span className="inline-form">
                    <Button variant="secondary" small onClick={() => void reelAction(reel, 'open')}>
                      Lire
                    </Button>
                    <Button
                      variant="secondary"
                      small
                      onClick={() => void reelAction(reel, 'reveal')}
                    >
                      Ouvrir le dossier
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Légende"
        actions={
          <Button
            variant="secondary"
            small
            onClick={() =>
              void copyText(track.caption).then((ok) => {
                setCopied(ok);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? 'Copié ✓' : 'Copier'}
          </Button>
        }
      >
        <textarea className="input iv-caption" readOnly rows={6} value={track.caption} />
        <p className="muted small">Phrase et hashtags par défaut : Réglages › Reel Instagram.</p>
      </Card>
    </>
  );
}

export function InstagramPage() {
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
      title="Reel Instagram"
      subtitle="Un extrait vertical de ton morceau, pour Instagram et les YouTube Shorts."
    >
      {tracks.error && <ErrorMessage>{tracks.error}</ErrorMessage>}
      {tracks.data?.length === 0 && (
        <EmptyState title="Aucun morceau dans la Bibliothèque.">
          Ajoute d’abord un son et sa cover dans la Bibliothèque.
        </EmptyState>
      )}
      {tracks.data && tracks.data.length > 0 && (
        <div className="iv-layout">
          <aside className="iv-tracks">
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
                    className={`iv-tracks__item${track.id === selected ? ' iv-tracks__item--active' : ''}`}
                    onClick={() => setParams({ track: String(track.id) })}
                  >
                    {track.coverUrl ? (
                      <img src={track.coverUrl} alt="" />
                    ) : (
                      <span className="iv-tracks__placeholder">♪</span>
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
          <div>{selected && <TrackPanel key={selected} trackId={selected} />}</div>
        </div>
      )}
    </Page>
  );
}
