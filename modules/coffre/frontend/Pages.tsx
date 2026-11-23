// v0.45.0: a context's page (header, filters in pills, cards or list, drop =
// put away here), the views by attribute (« Python », « Prof PCH »),
// Arrivée and the Coffre's Recycle Bin.
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
  useModule,
} from '@hub/sdk/frontend';
import { PALETTE } from '@hub/sdk/palette';
import { fold } from '../shared/deduce';
import { facetsOf, filterItems, type FacetSelection } from '../shared/facets';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  type AttributeKey,
  type CourseHint,
  type ItemDto,
} from '../shared/types';
import { useCoffre } from './frame';
import { Tile } from './Home';
import { Items, useView, ViewBar } from './Items';
import { shortDate } from './logic';

/** The pills of a list: combinable (AND between keys, OR inside one). */
export function Facets(props: {
  items: ItemDto[];
  selection: FacetSelection;
  onChange: (s: FacetSelection) => void;
  /** Keys left out (the view's own key). */
  without?: AttributeKey[];
}) {
  const facets = facetsOf(props.items, props.selection).filter(
    (f) => !props.without?.includes(f.key) && (f.values.length > 1 || f.values.some((v) => v.on)),
  );
  if (!facets.length) return null;
  const toggle = (key: AttributeKey, value: string) => {
    const now = props.selection[key] ?? [];
    const on = now.some((v) => fold(v) === fold(value));
    props.onChange({
      ...props.selection,
      [key]: on ? now.filter((v) => fold(v) !== fold(value)) : [...now, value],
    });
  };
  const any = ATTRIBUTE_KEYS.some((k) => props.selection[k]?.length);
  return (
    <div className="coffre-facets" aria-label="Filtres">
      {facets.map((f) => (
        <div key={f.key} className="coffre-facets__group">
          <span className="coffre-facets__label">
            {f.key === 'tag' ? 'Tags' : ATTRIBUTE_LABELS[f.key]}
          </span>
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
  showContext?: boolean;
  without?: AttributeKey[];
  empty: string;
}) {
  const [selection, setSelection] = useState<FacetSelection>({});
  const view = useView();
  const shown = useMemo(() => filterItems(props.items, selection), [props.items, selection]);
  return (
    <>
      <Facets
        items={props.items}
        selection={selection}
        onChange={setSelection}
        without={props.without}
      />
      <ViewBar count={shown.length} state={view} />
      <Items
        items={shown}
        showContext={props.showContext}
        view={view.view}
        sort={view.sort}
        onSort={view.setSort}
        empty={props.items.length ? 'Aucun élément avec ces filtres.' : props.empty}
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

export function ContextPage() {
  const { id = '' } = useParams();
  const module = useModule();
  const coffre = useCoffre();
  const navigate = useNavigate();
  const items = useApi<ItemDto[]>(module.url(`/items?context=${encodeURIComponent(id)}`));
  const courses = useApi<CourseHint[]>(module.url('/courses'));
  const context = coffre.contexts.find((c) => c.id === id);
  const children = coffre.contexts.filter((c) => c.parentId === id);
  useEffect(() => {
    coffre.setHere(id);
    return () => coffre.setHere(null);
  }, [coffre, id]);

  const course = useMemo(() => {
    if (!context) return null;
    const name = fold(context.name);
    return (
      (courses.data ?? []).find(
        (c) => fold(c.name) === name || (c.code && fold(c.code) === name),
      ) ?? null
    );
  }, [context, courses.data]);
  const cover = context?.coverItemId ? items.data?.find((i) => i.id === context.coverItemId) : null;

  if (!context)
    return (
      <Page title="Contexte">
        <EmptyState title="Ce contexte n’existe plus">
          <Link to={coffre.path('')}>Retour au Coffre</Link>
        </EmptyState>
      </Page>
    );

  const rename = () => {
    const name = window.prompt('Nouveau nom du contexte (son dossier suit) :', context.name);
    if (!name?.trim() || name.trim() === context.name) return;
    coffre.api
      .patch(`/contexts/${id}`, { name })
      .then(() => {
        coffre.notify(`Contexte renommé en « ${name.trim()} ».`);
        coffre.refresh();
      })
      .catch(coffre.fail);
  };
  const recolor = (color: string) =>
    coffre.api
      .patch(`/contexts/${id}`, { color: color || null })
      .then(coffre.refresh)
      .catch(coffre.fail);

  return (
    <Page
      title={context.name}
      subtitle={
        <span className="coffre-crumbs">
          <Link to={coffre.path('')}>Coffre</Link>
          {context.path.slice(0, -1).map((name, i) => {
            const parent = coffre.contexts.find(
              (c) => c.path.length === i + 1 && c.path.every((p, j) => p === context.path[j]),
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
          <Button onClick={() => coffre.pick(id)}>Ranger des fichiers ici…</Button>
          <Button variant="secondary" onClick={rename}>
            Renommer
          </Button>
          <label className="coffre-color">
            <span
              className="coffre-color__dot"
              style={{ background: context.css }}
              aria-hidden="true"
            />
            <select
              className="input"
              aria-label="Couleur du contexte"
              value={context.color ?? ''}
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
        data-coffre-context={id}
        className="coffre-context"
        style={{ '--context-color': context.css } as React.CSSProperties}
      >
        <div className="coffre-context__band" aria-hidden="true" />
        {(cover?.url || course) && (
          <section className="coffre-context__head">
            {cover?.url && <img className="coffre-context__cover" src={cover.url} alt="" />}
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
        {children.length > 0 && (
          <div className="coffre-tiles coffre-tiles--small">
            {children.map((c) => (
              <Tile key={c.id} context={c} />
            ))}
          </div>
        )}
        {items.error && <ErrorMessage>{items.error}</ErrorMessage>}
        {items.data && (
          <FilteredItems
            items={items.data}
            empty="Rien ici pour l’instant : glisse des fichiers sur cette page pour les ranger dans ce contexte."
          />
        )}
        <p className="muted coffre-context__foot">
          <button
            type="button"
            className="coffre-linklike"
            onClick={() => navigate(coffre.path(''))}
          >
            <Icon name="arrow-left" /> Tous les contextes
          </button>
        </p>
      </div>
    </Page>
  );
}

export function AttributePage() {
  const { key = '', value = '' } = useParams();
  const module = useModule();
  const coffre = useCoffre();
  const k = key as AttributeKey;
  const items = useApi<ItemDto[]>(
    module.url(`/items?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`),
  );
  useEffect(() => coffre.setHere(null), [coffre]);
  const label = ATTRIBUTE_KEYS.includes(k) ? (k === 'tag' ? 'Tag' : ATTRIBUTE_LABELS[k]) : key;
  return (
    <Page
      title={`${label} : ${value}`}
      subtitle={
        <span className="coffre-crumbs">
          <Link to={coffre.path('')}>Coffre</Link> › tout ce qui est « {value} », dans tous les
          contextes
        </span>
      }
    >
      <div data-coffre-page>
        {items.error && <ErrorMessage>{items.error}</ErrorMessage>}
        {items.data && (
          <FilteredItems
            items={items.data}
            showContext
            without={[k]}
            empty="Plus rien avec cette valeur."
          />
        )}
      </div>
    </Page>
  );
}

export function ArrivalPage() {
  const module = useModule();
  const coffre = useCoffre();
  const items = useApi<ItemDto[]>(module.url('/items?arrival=1'));
  const view = useView();
  useEffect(() => coffre.setHere(null), [coffre]);
  const list = items.data ?? [];
  return (
    <Page
      title="Arrivée"
      subtitle="Ce qui attend d’être rangé. Espace ou clic sur l’aperçu : la fiche, avec son contexte."
      actions={
        list.length > 0 && <Button onClick={() => coffre.preview(list, 0)}>Ranger un par un</Button>
      }
    >
      <div data-coffre-page data-coffre-arrival>
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
  const items = useApi<ItemDto[]>(module.url('/items?trash=1'));
  useEffect(() => coffre.setHere(null), [coffre]);
  const restore = (item: ItemDto) =>
    coffre.api
      .post(`/items/${item.id}/restore`)
      .then(() => {
        coffre.notify(`« ${item.name} » est revenu.`);
        coffre.refresh();
      })
      .catch(coffre.fail);
  const erase = (item: ItemDto) => {
    if (
      !window.confirm(
        `Effacer définitivement « ${item.name} » ?\n\nLe fichier est supprimé du disque : il ne pourra plus être récupéré.`,
      )
    )
      return;
    coffre.api
      .post(`/items/${item.id}/erase`, { confirm: true })
      .then(() => {
        coffre.notify(`« ${item.name} » est effacé définitivement.`);
        coffre.refresh();
      })
      .catch(coffre.fail);
  };
  const list = items.data ?? [];
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
                  <td>{item.contextPath?.join(' › ') ?? 'Arrivée'}</td>
                  <td>{shortDate(item.trashedAt)}</td>
                  <td className="coffre-table__num">
                    {item.kind === 'link' ? '' : formatBytes(item.size)}
                  </td>
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
      </div>
    </Page>
  );
}
