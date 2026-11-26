// v0.48.0 (Expérimental): the map of the contexts — the whole tree at once,
// each context a node tied to its parent (radial and computed: it never
// moves by itself), sized by its elements (descendants included), in its
// colour, marked when it holds something new or « pas encore sur le disque ».
// Zoom and move with the mouse, the wheel or the keyboard (arrows, + −, 0 =
// tout voir). A click opens the context; hover gives its route and count;
// the search lights the node and its path (Entrée goes there). Dragging a
// node onto another one moves it (always asked first, then « Annuler »).
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Icon, type MenuItem, type useContextMenu } from '@hub/sdk/frontend';
import { routeLabel, suggestRoutes } from '../shared/route';
import type { ContextDto } from '../shared/types';
import { fitView, layoutMap, nodeAt, pathIds, type MapLayout, type MapNode } from './map-layout';

interface View {
  k: number;
  x: number;
  y: number;
}

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 4;
const clampK = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
/** Below this zoom, only the first two levels (and the lit ones) carry their name. */
const DETAIL_ZOOM = 0.75;
/** The centre (the Coffre itself): dropping there puts a context at the root. */
const ROOT_ID = '__root__';

export interface ContextMapProps {
  contexts: readonly ContextDto[];
  pending: Readonly<Record<string, number>>;
  height: number;
  onOpen: (id: string) => void;
  /** A node dropped on another one (null: on the centre, the root). */
  onMove: (srcId: string, dstId: string | null) => void;
  menuOf: (c: ContextDto) => MenuItem[];
  bindMenu: ReturnType<typeof useContextMenu>['bind'];
  onRename?: (c: ContextDto) => void;
  onRemove?: (c: ContextDto) => void;
  /** The context shown on the page (lit). */
  current?: string | null;
}

export function ContextMap(props: ContextMapProps) {
  const { contexts, onOpen, onMove } = props;
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const layout = useMemo(
    () =>
      layoutMap(
        contexts.map((c) => ({
          id: c.id,
          parentId: c.parentId,
          name: c.name,
          sort: c.sort,
          count: c.count,
        })),
      ),
    [contexts],
  );
  const byId = useMemo(() => new Map(contexts.map((c) => [c.id, c])), [contexts]);
  const [view, setView] = useState<View>(() => fitView(layout.box, 800, props.height));
  const fitted = useRef(false);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    target: string | null;
  } | null>(null);

  const { current, height } = props;
  const boxRef = useRef(layout.box);
  useEffect(() => {
    boxRef.current = layout.box;
  }, [layout.box]);
  // The width of the frame (the map fills it); « tout voir » at the first
  // display (then the view stays where Thomas put it).
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth || 800;
      setWidth(w);
      if (!fitted.current) {
        fitted.current = true;
        setView(fitView(boxRef.current, w, height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);
  const fit = useCallback(
    () => setView(fitView(layout.box, width, height)),
    [layout.box, width, height],
  );

  // The search: the best route, its node and path lit (and centred).
  const found = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return suggestRoutes(q, contexts, 1)[0]?.id ?? null;
  }, [query, contexts]);
  const lit = useMemo(() => {
    const id = found ?? current ?? null;
    return id ? pathIds(layout, id) : new Set<string>();
  }, [found, current, layout]);
  const centreOn = (id: string | null) => {
    const n = id ? layout.byId.get(id) : null;
    if (!n) return;
    setView((v) => {
      const k = Math.max(v.k, 0.9);
      return { k, x: width / 2 - n.x * k, y: height / 2 - n.y * k };
    });
  };
  const search = (q: string) => {
    setQuery(q);
    if (q.trim()) centreOn(suggestRoutes(q.trim(), contexts, 1)[0]?.id ?? null);
  };

  // The wheel zooms around the pointer (not passive: the page does not scroll).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const k = clampK(v.k * Math.exp(-e.deltaY * 0.0015));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const zoomBy = (f: number) =>
    setView((v) => {
      const k = clampK(v.k * f);
      const cx = width / 2;
      const cy = props.height / 2;
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });

  /** The map's coordinates of a point of the screen. */
  const toMap = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  };

  // Moving the map (background) or a node (drag = move into another one).
  const gesture = useRef<
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'node'; id: string; sx: number; sy: number; moved: boolean }
    | null
  >(null);
  const multiRoot = (layout.nodes.filter((n) => n.depth === 1).length ?? 0) > 1;

  const targetAt = (x: number, y: number, src: string): string | null => {
    const n = nodeAt(layout, x, y, 10);
    if (n && n.id !== src) return n.id;
    if (multiRoot && Math.hypot(x, y) < 26) return ROOT_ID;
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const nodeEl = (e.target as Element).closest('[data-map-node]');
    const id = nodeEl?.getAttribute('data-map-node');
    svg.current?.setPointerCapture(e.pointerId);
    gesture.current = id
      ? { kind: 'node', id, sx: e.clientX, sy: e.clientY, moved: false }
      : { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pan') {
      setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 6) return;
    g.moved = true;
    const p = toMap(e.clientX, e.clientY);
    setDrag({ id: g.id, x: p.x, y: p.y, target: targetAt(p.x, p.y, g.id) });
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    svg.current?.releasePointerCapture?.(e.pointerId);
    if (!g || g.kind !== 'node') return;
    if (!g.moved) {
      onOpen(g.id);
      return;
    }
    const p = toMap(e.clientX, e.clientY);
    const target = targetAt(p.x, p.y, g.id);
    setDrag(null);
    if (target) onMove(g.id, target === ROOT_ID ? null : target);
  };

  const detail = view.k >= DETAIL_ZOOM;
  const hovered = hover ? byId.get(hover) : null;
  const hoveredNode = hover ? layout.byId.get(hover) : null;

  return (
    <div className="coffre-map" ref={frame} data-coffre-map>
      <div className="coffre-map__bar">
        <label className="coffre-map__search">
          <Icon name="search" />
          <input
            className="input"
            type="search"
            placeholder="Trouver sur la carte (cours/thermo)…"
            aria-label="Trouver un contexte sur la carte"
            value={query}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && found) {
                e.preventDefault();
                onOpen(found);
              }
            }}
          />
        </label>
        {query.trim() && (
          <span className="coffre-map__found muted small" role="status">
            {found ? routeLabel(byId.get(found)?.path ?? []) : 'Aucun contexte'}
          </span>
        )}
        <span className="coffre-map__tools">
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom avant"
            title="Zoom avant (+)"
            onClick={() => zoomBy(1.3)}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom arrière"
            title="Zoom arrière (−)"
            onClick={() => zoomBy(1 / 1.3)}
          >
            <span aria-hidden="true" className="coffre-map__minus" />
          </button>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={fit}
            title="Tout voir (0)"
          >
            Tout voir
          </button>
        </span>
      </div>
      <svg
        ref={svg}
        className={`coffre-map__svg${drag ? ' is-dragging' : ''}`}
        width="100%"
        height={props.height}
        role="group"
        aria-label="Carte des contextes : flèches pour se déplacer, + et − pour zoomer, 0 pour tout voir"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(null);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const step = 60;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [step, 0],
            ArrowRight: [-step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          const m = moves[e.key];
          if (m) {
            e.preventDefault();
            setView((v) => ({ ...v, x: v.x + m[0], y: v.y + m[1] }));
          } else if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            zoomBy(1.3);
          } else if (e.key === '-') {
            e.preventDefault();
            zoomBy(1 / 1.3);
          } else if (e.key === '0') {
            e.preventDefault();
            fit();
          }
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <Nodes
            layout={layout}
            byId={byId}
            pending={props.pending}
            lit={lit}
            detail={detail}
            multiRoot={multiRoot}
            dragTarget={drag?.target ?? null}
            dragging={drag?.id ?? null}
            onHover={setHover}
            onOpen={onOpen}
            menuOf={props.menuOf}
            bindMenu={props.bindMenu}
            onRename={props.onRename}
            onRemove={props.onRemove}
          />
          {drag && (
            <circle
              className="coffre-map__ghost"
              cx={drag.x}
              cy={drag.y}
              r={layout.byId.get(drag.id)?.r ?? 10}
            />
          )}
        </g>
      </svg>
      <p className="coffre-map__info small" aria-live="polite">
        {drag
          ? drag.target
            ? `Lâcher pour déplacer « ${byId.get(drag.id)?.name ?? ''} » dans « ${drag.target === ROOT_ID ? 'la racine' : (byId.get(drag.target)?.name ?? '')} »`
            : 'Lâche sur un autre contexte pour l’y déplacer (au centre : à la racine)'
          : hovered && hoveredNode
            ? `${routeLabel(hovered.path)} · ${hoveredNode.total} élément${hoveredNode.total > 1 ? 's' : ''}${hoveredNode.total !== hovered.count ? ` (dont ${hovered.count} directement)` : ''}${props.pending[hovered.id] ? ` · ${props.pending[hovered.id]} pas encore sur le disque` : ''}`
            : `${contexts.length} contexte${contexts.length > 1 ? 's' : ''} · clic : ouvrir · glisser un nœud sur un autre : déplacer · molette : zoom`}
      </p>
    </div>
  );
}

const Nodes = memo(function Nodes(props: {
  layout: MapLayout;
  byId: Map<string, ContextDto>;
  pending: Readonly<Record<string, number>>;
  lit: Set<string>;
  detail: boolean;
  multiRoot: boolean;
  dragTarget: string | null;
  dragging: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  menuOf: (c: ContextDto) => MenuItem[];
  bindMenu: ContextMapProps['bindMenu'];
  onRename?: (c: ContextDto) => void;
  onRemove?: (c: ContextDto) => void;
}) {
  const { layout, byId, lit } = props;
  return (
    <>
      <g className="coffre-map__edges">
        {layout.nodes.map((n) => {
          const p = n.parentId ? layout.byId.get(n.parentId) : null;
          if (!p && !props.multiRoot) return null;
          const from = p ?? { x: 0, y: 0 };
          return (
            <line
              key={n.id}
              x1={from.x}
              y1={from.y}
              x2={n.x}
              y2={n.y}
              className={lit.has(n.id) && (!p || lit.has(p.id)) ? 'is-lit' : undefined}
            />
          );
        })}
      </g>
      {props.multiRoot && (
        <g className={`coffre-map__root${props.dragTarget === ROOT_ID ? ' is-target' : ''}`}>
          <circle r={14} />
          <text y={30} textAnchor="middle">
            Coffre
          </text>
        </g>
      )}
      {layout.nodes.map((n) => (
        <Node
          key={n.id}
          n={n}
          c={byId.get(n.id)!}
          pending={props.pending[n.id] ?? 0}
          lit={lit.has(n.id)}
          showLabel={props.detail || n.depth <= 2 || lit.has(n.id)}
          target={props.dragTarget === n.id}
          dragging={props.dragging === n.id}
          onHover={props.onHover}
          onOpen={props.onOpen}
          menuOf={props.menuOf}
          bindMenu={props.bindMenu}
          onRename={props.onRename}
          onRemove={props.onRemove}
        />
      ))}
    </>
  );
});

function Node(props: {
  n: MapNode;
  c: ContextDto;
  pending: number;
  lit: boolean;
  showLabel: boolean;
  target: boolean;
  dragging: boolean;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  menuOf: (c: ContextDto) => MenuItem[];
  bindMenu: ContextMapProps['bindMenu'];
  onRename?: (c: ContextDto) => void;
  onRemove?: (c: ContextDto) => void;
}) {
  const { n, c } = props;
  if (!c) return null;
  const right = Math.cos(n.angle) >= -0.2 || n.depth === 1;
  const menu = props.bindMenu(() => props.menuOf(c), c.name);
  const label = `${routeLabel(c.path)}, ${n.total} élément${n.total > 1 ? 's' : ''}${c.fresh ? `, ${c.fresh} nouveau${c.fresh > 1 ? 'x' : ''}` : ''}${props.pending ? `, ${props.pending} pas encore sur le disque` : ''}`;
  return (
    <g
      data-map-node={c.id}
      data-coffre-context={c.id}
      className={`coffre-map__node${props.lit ? ' is-lit' : ''}${props.target ? ' is-target' : ''}${props.dragging ? ' is-dragging' : ''}`}
      transform={`translate(${n.x} ${n.y})`}
      tabIndex={0}
      role="link"
      aria-label={label}
      style={{ '--node-color': c.css } as React.CSSProperties}
      onPointerEnter={() => props.onHover(c.id)}
      onPointerLeave={() => props.onHover(null)}
      onFocus={() => props.onHover(c.id)}
      onBlur={() => props.onHover(null)}
      // The common menu's handlers are typed for HTML elements; an SVG node has the same API.
      onContextMenu={(e) => menu.onContextMenu?.(e as unknown as React.MouseEvent<HTMLElement>)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          props.onOpen(c.id);
        } else if (e.key === 'F2' && props.onRename) {
          e.preventDefault();
          props.onRename(c);
        } else if (e.key === 'Delete' && props.onRemove) {
          e.preventDefault();
          props.onRemove(c);
        } else menu.onKeyDown?.(e as unknown as React.KeyboardEvent<HTMLElement>);
      }}
    >
      <title>{label}</title>
      <circle className="coffre-map__dot" r={n.r} />
      {c.fresh > 0 && (
        <circle className="coffre-map__fresh" cx={n.r * 0.75} cy={-n.r * 0.75} r={4} />
      )}
      {props.pending > 0 && (
        <circle className="coffre-map__pending" cx={-n.r * 0.75} cy={-n.r * 0.75} r={4} />
      )}
      {props.showLabel && (
        <text
          className="coffre-map__label"
          x={right ? n.r + 6 : -n.r - 6}
          y={4}
          textAnchor={right ? 'start' : 'end'}
        >
          {c.name}
        </text>
      )}
    </g>
  );
}
