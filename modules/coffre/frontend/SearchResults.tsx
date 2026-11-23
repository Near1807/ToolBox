// v0.47.0 (Expérimental): the Coffre's search results — asked from the server
// while typing (names, sheets AND content), grouped by element: its extracts
// with the words marked and their page; a click opens the preview AT THAT
// PAGE, the words marked. Filtered by the Coffre's pills.
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ErrorMessage, Icon, MarkedText, useApi, useModule } from '@hub/sdk/frontend';
import { filterItems, type FacetSelection } from '../shared/facets';
import type { ItemDto, SearchDto, SearchHitDto } from '../shared/types';
import { useCoffre } from './frame';
import { Facets } from './Pages';
import { iconOf } from './ReaderView';

/** « page 3 », « diapositive 2 », « src/main.c » (as the server's hint). */
export function partLabel(hit: Pick<SearchHitDto, 'item'>, part: string): string {
  if (!part) return '';
  if (hit.item.kind === 'project') return part;
  if (hit.item.ext === 'pptx') return `diapositive ${part}`;
  return `page ${part}`;
}

/** The query, sent after a short pause (results while typing, the last answer only). */
function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchResults(props: { query: string }) {
  const module = useModule();
  const coffre = useCoffre();
  const q = useDebounced(props.query.trim(), 120);
  const r = useApi<SearchDto>(q ? module.url(`/search?q=${encodeURIComponent(q)}`) : null);
  const [selection, setSelection] = useState<FacetSelection>({});
  const data = r.data?.query === q ? r.data : null;
  const results = useMemo(() => {
    if (!data) return [];
    const kept = new Set(
      filterItems(
        data.results.map((x) => x.item),
        selection,
      ).map((i) => i.id),
    );
    return data.results.filter((x) => kept.has(x.item.id));
  }, [data, selection]);
  const items = useMemo(() => results.map((x) => x.item), [results]);
  const index = data?.index;

  return (
    <section className="coffre-section" data-coffre-results>
      <h2 className="coffre-h2">
        Résultats pour « {props.query.trim()} »{' '}
        <span className="muted">({data ? results.length : '…'})</span>
        <span className="badge badge--warning coffre-results__exp">Expérimental</span>
      </h2>
      {index && index.pending > 0 && (
        <p className="muted small coffre-results__reading">
          Lecture des textes en cours : {index.done} / {index.total}. Le contenu des autres éléments
          sera cherchable ensuite.
        </p>
      )}
      {data && (
        <Facets
          items={data.results.map((x) => x.item)}
          selection={selection}
          onChange={setSelection}
        />
      )}
      {data && !results.length && (
        <p className="muted coffre-empty-line">
          Rien trouvé (noms, fiches, attributs et contenu des fichiers).
        </p>
      )}
      {!data && <p className="muted coffre-empty-line">Recherche…</p>}
      <ul className="coffre-results">
        {results.map((hit, i) => (
          <li
            key={hit.item.id}
            className={`coffre-result${hit.item.unavailable ? ' coffre-result--away' : ''}`}
            {...coffre.bindMenu(() => coffre.menuOf(hit.item), hit.item.name)}
          >
            <button
              type="button"
              className="coffre-result__head"
              onClick={() =>
                coffre.preview(items, i, {
                  page: Number(hit.hits[0]?.part) || undefined,
                  query: hit.hits.length ? q : undefined,
                })
              }
            >
              <Icon name={iconOf(hit.item)} />
              <strong>{hit.item.name}</strong>
              <span className="muted small">
                {[
                  hit.item.contextPath?.join(' › ') ?? 'Arrivée',
                  hit.partCount > 1 ? `${hit.partCount} passages` : '',
                  hit.item.diskState === 'archived' ? 'archivé' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            {hit.hits.length > 0 && (
              <ul className="coffre-result__hits">
                {hit.hits.map((h) => (
                  <li key={h.part}>
                    <button
                      type="button"
                      className="coffre-result__hit"
                      onClick={() =>
                        coffre.preview(items, i, { page: Number(h.part) || undefined, query: q })
                      }
                    >
                      {h.part && (
                        <span className="coffre-result__part">{partLabel(hit, h.part)}</span>
                      )}
                      <MarkedText className="coffre-snippet" text={h.snippet} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {data && (
        <p className="faint small coffre-results__time">
          {data.results.length} élément{data.results.length > 1 ? 's' : ''} en {data.ms} ms
        </p>
      )}
    </section>
  );
}

/**
 * v0.47.0: « /m/coffre/voir/<id>?page=3&q=mot » — a result of the hub's
 * search (Ctrl+K): the Coffre's home, the element's preview open at its page,
 * the words marked.
 */
export function ViewPage(props: { home: ComponentType }) {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const module = useModule();
  const coffre = useCoffre();
  const item = useApi<ItemDto>(id ? module.url(`/items/${id}`) : null);
  const opened = useRef<string | null>(null);
  const page = Number(params.get('page')) || undefined;
  const query = params.get('q') ?? undefined;
  useEffect(() => {
    if (!item.data || item.data.id !== id || opened.current === `${id}:${page}:${query}`) return;
    opened.current = `${id}:${page}:${query}`;
    coffre.preview([item.data], 0, { page, query });
  }, [item.data, id, page, query, coffre]);
  const Home = props.home;
  return (
    <>
      {item.error && <ErrorMessage>{item.error}</ErrorMessage>}
      <Home />
    </>
  );
}
