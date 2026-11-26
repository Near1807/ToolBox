// v0.45.0, v0.50.0: a folder's view (header with its badges and default
// labels, filters in pills, cards or list, drop = put away here, « Nouveau
// dossier », « Nouveau fichier… »), a Fin de route or a Projet browsed inside
// (Inside.tsx), the views by label (« Python », « Prof PCH »), À ranger and the
// Coffre's Recycle Bin.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Button,
  EmptyState,
  ErrorMessage,
  FilterPill,
  formatBytes,
  Icon,
  Page,
  useApi,
  useContextMenu,
  useModule,
} from '@hub/sdk/frontend';
import { PALETTE } from '@hub/sdk/palette';
import { fold } from '../shared/deduce';
import { facetsOf, filterItems, type FacetSelection } from '../shared/facets';
import { linkedTo, NO_COURSE } from '../shared/now';
import {
  LABEL_FAMILIES,
  FAMILY_NAMES,
  type LabelFamily,
  type CourseHint,
  type ItemDto,
} from '../shared/types';
import { useCoffre } from './frame';
import { useTreeActions } from './folder-actions';
import { SelectBar, useSelection } from './BatchEdit';
import { Tile } from './Home';
import { Items, useView, ViewBar } from './Items';
import { shortDate } from './logic';
import { DiskTrash } from './disk/DiskTrash';
import { DefaultLabels } from './Labels';
import { Inside } from './Inside';
import { useDisk } from './disk/useDisk';

/** The pills of a list: combinable (AND between keys, OR inside one). */
export function Facets(props: {
  items: ItemDto[];
  selection: FacetSelection;
  onChange: (s: FacetSelection) => void;
  /** Families left out (the view's own family). */
  without?: LabelFamily[];
}) {
  const facets = facetsOf(props.items, props.selection).filter(
    (f) => !props.without?.includes(f.key) && (f.values.length > 1 || f.values.some((v) => v.on)),
  );
  if (!facets.length) return null;
  const toggle = (key: LabelFamily, value: string) => {
    const now = props.selection[key] ?? [];
    const on = now.some((v) => fold(v) === fold(value));
    props.onChange({
      ...props.selection,
      [key]: on ? now.filter((v) => fold(v) !== fold(value)) : [...now, value],
    });
  };
  const any = LABEL_FAMILIES.some((k) => props.selection[k]?.length);
  return (
    <div className="coffre-facets" aria-label="Filtres">
      {facets.map((f) => (
        <div key={f.key} className="coffre-facets__group">
          <span className="coffre-facets__label">{FAMILY_NAMES[f.key]}</span>
          {f.values.slice(0, 14).map((v) => (
            <FilterPill
              key={v.value}
              label={v.value}
              count={v.count}
              on={v.on}
              onClick={() => toggle(f.key, v.value)}
            />
          ))}
        </div>
      ))}
      {any && (
        <Button variant="secondary" small onClick={() => props.onChange({})}>
          Retirer les filtres
        </Button>
      )}
    </div>
  );
}

function FilteredItems(props: {
  items: ItemDto[];
  showFolder?: boolean;
  without?: LabelFamily[];
  empty: string;
}) {
  const [selection, setSelection] = useState<FacetSelection>({});
  const [onlyPending, setOnlyPending] = useState(false);
  const sel = useSelection();
  const coffre = useCoffre();
  const view = useView();
  const pending = props.items.filter((i) => i.diskState === 'pending').length;
  const shown = useMemo(
    () =>
      filterItems(props.items, selection).filter((i) => !onlyPending || i.diskState === 'pending'),
    [props.items, selection, onlyPending],
  );
  return (
    <>
      {(pending > 0 || onlyPending) && (
        <div className="coffre-facets__group coffre-facets__disk">
          <span className="coffre-facets__label">Disque</span>
          <FilterPill
            label="Pas encore sur le disque"
            count={pending}
            on={onlyPending}
            onClick={() => setOnlyPending((v) => !v)}
            title="Seulement sur ce PC : copiés à la prochaine mise à jour du disque"
          />
        </div>
      )}
      <Facets
        items={props.items}
        selection={selection}
        onChange={setSelection}
        without={props.without}
      />
      <ViewBar count={shown.length} state={view} />
      {/* v0.48.0: select (boxes, Ctrl / Maj + clic), « Modifier la sélection… »; archive with a disk. */}
      <SelectBar
        sel={sel}
        shown={shown}
        extra={
          coffre.disk?.disk && (
            <Button
              variant="secondary"
              small
              disabled={!shown.some((i) => sel.ids.has(i.id)) || !coffre.disk.connected}
              title={
                coffre.disk.connected ? undefined : `Branche le disque « ${coffre.disk.disk.name} »`
              }
              onClick={() => {
                coffre.archive(shown.filter((i) => sel.ids.has(i.id) && i.diskState === 'active'));
                sel.clear();
              }}
            >
              Archiver la sélection
            </Button>
          )
        }
      />
      <Items
        items={shown}
        select={sel.selecting ? { ids: sel.ids, toggle: sel.toggle } : undefined}
        onModClick={sel.modClick}
        showFolder={props.showFolder}
        view={view.view}
        sort={view.sort}
        onSort={view.setSort}
        empty={props.items.length ? 'Aucun fichier avec ces filtres.' : props.empty}
      />
    </>
  );
}

const slot = (next: NonNullable<CourseHint['next']>) => {
  const start = new Date(next.start);
  const end = new Date(next.end);
  const day = start.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${hour(start)} – ${hour(end)}${next.location ? ` · ${next.location}` : ''}`;
};

export function FolderPage() {
  const { id = '' } = useParams();
  const module = useModule();
  const coffre = useCoffre();
  const navigate = useNavigate();
  const items = useApi<ItemDto[]>(module.url(`/files?folder=${encodeURIComponent(id)}`));
  const courses = useApi<CourseHint[]>(module.url('/courses'));
  const tree = useTreeActions();
  const treeMenu = useContextMenu();
  const folder = coffre.folders.find((c) => c.id === id);
  const children = coffre.folders.filter((c) => c.parentId === id);
  useEffect(() => {
    coffre.setHere(id);
    return () => coffre.setHere(null);
  }, [coffre, id]);

  // v0.47.0: linked by hand (« Lié au cours … »), else by its name or code.
  const hint = useApi<{ project: string | null }>(
    folder && !folder.project ? module.url(`/folders/${id}/hint`) : null,
  );
  const course = useMemo(() => {
    if (!folder) return null;
    return (courses.data ?? []).find((c) => linkedTo(folder, c)) ?? null;
  }, [folder, courses.data]);
  const linkCourse = (courseName: string | null) =>
    void module.api
      .patch(`/folders/${id}`, { courseName })
      .then(() => coffre.refresh())
      .catch(coffre.fail);

  if (!folder)
    return (
      <Page title="Dossier">
        <EmptyState title="Ce dossier n’existe plus">
          <Link to={coffre.path('')}>Retour au Coffre</Link>
        </EmptyState>
      </Page>
    );

  const recolor = (color: string) =>
    coffre.api
      .patch(`/folders/${id}`, { color: color || null })
      .then(coffre.refresh)
      .catch(coffre.fail);

  return (
    <Page
      title={folder.name}
      subtitle={
        <span className="coffre-crumbs">
          <Link to={coffre.path('')}>Coffre</Link>
          {folder.path.slice(0, -1).map((name, i) => {
            const parent = coffre.folders.find(
              (c) => c.path.length === i + 1 && c.path.every((p, j) => p === folder.path[j]),
            );
            return (
              <span key={i}>
                {' › '}
                {parent ? <Link to={coffre.path(`c/${parent.id}`)}>{name}</Link> : name}
              </span>
            );
          })}
        </span>
      }
      actions={
        <>
          {!folder.project && (
            <>
              <Button onClick={() => coffre.pick(id)}>Ranger des fichiers ici…</Button>
              <Button variant="secondary" onClick={() => coffre.create('folder', id)}>
                Nouveau dossier
              </Button>
              <Button variant="secondary" onClick={() => coffre.create('file', id)}>
                Nouveau fichier…
              </Button>
            </>
          )}
          {/* v0.48.0: the same actions as the tree and the map (ADR 0064). */}
          <Button variant="secondary" onClick={() => tree.rename(folder)}>
            Renommer
          </Button>
          <Button
            variant="secondary"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              treeMenu.openAt(() => tree.menuOf(folder), r.left, r.bottom + 4);
            }}
            {...treeMenu.bind(() => tree.menuOf(folder), folder.name)}
          >
            Organiser…
          </Button>
          <label className="coffre-color">
            <span
              className="coffre-color__dot"
              style={{ background: folder.css }}
              aria-hidden="true"
            />
            <select
              className="input"
              aria-label="Couleur du dossier"
              value={folder.color ?? ''}
              onChange={(e) => void recolor(e.target.value)}
            >
              <option value="">Couleur de la famille</option>
              {PALETTE.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      <div
        data-coffre-page
        data-coffre-folder={id}
        className="coffre-folder"
        style={{ '--folder-color': folder.css } as React.CSSProperties}
      >
        <div className="coffre-folder__band" aria-hidden="true" />
        {/* v0.50.0: its route, its count, its disk state, its badges, its default labels. */}
        <section className="coffre-folder__info" data-coffre-folder-info>
          <span>
            {folder.total} fichier{folder.total > 1 ? 's' : ''}
            {folder.total !== folder.count ? ` (dont ${folder.count} ici)` : ''}
          </span>
          {(items.data ?? []).some((i) => i.diskState === 'pending') && (
            <span className="coffre-chip coffre-chip--warn">pas encore tout sur le disque</span>
          )}
          {folder.project && <span className="coffre-kind coffre-kind--project">Projet</span>}
          {folder.endOfRoute && !folder.project && (
            <span className="coffre-kind">Fin de route</span>
          )}
          {!folder.project && hint.data?.project && (
            <span className="coffre-hint" data-coffre-project-hint>
              Ressemble à un projet ({hint.data.project}).{' '}
              <button
                type="button"
                className="coffre-linklike"
                onClick={() =>
                  void module.api
                    .post<{ undoId?: string }>(`/folders/${id}/project`, { on: true })
                    .then((r) => {
                      coffre.notify(`« ${folder.name} » est un projet.`, r.undoId ?? null);
                      coffre.refresh();
                    })
                    .catch(coffre.fail)
                }
              >
                Marquer comme projet
              </button>
            </span>
          )}
        </section>
        {!folder.project && <DefaultLabels folder={folder} />}
        {course && (
          <section className="coffre-folder__head">
            {course && (
              <div className="coffre-course">
                <span className="coffre-course__tag">Cours de l’Agenda</span>
                {course.code && <strong className="coffre-course__code">{course.code}</strong>}
                {course.teachers.length > 0 && (
                  <span>
                    {course.teachers.length > 1 ? 'Profs' : 'Prof'} :{' '}
                    {course.teachers.map((t, i) => (
                      <span key={t}>
                        {i > 0 && ', '}
                        <Link to={coffre.path(`v/prof/${encodeURIComponent(t)}`)}>{t}</Link>
                      </span>
                    ))}
                  </span>
                )}
                {course.next && <span>Prochain créneau : {slot(course.next)}</span>}
              </div>
            )}
          </section>
        )}
        {(courses.data?.length ?? 0) > 0 && (
          <label className="coffre-folder__course-link">
            <span className="muted small">Lié au cours</span>{' '}
            <select
              className="input"
              value={folder.courseName ?? ''}
              onChange={(e) => linkCourse(e.target.value || null)}
            >
              <option value="">
                Automatique (même nom ou code){course ? ` : ${course.name}` : ''}
              </option>
              {(courses.data ?? []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.code ? ` (${c.code})` : ''}
                </option>
              ))}
              <option value={NO_COURSE}>Aucun cours</option>
            </select>
          </label>
        )}
        {folder.endOfRoute ? (
          <Inside folder={folder} files={items.data ?? null} />
        ) : (
          <>
            {children.length > 0 && (
              <div className="coffre-tiles coffre-tiles--small">
                {children.map((c) => (
                  <Tile key={c.id} folder={c} />
                ))}
              </div>
            )}
            {items.error && <ErrorMessage>{items.error}</ErrorMessage>}
            {items.data && (
              <FilteredItems
                items={items.data}
                empty="Rien ici pour l’instant : glisse des fichiers sur cette page pour les ranger dans ce dossier."
              />
            )}
          </>
        )}
        <p className="muted coffre-folder__foot">
          <button
            type="button"
            className="coffre-linklike"
            onClick={() => navigate(coffre.path(''))}
          >
            <Icon name="arrow-left" /> Tous les dossiers
          </button>
        </p>
      </div>
      {treeMenu.node}
      {tree.node}
    </Page>
  );
}

export function LabelPage() {
  const { key = '', value = '' } = useParams();
  const module = useModule();
  const coffre = useCoffre();
  const k = key as LabelFamily;
  const items = useApi<ItemDto[]>(
    module.url(`/files?family=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`),
  );
  useEffect(() => coffre.setHere(null), [coffre]);
  const label = LABEL_FAMILIES.includes(k) ? FAMILY_NAMES[k] : key;
  return (
    <Page
      title={`${label} : ${value}`}
      subtitle={
        <span className="coffre-crumbs">
          <Link to={coffre.path('')}>Coffre</Link> › tout ce qui est « {value} », dans tous les
          dossiers
        </span>
      }
    >
      <div data-coffre-page>
        {items.error && <ErrorMessage>{items.error}</ErrorMessage>}
        {items.data && (
          <FilteredItems
            items={items.data}
            showFolder
            without={[k]}
            empty="Plus rien avec cette valeur."
          />
        )}
      </div>
    </Page>
  );
}

export function PendingPage() {
  const module = useModule();
  const coffre = useCoffre();
  const items = useApi<ItemDto[]>(module.url('/files?pending=1'));
  const view = useView();
  useEffect(() => coffre.setHere(null), [coffre]);
  const list = items.data ?? [];
  return (
    <Page
      title="À ranger"
      subtitle="Ce qui attend d’être rangé (« Ranger plus tard »). Espace ou clic sur l’aperçu : sa route et ses étiquettes."
      actions={
        list.length > 0 && <Button onClick={() => coffre.preview(list, 0)}>Ranger un par un</Button>
      }
    >
      <div data-coffre-page data-coffre-pending>
        {items.error && <ErrorMessage>{items.error}</ErrorMessage>}
        {items.data && !list.length ? (
          <EmptyState title="Tout est rangé" />
        ) : (
          <>
            <ViewBar count={list.length} state={view} />
            <Items items={list} view={view.view} sort={view.sort} onSort={view.setSort} />
          </>
        )}
      </div>
    </Page>
  );
}

export function TrashPage() {
  const module = useModule();
  const coffre = useCoffre();
  const items = useApi<ItemDto[]>(module.url('/files?trash=1'));
  useEffect(() => coffre.setHere(null), [coffre]);
  const restore = (item: ItemDto) =>
    coffre.api
      .post(`/files/${item.id}/restore`)
      .then(() => {
        coffre.notify(`« ${item.name} » est revenu.`);
        coffre.refresh();
      })
      .catch(coffre.fail);
  const erase = (item: ItemDto) => {
    if (
      !window.confirm(
        `Effacer définitivement « ${item.name} » de ce PC ?\n\nS'il est déjà sur le disque du coffre, il reste dans la corbeille du disque (récupérable tant qu'il y est). Sinon, il ne pourra plus être récupéré.`,
      )
    )
      return;
    coffre.api
      .post(`/files/${item.id}/erase`, { confirm: true })
      .then(() => {
        coffre.notify(`« ${item.name} » est effacé définitivement.`);
        coffre.refresh();
      })
      .catch(coffre.fail);
  };
  const list = items.data ?? [];
  const disk = useDisk(10_000);
  return (
    <Page
      title="Corbeille du Coffre"
      subtitle="Ce qui a été supprimé du Coffre. Rien n’est effacé du disque sans ta confirmation."
    >
      <div data-coffre-page>
        {items.error && <ErrorMessage>{items.error}</ErrorMessage>}
        {items.data && !list.length && <EmptyState title="La corbeille est vide" />}
        {list.length > 0 && (
          <table className="coffre-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Venait de</th>
                <th>Supprimé</th>
                <th>Taille</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id}>
                  <td className="coffre-table__name">{item.name}</td>
                  <td>{item.folderPath?.join(' › ') ?? 'À ranger'}</td>
                  <td>{shortDate(item.trashedAt)}</td>
                  <td className="coffre-table__num">{formatBytes(item.size)}</td>
                  <td className="coffre-table__actions">
                    <Button variant="secondary" small onClick={() => void restore(item)}>
                      Récupérer
                    </Button>
                    <Button variant="danger" small onClick={() => erase(item)}>
                      Effacer définitivement
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <DiskTrash status={disk.data} />
      </div>
    </Page>
  );
}

const STATE_TITLES: Record<string, { title: string; subtitle: string; empty: string }> = {
  pending: {
    title: 'Pas encore sur le disque',
    subtitle:
      'Seulement sur ce PC : nouveaux, ou modifiés depuis la dernière mise à jour du disque.',
    empty: 'Tout est sur le disque.',
  },
  suggest: {
    title: 'Suggestions d’archivage',
    subtitle:
      'Sur le disque, pas ouverts depuis 6 mois : « Sélectionner… » puis « Archiver la sélection » libère leur place sur le PC. Rien n’est archivé tout seul.',
    empty: 'Aucune suggestion.',
  },
  archived: {
    title: 'Archivés',
    subtitle: 'Sur le disque seulement : visibles et trouvables ici, fichiers sur le disque dur.',
    empty: 'Aucun fichier archivé.',
  },
};

/** v0.46.0: the files in a disk state (« pas encore sur le disque », archivés). */
export function StatePage() {
  const { state = 'pending' } = useParams();
  const module = useModule();
  const coffre = useCoffre();
  const items = useApi<ItemDto[]>(module.url(`/files?state=${encodeURIComponent(state)}`));
  useEffect(() => coffre.setHere(null), [coffre]);
  const t = STATE_TITLES[state] ?? STATE_TITLES.pending!;
  return (
    <Page
      title={t.title}
      subtitle={
        <span className="coffre-crumbs">
          <Link to={coffre.path('')}>Coffre</Link> › {t.subtitle}
        </span>
      }
    >
      <div data-coffre-page>
        {items.error && <ErrorMessage>{items.error}</ErrorMessage>}
        {items.data && <FilteredItems items={items.data} showFolder empty={t.empty} />}
      </div>
    </Page>
  );
}
