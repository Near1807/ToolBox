// v0.45.0: elements as cards (grid) or as a compact list you can sort — the
// choice is remembered on this PC. A card: its preview, its name, its nature,
// its context (views by attribute), its date; on hover Ouvrir, Ouvrir dans…,
// Épingler; right click the common menu; Espace or a click on the preview:
// the large preview; double click: its application.
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  FilterPill,
  formatBytes,
  Icon,
  mergeHandlers,
  ReliefCard,
  useContextMenu,
} from '@hub/sdk/frontend';
import type { ItemDto } from '../shared/types';
import { useCoffre } from './frame';
import { extOfItem, shortDate, SORTS, sortItems, type SortKey } from './logic';
import { iconOf, ReaderView } from './ReaderView';

const natureOf = (item: ItemDto) => item.attributes.find((a) => a.key === 'nature')?.value ?? '';

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window: the choice is not kept.
  }
}

export type ViewMode = 'grid' | 'list';

/** The view (grid / list) and the sort, remembered on this PC. */
export function useView() {
  const [view, setView] = useState<ViewMode>(() => stored('coffre.view', ['grid', 'list'], 'grid'));
  const [sort, setSort] = useState<SortKey>(() =>
    stored(
      'coffre.sort',
      SORTS.map((s) => s.id),
      'recent',
    ),
  );
  return {
    view,
    sort,
    setView: (v: ViewMode) => {
      setView(v);
      store('coffre.view', v);
    },
    setSort: (s: SortKey) => {
      setSort(s);
      store('coffre.sort', s);
    },
  };
}

export function ViewBar(props: { count: number; state: ReturnType<typeof useView> }) {
  const { view, sort, setView, setSort } = props.state;
  return (
    <div className="coffre-viewbar">
      <span className="muted">
        {props.count} élément{props.count > 1 ? 's' : ''}
      </span>
      <label className="coffre-viewbar__sort">
        <span className="muted">Trier :</span>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="coffre-viewbar__modes" role="group" aria-label="Affichage">
        <FilterPill
          label={<Icon name="grid" label="Cartes" />}
          on={view === 'grid'}
          onClick={() => setView('grid')}
          title="Cartes"
        />
        <FilterPill
          label={<Icon name="list" label="Liste" />}
          on={view === 'list'}
          onClick={() => setView('list')}
          title="Liste compacte"
        />
      </div>
    </div>
  );
}

/** The disk's mark on an element: the fragile state, or « sur le disque dur ». */
export function DiskChip(props: { item: ItemDto }) {
  const { item } = props;
  if (item.diskState === 'pending')
    return (
      <span
        className="coffre-chip coffre-chip--warn"
        title="Seulement sur ce PC : il sera copié à la prochaine mise à jour du disque"
      >
        pas encore sur le disque
      </span>
    );
  if (item.diskState === 'archived')
    return (
      <span
        className="coffre-chip"
        title={
          item.unavailable
            ? 'Archivé : branche le disque pour l’ouvrir'
            : 'Archivé : sur le disque seulement'
        }
      >
        <Icon name="disc" /> sur le disque dur
      </span>
    );
  return null;
}

export function CardPreview(props: { item: ItemDto }) {
  const { item } = props;
  const source = useMemo(
    () => ({ name: item.name, ext: extOfItem(item), size: item.size, url: item.url }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id, item.url, item.size],
  );
  return <ReaderView source={source} mode="thumb" icon={iconOf(item)} />;
}

export function Items(props: {
  items: ItemDto[];
  /** Show each element's context (views by attribute, search, Arrivée). */
  showContext?: boolean;
  /** Large cards (« En cours »), never a list. */
  large?: boolean;
  view?: ViewMode;
  sort?: SortKey;
  onSort?: (sort: SortKey) => void;
  empty?: string;
  /** v0.46.0: selection mode (a click selects; « Archiver la sélection »). */
  select?: { ids: Set<string>; toggle: (id: string) => void };
}) {
  const coffre = useCoffre();
  const own = useContextMenu();
  const items = useMemo(
    () => (props.sort ? sortItems(props.items, props.sort) : props.items),
    [props.items, props.sort],
  );
  if (!items.length)
    return props.empty ? <p className="muted coffre-empty-line">{props.empty}</p> : null;

  const preview = (i: number) => coffre.preview(items, i);
  const keys = (i: number) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ') {
      e.preventDefault();
      preview(i);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      coffre.open(items[i]!);
    }
  };
  const openIn = (item: ItemDto) => (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    own.openAt(
      () => [
        { title: 'Ouvrir dans…' },
        {
          label: item.kind === 'project' ? 'L’explorateur' : 'Son application',
          icon: 'external-link',
          onSelect: () => coffre.open(item, item.kind === 'project' ? 'folder' : 'app'),
        },
        ...(item.kind === 'project' && coffre.tools.vscode
          ? [
              {
                label: 'VS Code',
                icon: 'keyboard' as const,
                onSelect: () => coffre.open(item, 'vscode'),
              },
            ]
          : []),
        {
          label: 'L’explorateur (son dossier)',
          icon: 'folder',
          onSelect: () => coffre.open(item, 'folder'),
        },
      ],
      r.left,
      r.bottom + 4,
    );
  };
  const meta = (item: ItemDto) =>
    [
      natureOf(item),
      props.showContext ? (item.contextPath?.join(' › ') ?? 'Arrivée') : null,
      shortDate(item.fileDate ?? item.createdAt),
    ]
      .filter(Boolean)
      .join(' · ');

  if (props.view === 'list' && !props.large) {
    const head = (label: string, key: SortKey) => (
      <th>
        <button
          type="button"
          className={`coffre-th${props.sort === key ? ' coffre-th--on' : ''}`}
          onClick={() => props.onSort?.(key)}
        >
          {label}
        </button>
      </th>
    );
    return (
      <>
        <table className="coffre-table">
          <thead>
            <tr>
              {head('Nom', 'name')}
              {head('Nature', 'nature')}
              {props.showContext && <th>Contexte</th>}
              {head('Date', 'date')}
              {head('Taille', 'size')}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={item.id}
                tabIndex={0}
                onDoubleClick={() => coffre.open(item)}
                {...mergeHandlers(
                  { onKeyDown: keys(i) },
                  coffre.bindMenu(() => coffre.menuOf(item), item.name),
                )}
              >
                <td className="coffre-table__name">
                  <Icon name={iconOf(item)} />
                  <button type="button" className="coffre-table__open" onClick={() => preview(i)}>
                    {item.name}
                  </button>
                  {item.pinned && <Icon name="star" label="Épinglé" />}
                  {item.kind === 'link' && <span className="coffre-chip">lien externe</span>}
                  <DiskChip item={item} />
                </td>
                <td>{natureOf(item)}</td>
                {props.showContext && <td>{item.contextPath?.join(' › ') ?? 'Arrivée'}</td>}
                <td>{shortDate(item.fileDate ?? item.createdAt)}</td>
                <td className="coffre-table__num">
                  {item.kind === 'link' ? '' : formatBytes(item.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {own.node}
      </>
    );
  }

  return (
    <>
      <div className={props.large ? 'coffre-cards coffre-cards--large' : 'coffre-cards'}>
        {items.map((item, i) => (
          <ReliefCard
            key={item.id}
            large={props.large}
            label={item.name}
            preview={<CardPreview item={item} />}
            title={item.name}
            meta={meta(item)}
            muted={item.diskState === 'archived'}
            badges={
              item.kind === 'link' ||
              item.pinned ||
              item.diskState === 'pending' ||
              item.diskState === 'archived' ? (
                <>
                  {item.pinned && (
                    <span className="coffre-chip coffre-chip--accent">
                      <Icon name="star" /> en cours
                    </span>
                  )}
                  {item.kind === 'link' && (
                    <span className="coffre-chip">lien externe, non sauvegardé</span>
                  )}
                  <DiskChip item={item} />
                </>
              ) : undefined
            }
            actions={
              <>
                <button
                  type="button"
                  className="icon-button coffre-card-action"
                  title="Ouvrir"
                  aria-label="Ouvrir"
                  onClick={() => coffre.open(item)}
                >
                  <Icon name="external-link" />
                </button>
                {item.kind === 'file' && (
                  <button
                    type="button"
                    className="icon-button coffre-card-action"
                    title="Lire en plein écran (fenêtre à part)"
                    aria-label="Lire en plein écran"
                    onClick={() => coffre.readWindow(item)}
                  >
                    <Icon name="eye" />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button coffre-card-action"
                  title="Ouvrir dans…"
                  aria-label="Ouvrir dans…"
                  onClick={openIn(item)}
                >
                  <Icon name="ellipsis" />
                </button>
                {item.diskState === 'active' && coffre.disk?.connected && (
                  <button
                    type="button"
                    className="icon-button coffre-card-action"
                    title={`Archiver (libère ${formatBytes(item.size)} sur le PC)`}
                    aria-label="Archiver"
                    onClick={() => coffre.archive([item])}
                  >
                    <Icon name="disc" />
                  </button>
                )}
                <button
                  type="button"
                  className={`icon-button coffre-card-action${item.pinned ? ' coffre-card-action--on' : ''}`}
                  title={item.pinned ? 'Retirer de « En cours »' : 'Épingler dans « En cours »'}
                  aria-label={item.pinned ? 'Désépingler' : 'Épingler'}
                  aria-pressed={item.pinned}
                  onClick={() => coffre.pin(item)}
                >
                  <Icon name="star" />
                </button>
              </>
            }
            selected={props.select?.ids.has(item.id)}
            onOpen={() => (props.select ? props.select.toggle(item.id) : coffre.open(item))}
            onPreview={() => (props.select ? props.select.toggle(item.id) : preview(i))}
            bind={mergeHandlers(
              { onKeyDown: keys(i) },
              coffre.bindMenu(() => coffre.menuOf(item), item.name),
            )}
          />
        ))}
      </div>
      {own.node}
    </>
  );
}
