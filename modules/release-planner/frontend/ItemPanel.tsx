// Detail of a planned element: date and time, YouTube metadata (editable
// before sending), status, upload, links; Instagram: file to drag, caption,
// « Publié »; missing file: regenerate or remove.
import { useState } from 'react';
import {
  Button,
  ErrorMessage,
  errorMessage,
  formatTags,
  ProgressBar,
  TextFields,
  useModule,
  type JobInfo,
  Icon,
} from '@hub/sdk/frontend';
import { longDate } from './dates';
import { DragPreview, PlatformIcon, StatusBadge, trackColor } from './ItemParts';
import type { PlannerItem, Visibility } from './types';

const VISIBILITY_LABELS: Record<Visibility, string> = {
  scheduled: 'Programmée : privée, puis publique à la date prévue',
  public: 'Publique dès l’envoi',
  unlisted: 'Non répertoriée dès l’envoi',
  private: 'Privée (à publier toi-même dans YouTube Studio)',
};

/** Remounted (key) when the element changes, so the form starts from its values. */
export function ItemPanel(props: {
  item: PlannerItem;
  job: JobInfo | null;
  onClose: () => void;
  onChanged: (message?: string) => void;
}) {
  const module = useModule();
  const { item } = props;
  const [date, setDate] = useState(item.date);
  const [time, setTime] = useState(item.time);
  const [visibility, setVisibility] = useState<Visibility>(item.visibility);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  const youtube = item.platform === 'youtube';
  const online =
    item.youtube !== null && ['scheduled', 'to-schedule', 'published'].includes(item.state);
  const editable = youtube && !online && item.state !== 'uploading';
  const uploading = item.state === 'uploading' || item.state === 'queued';
  const progress = props.job?.progress ?? item.job?.progress ?? null;

  const run = async (
    action: () => Promise<unknown>,
    done?: (result: unknown) => string | undefined,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      props.onChanged(done?.(result));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    // Contrôle et sécurité: a date already on YouTube only changes after a yes.
    if (
      item.youtube &&
      (date !== item.date || time !== item.time) &&
      !window.confirm(
        `« ${item.label} » est déjà sur YouTube. Changer aussi sa date de publication sur YouTube (${date.split('-').reverse().join('/')} à ${time}) ?`,
      )
    ) {
      return;
    }
    return run(
      () =>
        module.api.patch(`/items/${item.id}`, {
          date,
          time,
          ...(editable ? { visibility } : {}),
        }),
      (result) => (result as { warnings: string[] }).warnings.join(' ') || 'Enregistré.',
    );
  };

  const remove = (online?: 'keep' | 'delete') => {
    if (
      online === 'delete' &&
      !window.confirm(
        'Supprimer définitivement cette vidéo de YouTube ? Cette action est irréversible.',
      )
    ) {
      return;
    }
    void run(
      () => module.api.delete(`/items/${item.id}${online ? `?online=${online}` : ''}`),
      () => {
        props.onClose();
        return online === 'delete'
          ? 'Élément retiré et vidéo supprimée de YouTube.'
          : 'Élément retiré du planning.';
      },
    );
  };

  return (
    <aside className="rp-panel" aria-label={`${item.label} — ${item.trackTitle}`}>
      <header className="rp-panel__header" style={{ borderTopColor: trackColor(item.colorIndex) }}>
        <div>
          <div className="rp-panel__kind">
            <PlatformIcon kind={item.kind} size={18} /> {item.label}
          </div>
          <h2>{item.trackTitle}</h2>
          <div className="muted small">{item.artist}</div>
        </div>
        <button
          type="button"
          className="rp-panel__close"
          aria-label="Fermer"
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
      </header>

      <StatusBadge item={item} />
      <p className="muted small">
        {longDate(item.date, true)} à {item.time}
        {item.shiftedFrom &&
          ` · décalé automatiquement (prévu le ${item.shiftedFrom.split('-').reverse().join('/')})`}
      </p>
      {item.warning && <p className="rp-note rp-note--warning">{item.warning}</p>}
      {item.error && <p className="rp-note rp-note--error">{item.error}</p>}
      {item.notBefore && item.state === 'queued' && (
        <p className="rp-note">
          Envoi prévu à partir du {new Date(item.notBefore).toLocaleString('fr-FR')} (quota
          YouTube).
        </p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {!item.source.exists && item.status !== 'published' && (
        <div className="rp-note rp-note--warning">
          {item.source.gone
            ? 'Le fichier généré a été supprimé.'
            : item.source.rendered
              ? 'Fichier introuvable (déplacé ou supprimé hors de l’app).'
              : 'Fichier pas encore généré.'}
          <div className="inline-form">
            <Button
              small
              disabled={busy}
              onClick={() =>
                void run(
                  () => module.api.post(`/items/${item.id}/regenerate`),
                  () => 'Rendu lancé (voir Tâches).',
                )
              }
            >
              {item.source.rendered || item.source.gone ? 'Régénérer' : 'Générer'}
            </Button>
            {!online && (
              <Button small variant="secondary" disabled={busy} onClick={() => remove()}>
                Retirer du planning
              </Button>
            )}
          </div>
        </div>
      )}

      <section className="rp-panel__section">
        <h3>Date de publication</h3>
        <div className="inline-form">
          <input
            className="input input--short"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
          />
          <input
            className="input input--short"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Heure"
          />
        </div>
        {online && item.status !== 'published' && (
          <p className="muted small">
            Déjà sur YouTube : la nouvelle date y est envoyée directement.
          </p>
        )}
      </section>

      {youtube && (
        <section className="rp-panel__section">
          <h3>Sur YouTube</h3>
          {editable ? (
            <>
              <TextFields
                fields={[
                  { key: 'title', label: 'Titre', max: 100 },
                  {
                    key: 'description',
                    label: 'Description',
                    multiline: true,
                    rows: 6,
                    max: 5000,
                    maxUnit: 'bytes',
                    help: '{lien_video} est remplacé à l’envoi par le lien de la vidéo complète.',
                  },
                  { key: 'tags', label: 'Tags', placeholder: 'lofi, chill' },
                ]}
                values={{
                  title: item.title ?? '',
                  description: item.description ?? '',
                  tags: formatTags(item.tags),
                }}
                custom={item.textsCustom}
                onSave={async (values) => {
                  await module.api.patch(`/items/${item.id}`, values);
                  props.onChanged();
                }}
                onReset={async () => {
                  await module.api.patch(`/items/${item.id}`, { resetTexts: true });
                  props.onChanged();
                }}
                onSaveAsTemplate={async (values) => {
                  await module.api.post(`/items/${item.id}/texts/template`, values);
                  props.onChanged('Modèle par défaut enregistré (Réglages › Planning de sortie).');
                }}
              />
              <label className="rp-field">
                <span>Visibilité</span>
                <select
                  className="input"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as Visibility)}
                >
                  {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small">Catégorie Musique · « conçue pour les enfants » : non.</p>
            </>
          ) : (
            <>
              <p>
                <strong>{item.title}</strong>
              </p>
              {item.youtube && (
                <div className="inline-form">
                  <a
                    className="button button--secondary button--small"
                    href={item.youtube.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Voir sur YouTube <Icon name="external-link" size="0.95em" />
                  </a>
                  <a
                    className="button button--secondary button--small"
                    href={item.youtube.studioUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir dans YouTube Studio <Icon name="external-link" size="0.95em" />
                  </a>
                </div>
              )}
            </>
          )}
          {uploading && (
            <div className="rp-upload">
              <ProgressBar value={item.state === 'uploading' ? progress : null} />
              <span className="muted small">
                {props.job?.message ?? (item.state === 'queued' ? 'En attente d’envoi…' : 'Envoi…')}
              </span>
            </div>
          )}
        </section>
      )}

      {!youtube && (
        <section className="rp-panel__section">
          <h3>À publier sur Instagram</h3>
          <div className="rp-insta">
            <DragPreview item={item} size="large" />
            <div className="rp-insta__text">
              <TextFields
                fields={[
                  {
                    key: 'caption',
                    label: 'Légende',
                    multiline: true,
                    rows: 5,
                    max: 2200,
                    copy: true,
                  },
                ]}
                values={{ caption: item.caption ?? '' }}
                readOnly={item.caption === null || item.status === 'published'}
                resetLabel={
                  item.kind === 'insta-post' ? 'Rétablir le modèle' : 'Reprendre celle du pack'
                }
                onSave={async ({ caption }) => {
                  await module.api.patch(`/items/${item.id}/caption`, { caption });
                  props.onChanged();
                }}
                onReset={async () => {
                  await module.api.patch(`/items/${item.id}/caption`, { caption: null });
                  props.onChanged();
                }}
              />
              <div className="inline-form">
                {item.source.exists && (
                  <Button
                    variant="secondary"
                    small
                    onClick={() => void run(() => module.api.post(`/items/${item.id}/reveal`))}
                  >
                    Montrer le fichier
                  </Button>
                )}
              </div>
              <label className="rp-check">
                <input
                  type="checkbox"
                  checked={item.status === 'published'}
                  onChange={(e) =>
                    void run(() =>
                      module.api.post(`/items/${item.id}/published`, {
                        published: e.target.checked,
                      }),
                    )
                  }
                />
                Publié (synchronisé avec le pack Instagram)
              </label>
            </div>
          </div>
        </section>
      )}

      <footer className="rp-panel__actions">
        <Button
          disabled={busy || (date === item.date && time === item.time && !editable)}
          onClick={() => void save()}
        >
          Enregistrer
        </Button>
        {youtube && (item.state === 'planned' || item.state === 'failed') && (
          <Button
            variant="secondary"
            disabled={busy || !item.source.exists}
            onClick={() =>
              void run(
                () => module.api.post(`/items/${item.id}/upload`),
                (result) =>
                  (result as { quotaMessage: string | null }).quotaMessage ?? 'Envoi lancé.',
              )
            }
          >
            {item.state === 'failed' ? 'Réessayer l’envoi' : 'Envoyer et programmer'}
          </Button>
        )}
        {uploading && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => module.api.post(`/items/${item.id}/cancel`))}
          >
            Annuler l’envoi
          </Button>
        )}
        {!removing ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => (online ? setRemoving(true) : remove())}
          >
            Retirer
          </Button>
        ) : (
          <div className="rp-note rp-note--warning">
            Cette vidéo est déjà sur YouTube.
            <div className="inline-form">
              <Button small variant="secondary" onClick={() => remove('keep')}>
                Retirer du planning seulement
              </Button>
              <Button small variant="danger" onClick={() => remove('delete')}>
                Supprimer aussi sur YouTube
              </Button>
              <Button small variant="secondary" onClick={() => setRemoving(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </footer>
    </aside>
  );
}
