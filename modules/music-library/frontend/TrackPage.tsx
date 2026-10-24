import { Fragment, useState, type DragEvent } from 'react';
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
  StateBadge,
  useApi,
  useModule,
  type OutputRecord,
} from '@hub/sdk/frontend';
import type { MasterTrackStatus } from '../../master-analysis/contract';
import type { TrackDto } from '../contract';
import { CoverImage } from './CoverImage';
import { ProjectView } from './ProjectView';
import { IMAGE_EXTENSIONS } from './pairing';

type TrackDetail = TrackDto & {
  outputs: OutputRecord[];
  /** Lines added by other modules (e.g. Instagram pack status). */
  infos: { moduleId: string; label: string; value: string }[];
  /** « Analyse du master », when that module is there. */
  master: { available: boolean; status: MasterTrackStatus | null; path: string };
};

interface FormState {
  title: string;
  artist: string;
  releaseDate: string;
  tags: string;
  nicknames: string;
  notes: string;
}

function toForm(track: TrackDto): FormState {
  return {
    title: track.title,
    artist: track.artistOverride ?? '',
    releaseDate: track.releaseDate ?? '',
    tags: track.tags.join(', '),
    nicknames: (track.nicknames ?? []).join(', '),
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
  const [deleting, setDeleting] = useState(false);

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

  const remove = async (withOutputs: boolean) => {
    try {
      await module.api.delete(`/tracks/${data.id}${withOutputs ? '?outputs=1' : ''}`);
      navigate(module.path());
    } catch (error) {
      setStatus({ ok: false, text: errorMessage(error) });
    }
  };

  return (
    <Page
      title={data.title}
      subtitle={<Link to={module.path()}>← Bibliothèque</Link>}
      actions={
        <Button variant="danger" onClick={() => setDeleting(true)}>
          Supprimer
        </Button>
      }
    >
      {deleting && (
        <DeleteTrack
          title={data.title}
          outputCount={data.outputs.length}
          onCancel={() => setDeleting(false)}
          onConfirm={(withOutputs) => void remove(withOutputs)}
        />
      )}
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
            {data.infos.map((info) => (
              <Fragment key={`${info.moduleId}-${info.label}`}>
                <dt>{info.label}</dt>
                <dd>{info.value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>

        <div className="ml-detail__main">
          {/* Keyed by updatedAt: the form restarts from saved values after each save. */}
          <InfoForm key={data.updatedAt} track={data} onSaved={track.reload} />

          <Card title="Projet : tout ce qui a été généré">
            <ProjectView trackId={data.id} onChange={track.reload} />
          </Card>

          {data.master.available && (
            <MasterCard trackId={data.id} master={data.master} onChange={track.reload} />
          )}

          <Card title="Statistiques">
            <p className="muted">
              Les statistiques YouTube de ce morceau sont dans l’outil Stats YouTube, onglet «
              Morceaux » (ou demande à l’assistant : « stats de ce morceau »).
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}

/** Confirmation of a track deletion, with the choice to delete its generated files too. */
function DeleteTrack(props: {
  title: string;
  outputCount: number;
  onCancel: () => void;
  onConfirm: (withOutputs: boolean) => void;
}) {
  const [withOutputs, setWithOutputs] = useState(true);
  return (
    <Card title={`Supprimer « ${props.title} » ?`}>
      <p>
        Le son et la cover copiés dans ToolBox seront effacés. Tes fichiers d’origine ne sont pas
        touchés.
      </p>
      {props.outputCount > 0 && (
        <label className="ml-check">
          <input
            type="checkbox"
            checked={withOutputs}
            onChange={(e) => setWithOutputs(e.target.checked)}
          />
          Supprimer aussi les {props.outputCount} fichier(s) généré(s) à partir de ce morceau
          (vidéos, Reels, post) : ils partent dans la Corbeille.
        </label>
      )}
      <div className="inline-form">
        <Button
          variant="danger"
          onClick={() => props.onConfirm(withOutputs && props.outputCount > 0)}
        >
          Supprimer définitivement
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          Annuler
        </Button>
      </div>
    </Card>
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
        nicknames: form.nicknames.split(',').map((name) => name.trim()),
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
          <label htmlFor="ml-nicknames">Surnoms</label>
          <input
            id="ml-nicknames"
            className="input"
            value={form.nicknames}
            placeholder="le gros caillou, GK"
            onChange={(e) => update('nicknames', e.target.value)}
          />
          <p className="muted settings-form__help">
            Autres noms que tu utilises pour ce morceau, séparés par des virgules : l’assistant
            vocal les reconnaît comme le titre.
          </p>
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

/** The master of the track as « Analyse du master » measured it, and « Analyser ». */
function MasterCard(props: {
  trackId: number;
  master: TrackDetail['master'];
  onChange: () => void;
}) {
  const module = useModule();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = props.master.status;
  const analyse = async () => {
    setBusy(true);
    setError(null);
    try {
      await module.api.post(`/tracks/${props.trackId}/analyse-master`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      props.onChange();
    }
  };
  return (
    <Card title="Analyse du master">
      {s ? (
        <p>
          <strong>{s.versionName}</strong>{' '}
          {s.badge ? (
            <StateBadge tone={s.clips > 0 ? 'danger' : s.overs > 0 ? 'warning' : 'success'}>
              {s.badge}
            </StateBadge>
          ) : (
            <StateBadge tone="running">Analyse en cours</StateBadge>
          )}{' '}
          {s.badge && (
            <span className="small muted">
              {s.overs} dépassement(s) de crête, {s.clips} écrêtage(s)
            </span>
          )}
        </p>
      ) : (
        <p className="muted">Pas encore analysé.</p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="toolbar">
        <Button small disabled={busy} onClick={() => void analyse()}>
          Analyser
        </Button>
        <Link to={`/m/master-analysis${props.master.path}`}>Voir l’analyse</Link>
      </div>
      <p className="small muted">
        Mesure le fichier audio actuel du morceau (une nouvelle version seulement s’il a changé).
        Rien n’est modifié.
      </p>
    </Card>
  );
}
