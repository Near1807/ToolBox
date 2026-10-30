import { useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  Button,
  EmptyState,
  ErrorMessage,
  errorMessage,
  formatDuration,
  getFilePath,
  Page,
  pickFiles,
  useApi,
  useModule,
  Icon,
} from '@hub/sdk/frontend';
import type { TrackDto } from '../contract';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, pairDroppedFiles, type TrackImport } from './pairing';
import { CoverImage } from './CoverImage';
import { Orphans } from './Orphans';

interface Notice {
  ok: boolean;
  text: string;
}

function matches(track: TrackDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [track.title, track.artist, ...track.tags].some((value) =>
    value.toLowerCase().includes(q),
  );
}

export function LibraryPage() {
  const module = useModule();
  const navigate = useNavigate();
  const tracks = useApi<TrackDto[]>(module.url('/tracks'));
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<TrackDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dragging, setDragging] = useState(false);

  const importTracks = async (imports: TrackImport[], ignored: string[] = []) => {
    const results: Notice[] = ignored.map((file) => ({
      ok: false,
      text: `Ignoré (format non pris en charge) : ${file.split(/[\\/]/).pop()}`,
    }));
    for (const [index, item] of imports.entries()) {
      setBusy(`Ajout du morceau ${index + 1} sur ${imports.length}…`);
      try {
        const track = await module.api.post<TrackDto>('/tracks', item);
        results.push({ ok: true, text: `Ajouté : ${track.title}` });
      } catch (error) {
        results.push({ ok: false, text: errorMessage(error) });
      }
    }
    setBusy(null);
    setNotices(results);
    tracks.reload();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    const paths = files.map(getFilePath).filter((p): p is string => p !== null);
    if (files.length > 0 && paths.length === 0) {
      setNotices([
        {
          ok: false,
          text: 'Le glisser-déposer fonctionne dans l’application. Ici, utilise « Ajouter un morceau ».',
        },
      ]);
      return;
    }
    const { imports, ignored } = pairDroppedFiles(paths);
    if (imports.length === 0) {
      setNotices([{ ok: false, text: 'Aucun son reconnu : dépose un fichier WAV, MP3 ou FLAC.' }]);
      return;
    }
    void importTracks(imports, ignored);
  };

  const addWithPicker = async () => {
    const [audioPath] = await pickFiles({
      title: 'Choisis le son du morceau',
      filters: [{ name: 'Audio (WAV, MP3, FLAC)', extensions: AUDIO_EXTENSIONS }],
    });
    if (!audioPath) return;
    const [coverPath] = await pickFiles({
      title: 'Choisis la cover (facultatif : Annuler pour l’ajouter plus tard)',
      filters: [{ name: 'Image (JPG, PNG)', extensions: IMAGE_EXTENSIONS }],
    });
    await importTracks([{ audioPath, coverPath: coverPath ?? null }]);
  };

  const visible = (tracks.data ?? []).filter((track) => matches(track, query));

  return (
    <div
      className={`ml-dropzone${dragging ? ' ml-dropzone--active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Page
        title="Bibliothèque"
        subtitle="Glisse un son et sa cover n’importe où sur cette page pour ajouter un morceau."
        actions={
          <Button onClick={() => void addWithPicker()} disabled={busy !== null}>
            Ajouter un morceau
          </Button>
        }
      >
        {busy && <p className="muted">{busy}</p>}
        {notices.length > 0 && (
          <ul className="ml-notices">
            {notices.map((notice, index) => (
              <li key={index} className={notice.ok ? 'success' : 'error'}>
                {notice.text}
              </li>
            ))}
          </ul>
        )}
        {tracks.error && <ErrorMessage>{tracks.error}</ErrorMessage>}

        {tracks.data && tracks.data.length > 0 && (
          <div className="toolbar">
            <input
              className="input ml-search"
              placeholder="Rechercher (titre, artiste, tag)…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="muted">
              {visible.length} morceau{visible.length > 1 ? 'x' : ''}
            </span>
          </div>
        )}

        {tracks.data?.length === 0 && (
          <EmptyState title="Ta bibliothèque est vide.">
            Glisse ici un fichier audio (WAV, MP3, FLAC) et sa cover (JPG, PNG), ou clique sur «
            Ajouter un morceau ».
          </EmptyState>
        )}

        <div className="ml-grid">
          {visible.map((track) => (
            <article
              key={track.id}
              className={`ml-card${playing?.id === track.id ? ' ml-card--playing' : ''}`}
              onClick={() => navigate(module.path(`tracks/${track.id}`))}
            >
              <div className="ml-card__cover">
                <CoverImage url={track.coverUrl} title={track.title} />
                <button
                  type="button"
                  className="ml-card__play"
                  aria-label={playing?.id === track.id ? 'Arrêter' : `Écouter ${track.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPlaying(playing?.id === track.id ? null : track);
                  }}
                >
                  <Icon name={playing?.id === track.id ? 'stop' : 'play'} />
                </button>
              </div>
              <div className="ml-card__title" title={track.title}>
                {track.title}
              </div>
              <div className="muted ml-card__meta">
                {track.artist || 'Artiste non renseigné'} · {formatDuration(track.durationSec)}
              </div>
            </article>
          ))}
        </div>

        {tracks.data && <Orphans tracks={tracks.data} />}
      </Page>

      {playing && (
        <div className="ml-player">
          <CoverImage url={playing.coverUrl} title={playing.title} small />
          <div className="ml-player__info">
            <strong>{playing.title}</strong>
            <span className="muted">{playing.artist}</span>
          </div>
          <audio
            key={playing.id}
            src={playing.audioUrl}
            controls
            autoPlay
            className="ml-player__audio"
          />
          <Button variant="secondary" small onClick={() => setPlaying(null)}>
            Fermer
          </Button>
        </div>
      )}

      {dragging && <div className="ml-drop-hint">Dépose ton son (et sa cover) pour l’ajouter</div>}
    </div>
  );
}
