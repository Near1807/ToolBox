import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  Card,
  confirmDelete,
  EmptyState,
  ExcerptChip,
  ExcerptWaveform,
  ErrorMessage,
  errorMessage,
  formatDuration,
  MissingFile,
  outputs,
  Page,
  SelectionBar,
  TextFields,
  useApi,
  useJobs,
  useModule,
  useSelection,
} from '@hub/sdk/frontend';
import { ItemTile } from './ItemTile';
import type { Pack, PackItem, TrackDetail, TrackSummary, WaveformData } from './types';

const REELS = 4;

/** Caption of one Reel, under its tile: the pack caption unless it has its own. */
function ReelCaption(props: {
  item: PackItem;
  pack: Pack;
  onSave: (caption: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const own = props.pack.perReelCaptions && props.item.ownCaption !== null;
  const custom = own && props.item.ownCaption !== props.pack.caption;
  return (
    <details className="iv-tile-caption">
      <summary className="small">Légende {custom ? '· personnalisée' : '· celle du pack'}</summary>
      <TextFields
        fields={[
          {
            key: 'caption',
            label: 'Légende du Reel',
            multiline: true,
            rows: 4,
            max: 2200,
            copy: true,
          },
        ]}
        values={{ caption: props.item.caption }}
        custom={custom}
        resetLabel="Reprendre celle du pack"
        templateLabel="Légende du pack"
        readOnly={Boolean(props.item.publishedAt)}
        onSave={({ caption }) => props.onSave(caption ?? '')}
        onReset={props.onReset}
      />
    </details>
  );
}

/** No pack yet: Reel length, room in the track, « Générer le pack Insta ». */
function CreatePack(props: {
  track: TrackDetail;
  onCreate: (input: { clipDuration: number; count: number; allowOverlap: boolean }) => void;
  busy: boolean;
}) {
  const module = useModule();
  const [clip, setClip] = useState(props.track.defaultClip);
  const waveform = useApi<WaveformData>(
    module.url(`/tracks/${props.track.id}/waveform?clip=${clip}`),
  );
  const capacity = waveform.data?.capacity;
  const create = (count: number, allowOverlap: boolean) =>
    props.onCreate({ clipDuration: clip, count, allowOverlap });

  return (
    <Card title="Pack Insta">
      <p className="muted">
        4 Reels verticaux de {clip} s sur les passages les plus énergiques (hors intro et outro),
        une image de post 4:5 et une légende. Tu pourras déplacer et écouter chaque extrait avant le
        rendu.
      </p>
      <div className="iv-controls">
        <label htmlFor="iv-clip">Durée d’un Reel</label>
        <input
          id="iv-clip"
          type="range"
          min={15}
          max={60}
          step={1}
          value={clip}
          onChange={(e) => setClip(Number(e.target.value))}
        />
        <strong>{clip} s</strong>
      </div>
      {waveform.error && <ErrorMessage>{waveform.error}</ErrorMessage>}
      {!capacity && !waveform.error && <p className="muted">Analyse du son…</p>}
      {capacity && capacity.distinct >= REELS && (
        <Button disabled={props.busy || !props.track.coverUrl} onClick={() => create(REELS, false)}>
          Générer le pack Insta
        </Button>
      )}
      {capacity && capacity.distinct < REELS && (
        <div className="iv-warning">
          <p>
            Le morceau est trop court pour 4 extraits différents de {clip} s sans se chevaucher :{' '}
            {capacity.distinct} possible{capacity.distinct > 1 ? 's' : ''}.
          </p>
          <div className="inline-form">
            <Button
              disabled={props.busy || !props.track.coverUrl}
              onClick={() => create(capacity.distinct, false)}
            >
              Faire {capacity.distinct} Reel{capacity.distinct > 1 ? 's' : ''}
            </Button>
            {capacity.overlapping > capacity.distinct && (
              <Button
                variant="secondary"
                disabled={props.busy || !props.track.coverUrl}
                onClick={() => create(capacity.overlapping, true)}
              >
                {capacity.overlapping} Reels avec un léger chevauchement
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function TrackPanel(props: { trackId: number; onChange: () => void }) {
  const module = useModule();
  const detail = useApi<TrackDetail>(module.url(`/tracks/${props.trackId}`));
  const { jobs, cancel } = useJobs(module.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [playing, setPlaying] = useState<{ id: number; time: number } | null>(null);
  const [preview, setPreview] = useState<{ id: number; url: string | null } | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const watchedJobs = useRef(new Set<string>());
  const selection = useSelection<number>();

  const pack = detail.data?.pack ?? null;
  const waveform = useApi<WaveformData>(
    pack ? module.url(`/tracks/${props.trackId}/waveform?clip=${pack.clipDuration}`) : null,
  );

  // Reload when a render of this module finishes — whatever started it (this
  // page, « Régénérer » elsewhere, another window): jobs seen queued or running
  // are watched until they end.
  const { reload } = detail;
  const { onChange } = props;
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'running') {
        watchedJobs.current.add(job.id);
      } else if (watchedJobs.current.delete(job.id)) {
        reload();
        onChange();
      }
    }
  }, [jobs, reload, onChange]);

  if (detail.error) return <ErrorMessage>{detail.error}</ErrorMessage>;
  if (!detail.data) return null;
  const track = detail.data;
  const reels = pack?.items.filter((item) => item.kind === 'reel') ?? [];
  const active = reels.find((r) => r.id === activeId) ?? reels.find((r) => !r.publishedAt) ?? null;
  const rendering = (pack?.items ?? []).filter((item) => item.state === 'rendering').length;
  const toRender = (pack?.items ?? []).filter((item) =>
    ['draft', 'outdated', 'failed', 'missing'].includes(item.state),
  );

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => {
    reload();
    onChange();
  };
  const patchPack = (fields: Partial<Pick<Pack, 'caption' | 'clipDuration' | 'perReelCaptions'>>) =>
    run(async () => {
      await module.api.patch(`/packs/${pack!.id}`, fields);
      refresh();
    });
  const patchItem = (item: PackItem, fields: Record<string, unknown>) =>
    run(async () => {
      await module.api.patch(`/items/${item.id}`, fields);
      refresh();
    });
  // Deletion and « Retirer de la liste » go through the core registry (ctx.outputs).
  const changeOutputs = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      selection.clear();
      refresh();
    });
  const deleteItems = (items: PackItem[], what: string) => {
    const ids = items.map((item) => item.outputId).filter((id): id is number => id !== null);
    if (ids.length && confirmDelete(what)) void changeOutputs(() => outputs.delete(ids));
  };
  const deletePack = () => {
    if (!pack) return;
    const files = pack.items.filter((item) => item.outputId !== null).length;
    const what = `le pack de « ${track.title} »${files ? ` et ses ${files} fichier(s)` : ''}`;
    if (confirmDelete(what)) {
      void changeOutputs(() => module.api.delete(`/packs/${pack.id}`));
    }
  };
  const missingItems = (pack?.items ?? []).filter((item) => item.state === 'missing');

  const itemAction = (item: PackItem, action: 'open' | 'reveal' | 'render') =>
    run(async () => {
      await module.api.post(`/items/${item.id}/${action}`);
      if (action === 'render') refresh();
    });

  const listen = (item: PackItem) => {
    const element = audio.current;
    if (!element || item.startSec === null) return;
    if (playing?.id === item.id) {
      element.pause();
      return;
    }
    element.currentTime = item.startSec;
    setPlaying({ id: item.id, time: item.startSec });
    void element.play();
  };
  const playingItem = reels.find((r) => r.id === playing?.id);

  const makePreview = (item: PackItem) =>
    run(async () => {
      setPreview({ id: item.id, url: null });
      try {
        const { url } = await module.api.post<{ url: string }>(`/items/${item.id}/preview`);
        setPreview({ id: item.id, url });
      } catch (err) {
        setPreview(null);
        throw err;
      }
    });

  const overlapping = (item: PackItem) =>
    reels.some(
      (other) =>
        other.id !== item.id &&
        Math.abs((other.startSec ?? 0) - (item.startSec ?? 0)) < (item.durationSec ?? 0) - 0.01,
    );

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
              {track.artist || 'Artiste non renseigné'} · {formatDuration(track.durationSec)}
            </p>
            {pack && (
              <p>
                <span className="badge badge--succeeded">
                  {pack.published}/{pack.total} publiés
                </span>
              </p>
            )}
            {!track.coverUrl && (
              <p className="error">
                Ce morceau n’a pas de cover : ajoute-la dans la Bibliothèque pour créer le pack.
              </p>
            )}
          </div>
          {pack && (
            <div className="iv-track__actions">
              <Button
                variant="secondary"
                onClick={() => void run(() => module.api.post(`/packs/${pack.id}/open-folder`))}
              >
                Ouvrir le dossier
              </Button>
              <Button variant="danger" onClick={deletePack}>
                Supprimer le pack
              </Button>
            </div>
          )}
        </div>
      </Card>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {!pack && (
        <CreatePack
          track={track}
          busy={busy}
          onCreate={(input) =>
            void run(async () => {
              await module.api.post(`/tracks/${track.id}/pack`, input);
              refresh();
            })
          }
        />
      )}

      {pack && (
        <Card
          title="Extraits des Reels"
          actions={
            <Button
              variant="secondary"
              small
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await module.api.post(`/packs/${pack.id}/suggest`, {});
                  refresh();
                })
              }
            >
              Proposer d’autres extraits
            </Button>
          }
        >
          <div className="iv-controls">
            <label htmlFor="iv-clip">Durée d’un Reel</label>
            <select
              id="iv-clip"
              className="input"
              value={pack.clipDuration}
              onChange={(e) => void patchPack({ clipDuration: Number(e.target.value) })}
            >
              {[...new Set([15, 20, 25, 26, 27, 28, 29, 30, 35, 40, 45, 60, pack.clipDuration])]
                .sort((a, b) => a - b)
                .map((s) => (
                  <option key={s} value={s}>
                    {s} s
                  </option>
                ))}
            </select>
            <span className="muted small">
              Glisse un extrait sur la forme d’onde, ou clique pour y placer l’extrait choisi.
            </span>
          </div>
          {waveform.error && <ErrorMessage>{waveform.error}</ErrorMessage>}
          {!waveform.data && !waveform.error && <p className="muted">Analyse du son…</p>}
          {waveform.data && (
            <ExcerptWaveform
              label="Extraits des Reels sur la forme d’onde"
              peaks={waveform.data.peaks}
              durationSec={waveform.data.durationSec}
              regions={reels.map((r) => ({
                id: r.id,
                position: r.position,
                start: r.startSec ?? 0,
                clipSec: r.durationSec ?? pack.clipDuration,
                locked: Boolean(r.publishedAt),
              }))}
              activeId={active?.id ?? null}
              playheadSec={playing?.time ?? null}
              onActivate={setActiveId}
              onMove={(id, start) => {
                const item = reels.find((r) => r.id === id);
                if (item) void patchItem(item, { startSec: start });
              }}
            />
          )}
          <audio
            ref={audio}
            src={track.audioUrl}
            onTimeUpdate={(e) => {
              const time = e.currentTarget.currentTime;
              if (!playingItem) return;
              if (time >= (playingItem.startSec ?? 0) + (playingItem.durationSec ?? 0)) {
                e.currentTarget.pause();
              } else {
                setPlaying({ id: playingItem.id, time });
              }
            }}
            onPause={() => setPlaying(null)}
          />
          <ul className="iv-excerpts">
            {reels.map((reel) => (
              <li
                key={reel.id}
                className={`iv-excerpt${reel.id === active?.id ? ' iv-excerpt--active' : ''}`}
              >
                <ExcerptChip
                  position={reel.position}
                  active={reel.id === active?.id}
                  onClick={() => setActiveId(reel.id)}
                  title="Choisir cet extrait sur la forme d’onde"
                />
                <span className="iv-excerpt__time">
                  {formatDuration(reel.startSec ?? 0)} →{' '}
                  {formatDuration((reel.startSec ?? 0) + (reel.durationSec ?? 0))}
                </span>
                {!reel.publishedAt && (
                  <span className="inline-form">
                    <Button
                      variant="secondary"
                      small
                      onClick={() =>
                        void patchItem(reel, { startSec: Math.max(0, (reel.startSec ?? 0) - 1) })
                      }
                    >
                      −1 s
                    </Button>
                    <Button
                      variant="secondary"
                      small
                      onClick={() => void patchItem(reel, { startSec: (reel.startSec ?? 0) + 1 })}
                    >
                      +1 s
                    </Button>
                  </span>
                )}
                <Button variant="secondary" small onClick={() => listen(reel)}>
                  {playing?.id === reel.id ? 'Stop' : 'Écouter'}
                </Button>
                <Button
                  variant="secondary"
                  small
                  disabled={!track.coverUrl || (preview?.id === reel.id && !preview.url)}
                  onClick={() => void makePreview(reel)}
                >
                  {preview?.id === reel.id && !preview.url ? 'Aperçu…' : 'Aperçu vidéo'}
                </Button>
                {overlapping(reel) && <span className="badge badge--warning">chevauche</span>}
                {reel.publishedAt && <span className="badge">publié : fixé</span>}
                {reel.state === 'outdated' && (
                  <span className="badge badge--warning">extrait modifié : à régénérer</span>
                )}
              </li>
            ))}
          </ul>
          {preview?.url && (
            <video className="iv-preview" src={preview.url} controls autoPlay>
              <track kind="captions" />
            </video>
          )}
          <div className="iv-render">
            <Button
              disabled={busy || rendering > 0 || toRender.length === 0 || !track.coverUrl}
              onClick={() =>
                void run(async () => {
                  await module.api.post(`/packs/${pack.id}/render`);
                  refresh();
                })
              }
            >
              {rendering > 0
                ? `Rendu en cours (${pack.total - rendering}/${pack.total})…`
                : toRender.length === pack.total
                  ? 'Lancer le rendu du pack'
                  : toRender.length > 0
                    ? `Générer les ${toRender.length} fichiers à refaire`
                    : 'Pack à jour'}
            </Button>
            <span className="muted small">
              Fichiers : {pack.folder} — « {track.title} - Reel 1.mp4 », … et « {track.title} -
              Post.jpg ».
            </span>
          </div>
        </Card>
      )}

      {pack && (
        <Card title="Fichiers du pack">
          <p className="muted small">
            Glisse une vignette vers une autre fenêtre (Instagram dans le navigateur,
            l’Explorateur…) pour y déposer le fichier.
          </p>
          <SelectionBar
            total={pack.items.filter((item) => item.outputId !== null).length}
            count={selection.selected.size}
            onSelectAll={() =>
              selection.setAll(pack.items.filter((i) => i.outputId !== null).map((i) => i.id))
            }
            onClear={selection.clear}
            onDelete={() =>
              deleteItems(
                pack.items.filter((item) => selection.has(item.id)),
                `les ${selection.selected.size} fichiers sélectionnés`,
              )
            }
          >
            {missingItems.length > 0 && (
              <Button
                variant="secondary"
                small
                onClick={() =>
                  void changeOutputs(() =>
                    outputs.forget(
                      missingItems.map((i) => i.outputId).filter((id): id is number => id !== null),
                    ),
                  )
                }
              >
                Nettoyer les éléments introuvables ({missingItems.length})
              </Button>
            )}
          </SelectionBar>
          <div className="ui-cards">
            {pack.items.map((item) => (
              <ItemTile
                key={item.id}
                item={item}
                job={jobs.find((job) => job.id === item.jobId) ?? null}
                onAction={(action) => void itemAction(item, action)}
                onPublish={(fields) => void patchItem(item, fields)}
                onCancel={(id) => void cancel(id)}
                selected={selection.has(item.id)}
                onSelect={() => selection.toggle(item.id)}
                onDelete={() => deleteItems([item], `« ${item.fileName ?? item.label} »`)}
                onForget={() =>
                  item.outputId !== null &&
                  void changeOutputs(() => outputs.forget([item.outputId!]))
                }
              >
                {item.kind === 'reel' && (
                  <ReelCaption
                    item={item}
                    pack={pack}
                    onSave={async (caption) => {
                      // A caption of its own: per-Reel captions are switched on.
                      if (!pack.perReelCaptions) {
                        await module.api.patch(`/packs/${pack.id}`, { perReelCaptions: true });
                      }
                      await module.api.patch(`/items/${item.id}`, { caption });
                      refresh();
                    }}
                    onReset={async () => {
                      await module.api.patch(`/items/${item.id}`, { caption: null });
                      refresh();
                    }}
                  />
                )}
              </ItemTile>
            ))}
          </div>
        </Card>
      )}

      {pack && (
        <Card title="Légende du pack">
          <TextFields
            fields={[
              {
                key: 'caption',
                label: 'Légende (post et Reels)',
                multiline: true,
                rows: 6,
                max: 2200,
                copy: true,
              },
            ]}
            values={{ caption: pack.caption }}
            custom={pack.captionCustom}
            onSave={async ({ caption }) => {
              await module.api.patch(`/packs/${pack.id}`, { caption });
              refresh();
            }}
            onReset={async () => {
              await module.api.post(`/packs/${pack.id}/caption/reset`);
              refresh();
            }}
            onSaveAsTemplate={async ({ caption }) => {
              await module.api.post(`/packs/${pack.id}/caption/template`, { caption });
              refresh();
            }}
          />
          <label className="iv-check">
            <input
              type="checkbox"
              checked={pack.perReelCaptions}
              onChange={(e) => void patchPack({ perReelCaptions: e.target.checked })}
            />
            Une légende différente par Reel (modifiable sous chaque Reel)
          </label>
          <p className="muted small">
            Modèle et hashtags par défaut : Réglages › Pack Instagram. Le modèle ne fait que
            pré-remplir : le texte ci-dessus est celui qui sera publié.
          </p>
        </Card>
      )}

      {track.legacyReels.length > 0 && (
        <Card title="Anciens Reels (avant les packs)">
          <ul className="list">
            {track.legacyReels.map((reel) => (
              <li key={reel.id} className="list__item">
                <div>
                  <strong>{reel.fileName}</strong>
                  <div className="muted small">
                    {new Date(reel.createdAt).toLocaleString('fr-FR')} · extrait de{' '}
                    {formatDuration(reel.startSec)} ({Math.round(reel.durationSec)} s)
                  </div>
                </div>
                {reel.exists ? (
                  <span className="inline-form">
                    <Button
                      variant="secondary"
                      small
                      onClick={() => void run(() => module.api.post(`/reels/${reel.id}/reveal`))}
                    >
                      Ouvrir le dossier
                    </Button>
                    <Button
                      variant="danger"
                      small
                      onClick={() => {
                        if (confirmDelete(`« ${reel.fileName} »`)) {
                          void changeOutputs(() => outputs.delete([reel.outputId]));
                        }
                      }}
                    >
                      Supprimer
                    </Button>
                  </span>
                ) : (
                  <MissingFile
                    onForget={() => void changeOutputs(() => outputs.forget([reel.outputId]))}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export function PackPage() {
  const module = useModule();
  const tracks = useApi<TrackSummary[]>(module.url('/tracks'));
  const toPublish = useApi<unknown[]>(module.url('/to-publish'));
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const selected = Number(params.get('track')) || tracks.data?.[0]?.id || null;
  const visible = (tracks.data ?? []).filter((t) =>
    `${t.title} ${t.artist}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const { reload: reloadTracks } = tracks;
  const { reload: reloadToPublish } = toPublish;
  const onChange = useCallback(() => {
    reloadTracks();
    reloadToPublish();
  }, [reloadTracks, reloadToPublish]);

  return (
    <Page
      title="Pack Instagram"
      subtitle="4 Reels, une image de post et la légende de chaque morceau, à publier quand tu veux."
      actions={
        <Link className="button button--secondary" to={module.path('a-publier')}>
          À publier{toPublish.data ? ` (${toPublish.data.length})` : ''}
        </Link>
      }
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
                      <span className="muted small">
                        {track.pack
                          ? `Pack : ${track.pack.published}/${track.pack.total} publiés`
                          : formatDuration(track.durationSec)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="iv-panel">
            {selected && <TrackPanel key={selected} trackId={selected} onChange={onChange} />}
          </div>
        </div>
      )}
    </Page>
  );
}
