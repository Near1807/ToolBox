import { useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  formatDuration,
  getFilePath,
  Page,
  pickFiles,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import type { TrackDto, TrackOutputDto } from '../contract';
import { CoverImage } from './CoverImage';
import { IMAGE_EXTENSIONS } from './pairing';

type TrackDetail = TrackDto & { outputs: TrackOutputDto[] };

interface FormState {
  title: string;
  artist: string;
  releaseDate: string;
  tags: string;
  notes: string;
}

function toForm(track: TrackDto): FormState {
  return {
    title: track.title,
    artist: track.artistOverride ?? '',
    releaseDate: track.releaseDate ?? '',
    tags: track.tags.join(', '),
    notes: track.notes,
  };
}

function codecLabel(codec: string | null): string | null {
  if (!codec) return null;
  if (codec.startsWith('pcm_')) return 'WAV';
  if (codec === 'mp3') return 'MP3';
  if (codec === 'flac') return 'FLAC';
  return codec.toUpperCase();
}

function formatAudio(track: TrackDto): string {
  const parts = [codecLabel(track.audioFormat)];
  if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toLocaleString('fr-FR')} kHz`);
  if (track.channels) parts.push(track.channels === 1 ? 'mono' : 'stéréo');
  if (track.bitRate) parts.push(`${Math.round(track.bitRate / 1000)} kb/s`);
  return parts.filter(Boolean).join(' · ');
}

export function TrackPage() {
  const module = useModule();
  const navigate = useNavigate();
  const { trackId } = useParams();
  const track = useApi<TrackDetail>(module.url(`/tracks/${trackId}`));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  if (track.error) {
    return (
      <Page title="Morceau">
        <ErrorMessage>{track.error}</ErrorMessage>
        <Link to={module.path()}>Retour à la bibliothèque</Link>
      </Page>
    );
  }
  if (!track.data) return null;
  const data = track.data;

  const setCover = async (path: string) => {
    try {
      await module.api.put(`/tracks/${data.id}/cover`, { path });
      track.reload();
    } catch (error) {
      setStatus({ ok: false, text: errorMessage(error) });
    }
  };

  const chooseCover = async () => {
    const [path] = await pickFiles({
      title: 'Choisis la cover',
      filters: [{ name: 'Image (JPG, PNG)', extensions: IMAGE_EXTENSIONS }],
    });
    if (path) await setCover(path);
  };

  const dropCover = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files[0];
    const path = file ? getFilePath(file) : null;
    if (path) void setCover(path);
  };

  const remove = async () => {
    const confirmed = window.confirm(
      `Supprimer « ${data.title} » de la bibliothèque ?\n\nLe son et la cover copiés dans ToolBox seront effacés. ` +
        'Tes fichiers d’origine et les vidéos déjà générées ne sont pas touchés.',
    );
    if (!confirmed) return;
    await module.api.delete(`/tracks/${data.id}`);
    navigate(module.path());
  };

  const outputAction = async (output: TrackOutputDto, action: 'open' | 'reveal') => {
    try {
      await module.api.post(`/outputs/${output.id}/${action}`);
    } catch (error) {
      setStatus({ ok: false, text: errorMessage(error) });
    }
  };

  return (
    <Page
      title={data.title}
      subtitle={<Link to={module.path()}>← Bibliothèque</Link>}
      actions={
        <Button variant="danger" onClick={() => void remove()}>
          Supprimer
        </Button>
      }
    >
      {status && <p className={status.ok ? 'success' : 'error'}>{status.text}</p>}
      <div className="ml-detail">
        <div className="ml-detail__side">
          <div
            className="ml-detail__cover"
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropCover}
            title="Glisse une image ici pour changer la cover"
          >
            <CoverImage url={data.coverUrl} title={data.title} />
          </div>
          <Button variant="secondary" small onClick={() => void chooseCover()}>
            {data.coverUrl ? 'Changer la cover' : 'Ajouter une cover'}
          </Button>
          <audio src={data.audioUrl} controls className="ml-detail__audio" />
          <dl className="info-list ml-detail__info">
            <dt>Durée</dt>
            <dd>{formatDuration(data.durationSec)}</dd>
            <dt>Audio</dt>
            <dd>{formatAudio(data)}</dd>
            {data.coverWidth && (
              <>
                <dt>Cover</dt>
                <dd>
                  {data.coverWidth} × {data.coverHeight} px
                </dd>
              </>
            )}
            <dt>Fichier</dt>
            <dd className="ml-break">{data.originalAudioName}</dd>
          </dl>
        </div>

        <div className="ml-detail__main">
          {/* Keyed by updatedAt: the form restarts from saved values after each save. */}
          <InfoForm key={data.updatedAt} track={data} onSaved={track.reload} />

          <Card title="Vidéos générées">
            {data.outputs.length === 0 ? (
              <p className="muted">
                Aucune pour l’instant. Les vidéos créées avec les outils de la section Musique
                apparaîtront ici.
              </p>
            ) : (
              <ul className="list">
                {data.outputs.map((output) => (
                  <li key={output.id} className="list__item">
                    <div>
                      <strong>{output.label}</strong>{' '}
                      <span className="muted">
                        · {new Date(output.createdAt).toLocaleString('fr-FR')}
                      </span>
                      <div className="muted small ml-break">
                        {output.exists
                          ? output.fileName
                          : `${output.fileName} (fichier déplacé ou supprimé)`}
                      </div>
                    </div>
                    {output.exists && (
                      <span className="inline-form">
                        <Button
                          variant="secondary"
                          small
                          onClick={() => void outputAction(output, 'open')}
                        >
                          Lire
                        </Button>
                        <Button
                          variant="secondary"
                          small
                          onClick={() => void outputAction(output, 'reveal')}
                        >
                          Afficher dans le dossier
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Statistiques">
            <p className="muted">
              Les statistiques liées à ce morceau arriveront avec l’outil Statistiques YouTube.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function InfoForm(props: { track: TrackDto; onSaved: () => void }) {
  const module = useModule();
  const summary = useApi<{ defaultArtist: string }>(module.url('/summary'));
  const [form, setForm] = useState<FormState>(() => toForm(props.track));
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof FormState, value: string) => {
    setForm({ ...form, [field]: value });
    setError(null);
  };

  const save = async () => {
    try {
      await module.api.patch(`/tracks/${props.track.id}`, {
        title: form.title,
        artist: form.artist,
        releaseDate: form.releaseDate || null,
        notes: form.notes,
        tags: form.tags.split(',').map((tag) => tag.trim()),
      });
      props.onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card title="Infos">
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="settings-form__field">
          <label htmlFor="ml-title">Titre</label>
          <input
            id="ml-title"
            className="input"
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
          />
        </div>
        <div className="settings-form__field">
          <label htmlFor="ml-artist">Artiste</label>
          <input
            id="ml-artist"
            className="input"
            value={form.artist}
            placeholder={summary.data?.defaultArtist || 'Artiste par défaut (Réglages)'}
            onChange={(e) => update('artist', e.target.value)}
          />
        </div>
        <div className="settings-form__field">
          <label htmlFor="ml-date">Date de sortie</label>
          <input
            id="ml-date"
            className="input input--short"
            type="date"
            value={form.releaseDate}
            onChange={(e) => update('releaseDate', e.target.value)}
          />
        </div>
        <div className="settings-form__field">
          <label htmlFor="ml-tags">Tags</label>
          <input
            id="ml-tags"
            className="input"
            value={form.tags}
            placeholder="lofi, chill, piano"
            onChange={(e) => update('tags', e.target.value)}
          />
          <p className="muted settings-form__help">Séparés par des virgules.</p>
        </div>
        <div className="settings-form__field">
          <label htmlFor="ml-notes">Notes</label>
          <textarea
            id="ml-notes"
            className="input"
            rows={4}
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
          />
        </div>
        <div className="settings-form__actions">
          <Button type="submit">Enregistrer</Button>
          {error && <span className="error">{error}</span>}
        </div>
      </form>
    </Card>
  );
}
