// The page: projects on the left (library tracks, free analyses), the chosen
// project on the right with its versions (drop files to add one), and the
// analysis of the chosen version: timeline, global measures, sections,
// versions compared, references.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  confirmDelete,
  EmptyState,
  ErrorMessage,
  errorMessage,
  getFilePath,
  Page,
  pickFiles,
  ProgressBar,
  StateBadge,
  TrackList,
  useApi,
  useJobs,
  useModule,
} from '@hub/sdk/frontend';
import { decodeAnalysis } from '../shared/codec';
import { fr } from '../shared/format';
import type { Analysis, Section } from '../shared/types';
import { Global } from './Global';
import { References } from './References';
import { Sections } from './Sections';
import { Timeline } from './Timeline';
import type { AnalysisDto, ProjectDto, StateDto, VersionDto } from './types';
import { Versions } from './Versions';

const AUDIO = [
  { name: 'Audio (WAV, FLAC, AIFF, MP3)', extensions: ['wav', 'flac', 'aif', 'aiff', 'mp3'] },
];
const TABS = [
  ['timeline', 'Ligne de temps'],
  ['global', 'Mesures globales'],
  ['sections', 'Sections'],
  ['versions', 'Versions'],
  ['references', 'Références'],
] as const;
type Tab = (typeof TABS)[number][0];

/** An entry of the list: a project (key = its group, negative ids for the tracks not analysed yet). */
interface Entry {
  id: number;
  title: string;
  artist: string;
  coverUrl: string | null;
  project: ProjectDto | null;
  trackId: number | null;
}

export function MasterPage() {
  const module = useModule();
  const [params, setParams] = useSearchParams();
  const { jobs } = useJobs(module.id);
  const finished = jobs.filter((j) => j.finishedAt !== null).length;
  const active = jobs.find((j) => j.status === 'queued' || j.status === 'running');
  const state = useApi<StateDto>(module.url(`/state?v=${finished}-${active?.id ?? ''}`));
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const s = state.data;

  const entries: Entry[] = useMemo(() => {
    if (!s) return [];
    return [
      ...s.projects.map((p) => ({
        id: p.groupId,
        title: p.title,
        artist: p.kind === 'free' ? 'Analyse libre' : p.artist,
        coverUrl: p.coverUrl,
        project: p,
        trackId: p.trackId,
      })),
      ...s.tracks.map((t) => ({
        id: -t.id,
        title: t.title,
        artist: t.artist,
        coverUrl: t.coverUrl,
        project: null,
        trackId: t.id,
      })),
    ];
  }, [s]);
  const fromTrack = params.get('track');
  const selected =
    params.get('project') !== null
      ? Number(params.get('project'))
      : fromTrack !== null
        ? (s?.projects.find((p) => p.trackId === Number(fromTrack))?.groupId ?? -Number(fromTrack))
        : (entries[0]?.id ?? null);
  const entry = entries.find((e) => e.id === selected) ?? null;
  const select = (id: number, version?: number) =>
    setParams(
      id < 0
        ? { track: String(-id) }
        : { project: String(id), ...(version ? { version: String(version) } : {}) },
    );

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      state.reload();
    }
  };
  const addFiles = async (paths: string[], target: Entry | null) => {
    if (!paths.length) return;
    const body: Record<string, unknown> = { paths };
    if (target?.project) body.groupId = target.project.groupId;
    else if (target?.trackId) body.trackId = target.trackId;
    const result = (await run(() => module.api.post<{ groupId: number }>('/versions', body))) as {
      groupId: number;
    } | null;
    if (result) select(result.groupId);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const paths = [...event.dataTransfer.files]
      .map((f) => getFilePath(f))
      .filter((p): p is string => Boolean(p));
    void addFiles(paths, entry);
  };
  const newFree = async () => {
    const files = await pickFiles({ title: 'Masters à analyser', filters: AUDIO, multiple: true });
    if (files.length) void addFiles(files, null);
  };

  return (
    <Page
      title="Analyse du master"
      subtitle="Mesures du master pendant la production : rien n’est jamais modifié dans tes fichiers"
      actions={
        <Button variant="secondary" onClick={() => void newFree()}>
          Nouvelle analyse libre…
        </Button>
      }
    >
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {s && entries.length === 0 ? (
        <EmptyState title="Aucun master analysé.">
          Glisse un fichier WAV, FLAC, AIFF ou MP3 ici, ou « Nouvelle analyse libre… ».
          {!s.library && ' (La Bibliothèque n’est pas là : les analyses restent libres.)'}
          <div className="ma-drop" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            Déposer un fichier
          </div>
        </EmptyState>
      ) : (
        <TrackList
          tracks={entries}
          selected={selected}
          onSelect={(id) => select(id)}
          detail={(e) => {
            const last = e.project?.versions.at(-1);
            if (!e.project) return 'pas encore analysé';
            const kind = e.project.kind === 'free' ? 'Analyse libre · ' : '';
            return last?.summary
              ? `${kind}${last.name.split(' ')[0]} · ${fr(last.summary.integrated)} LUFS · ${fr(last.summary.truePeak, 1, true)} dBTP`
              : `${kind}${e.project.versions.length} version(s)`;
          }}
        >
          <div
            className={`ma-project${dragging ? ' ma-project--drop' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {entry && s && (
              <Project
                key={entry.id}
                entry={entry}
                state={s}
                versionId={params.get('version') ? Number(params.get('version')) : null}
                onVersion={(v) => entry.project && select(entry.project.groupId, v)}
                jobs={jobs}
                run={run}
                addFiles={(paths) => void addFiles(paths, entry)}
                reload={state.reload}
              />
            )}
          </div>
        </TrackList>
      )}
      {s && (
        <p className="small muted">
          Dossier surveillé :{' '}
          {s.watch.enabled ? `activé (${s.watch.folder || 'aucun dossier choisi'})` : 'désactivé'} —
          réglages du module. Lecture seule : rien n’y est jamais modifié, déplacé ni supprimé.
          {s.watch.error && <span className="error"> {s.watch.error}</span>}
        </p>
      )}
    </Page>
  );
}

function statusBadge(v: VersionDto, progress: number | null) {
  if (v.status === 'done') return <StateBadge tone="success">Analysée</StateBadge>;
  if (v.status === 'error')
    return (
      <StateBadge tone="danger" title={v.error ?? undefined}>
        Erreur
      </StateBadge>
    );
  if (v.status === 'cancelled') return <StateBadge tone="warning">Annulée</StateBadge>;
  return (
    <StateBadge tone="running">
      {progress !== null ? `Analyse ${Math.round(progress * 100)} %` : 'En attente'}
    </StateBadge>
  );
}

function Project(props: {
  entry: Entry;
  state: StateDto;
  versionId: number | null;
  onVersion: (id: number) => void;
  jobs: ReturnType<typeof useJobs>['jobs'];
  run: (action: () => Promise<unknown>) => Promise<unknown>;
  addFiles: (paths: string[]) => void;
  reload: () => void;
}) {
  const module = useModule();
  const project = props.entry.project;
  const versions = project?.versions ?? [];
  const current =
    versions.find((v) => v.id === props.versionId) ??
    versions.filter((v) => v.status === 'done').at(-1) ??
    versions.at(-1) ??
    null;
  const [tab, setTab] = useState<Tab>('timeline');
  const add = async () => {
    const files = await pickFiles({
      title: 'Nouvelle version du master',
      filters: AUDIO,
      multiple: true,
    });
    props.addFiles(files);
  };
  const tracks = props.state.projects.filter((p) => p.kind === 'track');
  const libraryTracks = [
    ...tracks.map((p) => ({ id: p.trackId!, title: p.title })),
    ...props.state.tracks.map((t) => ({ id: t.id, title: t.title })),
  ];
  return (
    <>
      <Card
        title={
          <>
            {props.entry.title}
            {project?.kind === 'free' && <span className="small muted"> · analyse libre</span>}
            {project?.missingTrack && (
              <span className="small error"> · morceau supprimé de la Bibliothèque</span>
            )}
          </>
        }
        actions={
          <div className="toolbar">
            {props.entry.trackId !== null && props.state.library && (
              <Button
                variant="secondary"
                small
                onClick={() =>
                  void props.run(() => module.api.post(`/tracks/${props.entry.trackId}/analyse`))
                }
              >
                Analyser le fichier de la Bibliothèque
              </Button>
            )}
            <Button small onClick={() => void add()}>
              Ajouter une version…
            </Button>
            {project?.kind === 'free' && (
              <Button
                variant="secondary"
                small
                onClick={() => {
                  const name = window.prompt('Nom du projet', project.title);
                  if (name?.trim())
                    void props.run(() => module.api.put(`/groups/${project.groupId}`, { name }));
                }}
              >
                Renommer
              </Button>
            )}
          </div>
        }
      >
        {project?.kind === 'free' && props.state.library && libraryTracks.length > 0 && (
          <div className="toolbar small">
            {project.suggestedTrack && (
              <span>
                Morceau proposé d’après le nom du fichier :{' '}
                <strong>{project.suggestedTrack.title}</strong>{' '}
                <Button
                  variant="secondary"
                  small
                  onClick={() =>
                    void props.run(() =>
                      module.api.post(`/groups/${project.groupId}/attach`, {
                        trackId: project.suggestedTrack!.id,
                      }),
                    )
                  }
                >
                  Rattacher
                </Button>
              </span>
            )}
            <label>
              Rattacher à un morceau{' '}
              <select
                className="input input--short"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  void props.run(() =>
                    module.api.post(`/groups/${project.groupId}/attach`, {
                      trackId: Number(e.target.value),
                    }),
                  )
                }
              >
                <option value="">—</option>
                {libraryTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {versions.length === 0 ? (
          <p className="muted">
            Pas encore de version : glisse un fichier ici, « Ajouter une version… »
            {props.entry.trackId !== null ? ' ou « Analyser le fichier de la Bibliothèque »' : ''}.
          </p>
        ) : (
          <ul className="ma-versions">
            {versions.map((v) => {
              const job = props.jobs.find((j) => j.id === v.jobId);
              return (
                <li
                  key={v.id}
                  className={v.id === current?.id ? 'ma-version ma-version--active' : 'ma-version'}
                >
                  <button
                    type="button"
                    className="ma-version__main"
                    onClick={() => props.onVersion(v.id)}
                  >
                    <strong>{v.name}</strong>
                    <span className="small muted">
                      {v.originalName}
                      {v.source === 'watch'
                        ? ' · dossier surveillé'
                        : v.source === 'library'
                          ? ' · Bibliothèque'
                          : ''}
                      {v.identicalTo ? ` · identique à ${v.identicalTo}` : ''}
                    </span>
                    {v.summary && (
                      <span className="small num">
                        {fr(v.summary.integrated)} LUFS · {fr(v.summary.truePeak, 1, true)} dBTP ·
                        PLR {fr(v.summary.plr)} · {v.summary.overs.length} dépassement(s)
                        {v.summary.clips ? ` · ${v.summary.clips} écrêtage(s)` : ''}
                      </span>
                    )}
                  </button>
                  {statusBadge(v, job?.progress ?? null)}
                  {(v.status === 'queued' || v.status === 'running') && (
                    <ProgressBar value={job?.progress ?? null} />
                  )}
                  <div className="ui-actions">
                    <Button
                      variant="secondary"
                      small
                      onClick={() => {
                        const name = window.prompt('Nom de la version', v.name);
                        if (name?.trim())
                          void props.run(() => module.api.put(`/versions/${v.id}`, { name }));
                      }}
                    >
                      Renommer
                    </Button>
                    {(v.status === 'error' || v.status === 'cancelled') && (
                      <Button
                        variant="secondary"
                        small
                        onClick={() =>
                          void props.run(() => module.api.post(`/versions/${v.id}/retry`))
                        }
                      >
                        Relancer
                      </Button>
                    )}
                    {v.status === 'done' && (
                      <Button
                        variant="secondary"
                        small
                        onClick={() =>
                          void props.run(() => module.api.post(`/versions/${v.id}/export`))
                        }
                      >
                        Exporter (HTML)
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      small
                      onClick={() =>
                        confirmDelete(
                          `la version « ${v.name} » (sa copie dans l’app ; ton fichier d’origine n’est pas touché)`,
                        ) && void props.run(() => module.api.delete(`/versions/${v.id}`))
                      }
                    >
                      Supprimer
                    </Button>
                  </div>
                  {v.error && <p className="small error">{v.error}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {current?.status === 'done' && (
        <AnalysisView
          key={current.id}
          version={current}
          versions={versions}
          tab={tab}
          onTab={setTab}
          state={props.state}
          reload={props.reload}
        />
      )}
    </>
  );
}

function AnalysisView(props: {
  version: VersionDto;
  versions: VersionDto[];
  tab: Tab;
  onTab: (t: Tab) => void;
  state: StateDto;
  reload: () => void;
}) {
  const module = useModule();
  const data = useApi<AnalysisDto>(module.url(`/versions/${props.version.id}/analysis`));
  const analysis: Analysis | null = useMemo(
    () => (data.data ? decodeAnalysis(data.data.text) : null),
    [data.data],
  );
  const [sections, setSections] = useState<Section[] | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  useEffect(() => setAudioEl(audio.current), [data.data]);
  if (data.error) return <ErrorMessage>{data.error}</ErrorMessage>;
  if (!data.data || !analysis) return <p className="muted">Lecture de l’analyse…</p>;
  const d = data.data;
  const shownSections = sections ?? d.sections;
  const limit = threshold ?? d.threshold;
  const seek = (t: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = t;
    void el.play();
  };
  return (
    <div className="ma-analysis">
      <div className="toolbar ma-player">
        <audio ref={audio} src={props.version.audioUrl ?? undefined} controls preload="metadata" />
        <label className="small">
          Seuil des dépassements{' '}
          <input
            className="input input--short num"
            type="number"
            step={0.1}
            min={-6}
            max={3}
            value={limit}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />{' '}
          dBTP
        </label>
        <span className="small muted">
          Analysé en {fr((props.version.analysisMs ?? analysis.analysisMs) / 1000)} s
        </span>
      </div>
      <nav className="ma-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={props.tab === id}
            onClick={() => props.onTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {props.tab === 'timeline' && (
        <Timeline
          analysis={analysis}
          sections={shownSections}
          threshold={limit}
          audio={audioEl}
          onSeek={seek}
        />
      )}
      {props.tab === 'global' && (
        <Global analysis={analysis} threshold={limit} platforms={d.platforms} onSeek={seek} />
      )}
      {props.tab === 'sections' && (
        <Sections
          versionId={props.version.id}
          analysis={analysis}
          sections={shownSections}
          cursor={() => audio.current?.currentTime ?? 0}
          onChange={setSections}
          onSeek={seek}
        />
      )}
      {props.tab === 'versions' && (
        <Versions versions={props.versions} current={props.version} onSeek={seek} />
      )}
      {props.tab === 'references' && (
        <References state={props.state} reload={props.reload} current={props.version} />
      )}
    </div>
  );
}
