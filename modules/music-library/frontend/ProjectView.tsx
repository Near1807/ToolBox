import { useState } from 'react';
import {
  confirmDelete,
  EmptyState,
  ErrorMessage,
  errorMessage,
  FileActions,
  MediaThumb,
  outputs,
  OutputCard,
  StateBadge,
  useApi,
  useModule,
  type MediaAspect,
  type OutputRecord,
  type StateTone,
} from '@hub/sdk/frontend';

export interface ProjectElement extends OutputRecord {
  status: 'generated' | 'planned' | 'scheduled' | 'published' | 'missing';
  statusDetail: string | null;
  included: boolean;
}

const STATUS: Record<ProjectElement['status'], { label: string; tone: StateTone }> = {
  generated: { label: 'Généré', tone: 'neutral' },
  planned: { label: 'Planifié', tone: 'accent' },
  scheduled: { label: 'Programmé', tone: 'running' },
  published: { label: 'Publié', tone: 'success' },
  missing: { label: 'Introuvable', tone: 'warning' },
};

/** Groups of the project page, in this order; anything else goes to « Autres fichiers ». */
const GROUPS: { title: string; match: (e: ProjectElement) => boolean; aspect: MediaAspect }[] = [
  { title: 'Vidéos YouTube', match: (e) => e.moduleId === 'youtube-video', aspect: 'landscape' },
  {
    title: 'Posts Instagram',
    match: (e) => e.moduleId === 'instagram-video' && e.kind === 'post',
    aspect: 'portrait',
  },
  {
    title: 'Reels (cover)',
    match: (e) => e.moduleId === 'instagram-video' && e.kind === 'reel',
    aspect: 'vertical',
  },
  {
    title: 'Reels perso',
    match: (e) => e.moduleId === 'custom-reels' && e.kind !== 'source',
    aspect: 'vertical',
  },
  { title: 'Miniatures', match: (e) => e.moduleId === 'release-planner', aspect: 'landscape' },
  {
    title: 'Rapports d’analyse du master',
    match: (e) => e.moduleId === 'master-analysis' && e.kind !== 'source',
    aspect: 'landscape',
  },
  // Imported material (kind « source », MODULES.md §5.13): listed, never part of the release.
  {
    title: 'Masters importés (analyse)',
    match: (e) => e.moduleId === 'master-analysis' && e.kind === 'source',
    aspect: 'landscape',
  },
  { title: 'Vidéos importées', match: (e) => e.kind === 'source', aspect: 'landscape' },
];

const isVideo = (element: OutputRecord) => /\.(mp4|mov|webm)$/i.test(element.fileName);
/** Audio files, reports…: no picture, the file name stands in for it. */
const hasPicture = (element: OutputRecord) =>
  isVideo(element) || /\.(png|jpe?g|webp|gif)$/i.test(element.fileName);

/**
 * The project of a track: everything generated from it, grouped by type, with
 * its status (généré / planifié / programmé / publié) and the « Inclure dans
 * la sortie » box read by the release planner.
 */
export function ProjectView(props: { trackId: number; onChange?: () => void }) {
  const module = useModule();
  const project = useApi<ProjectElement[]>(module.url(`/tracks/${props.trackId}/project`));
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      project.reload();
      props.onChange?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (project.error) return <ErrorMessage>{project.error}</ErrorMessage>;
  if (!project.data) return <p className="muted">Chargement…</p>;
  const elements = project.data;
  if (elements.length === 0) {
    return (
      <EmptyState title="Rien de généré pour ce morceau.">
        Les vidéos, Reels, posts et miniatures créés avec les outils de la section Musique
        apparaîtront ici, avec leur état de publication.
      </EmptyState>
    );
  }

  const placed = new Set<number>();
  const groups = GROUPS.map((group) => {
    const list = elements.filter((e) => !placed.has(e.id) && group.match(e));
    list.forEach((e) => placed.add(e.id));
    return { ...group, list };
  });
  const others = elements.filter((e) => !placed.has(e.id));
  if (others.length)
    groups.push({ title: 'Autres fichiers', match: () => true, aspect: 'landscape', list: others });

  const deliverables = elements.filter((e) => e.kind !== 'source');
  const included = deliverables.filter((e) => e.included).length;

  return (
    <div className="ml-project">
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <p className="muted small">
        {included}/{deliverables.length} élément(s) inclus dans la sortie. Le Planning de sortie ne
        propose que les éléments cochés « Inclure dans la sortie ».
      </p>
      {groups
        .filter((group) => group.list.length > 0)
        .map((group) => (
          <section key={group.title} className="ml-project__group">
            <h3>
              {group.title} <span className="faint num">{group.list.length}</span>
            </h3>
            <div className="ui-cards">
              {group.list.map((element) => (
                <OutputCard
                  key={element.id}
                  title={element.label}
                  dimmed={element.kind !== 'source' && !element.included}
                  badge={
                    <StateBadge
                      tone={STATUS[element.status].tone}
                      title={element.statusDetail ?? undefined}
                    >
                      {STATUS[element.status].label}
                    </StateBadge>
                  }
                  thumb={
                    <MediaThumb
                      src={hasPicture(element) ? element.url : null}
                      media={isVideo(element) ? 'video' : 'image'}
                      aspect={group.aspect}
                      dragUrl={element.url}
                      placeholder={element.fileName}
                    />
                  }
                  meta={
                    element.statusDetail ?? new Date(element.createdAt).toLocaleDateString('fr-FR')
                  }
                  missing={
                    element.exists
                      ? null
                      : { onForget: () => void run(() => outputs.forget([element.id])) }
                  }
                  actions={
                    element.exists && (
                      <FileActions
                        onOpen={() => void run(() => outputs.open(element.id))}
                        openLabel={isVideo(element) ? 'Lire' : 'Voir'}
                        onReveal={() => void run(() => outputs.reveal(element.id))}
                        onDelete={() => {
                          if (confirmDelete(`« ${element.fileName} »`)) {
                            void run(() => outputs.delete([element.id]));
                          }
                        }}
                      />
                    )
                  }
                >
                  {element.kind !== 'source' && (
                    <label className="ml-include">
                      <input
                        type="checkbox"
                        checked={element.included}
                        onChange={(e) =>
                          void run(() =>
                            module.api.put(`/tracks/${props.trackId}/project/included`, {
                              moduleId: element.moduleId,
                              ref: element.ref,
                              included: e.target.checked,
                            }),
                          )
                        }
                      />
                      Inclure dans la sortie
                    </label>
                  )}
                </OutputCard>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
