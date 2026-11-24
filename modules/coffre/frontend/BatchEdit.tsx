// v0.48.0 (Expérimental): « Modifier la sélection » — elements already stored,
// chosen with Ctrl / Maj + clic or their boxes (in a context, a view, the
// search), changed in one go with the same « Pour tous » block: route,
// nature, origin, year, tags, rename. Every value is « choisi »; one
// « Annuler » for the lot.
import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Button } from '@hub/sdk/frontend';
import { batchNames } from '../shared/batch';
import type { ItemDto } from '../shared/types';
import { BatchBlock } from './BatchBlock';
import { useCoffre } from './frame';
import { batchSummary, emptyBatch, type BatchValues, type ContextChoice } from './logic';

/** The selection of a list: boxes, Ctrl+clic (one), Maj+clic (a range in the order shown). */
export function useSelection() {
  const [selecting, setSelecting] = useState(false);
  const [ids, setIds] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setSelecting(true);
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  /** A click with Ctrl or Maj (true: handled, the element is not opened). */
  const modClick = useCallback(
    (e: MouseEvent, id: string, order: readonly string[]): boolean => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return false;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
        const a = order.indexOf(anchor.current);
        const b = order.indexOf(id);
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelecting(true);
        setIds((prev) => new Set([...prev, ...range]));
      } else toggle(id);
      return true;
    },
    [toggle],
  );
  const clear = useCallback(() => {
    setIds(new Set());
    setSelecting(false);
    anchor.current = null;
  }, []);
  return { selecting, setSelecting, ids, setIds, toggle, modClick, clear };
}

/** « Pour tous » for elements already stored: POST /items/batch, one « Annuler ». */
export function BatchEdit(props: { items: ItemDto[]; onClose: () => void; onDone: () => void }) {
  const coffre = useCoffre();
  const [v, setV] = useState<BatchValues>(emptyBatch);
  const [busy, setBusy] = useState(false);
  const { items } = props;
  // v0.48.0: elements « à compléter » in the selection: their sheet checked with the lot.
  const someToComplete = items.some((i) => i.toComplete);
  const [complete, setComplete] = useState(someToComplete);
  const summary = useMemo(
    () =>
      batchSummary(
        items.map((i) => ({
          choice: (i.contextId
            ? { kind: 'existing', id: i.contextId, origin: 'chosen', reason: null }
            : null) as ContextChoice,
          attributes: i.attributes,
        })),
        coffre.contexts,
      ),
    [items, coffre.contexts],
  );
  const contextName = (i: ItemDto): string | null => {
    const r = v.route;
    if (r === undefined) return i.contextPath?.[i.contextPath.length - 1] ?? null;
    if (!r) return null;
    if (r.kind === 'new') return r.path[r.path.length - 1] ?? null;
    return coffre.contexts.find((c) => c.id === r.id)?.name ?? null;
  };
  const names = useMemo(
    () =>
      v.template.trim()
        ? batchNames(
            items.map((i) => ({ key: i.id, name: i.name, context: contextName(i) })),
            v.template,
          )
        : new Map<string, string>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contextName reads v and the contexts
    [items, v, coffre.contexts],
  );
  const changes =
    v.route !== undefined ||
    v.nature !== undefined ||
    v.origin !== undefined ||
    v.year !== undefined ||
    v.tagsAdd.length > 0 ||
    v.tagsRemove.length > 0 ||
    names.size > 0 ||
    (someToComplete && complete);

  const apply = async () => {
    if (!changes || busy) return;
    setBusy(true);
    try {
      const set: Record<string, string | null> = {};
      for (const k of ['nature', 'origin', 'year'] as const) if (v[k] !== undefined) set[k] = v[k];
      const route =
        v.route === undefined
          ? {}
          : v.route === null
            ? { arrival: true }
            : v.route.kind === 'new'
              ? { newContext: v.route.path }
              : { contextId: v.route.id };
      const r = await coffre.api.post<{ undoId: string }>('/items/batch', {
        ids: items.map((i) => i.id),
        ...route,
        set,
        tagsAdd: v.tagsAdd,
        tagsRemove: v.tagsRemove,
        names: Object.fromEntries(names),
        complete: someToComplete && complete,
      });
      coffre.notify(
        `${items.length} élément${items.length > 1 ? 's' : ''} modifié${items.length > 1 ? 's' : ''}.`,
        r.undoId,
      );
      coffre.refresh();
      props.onDone();
      props.onClose();
    } catch (e) {
      coffre.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="coffre-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Modifier la sélection"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          props.onClose();
        }
      }}
    >
      <div className="coffre-modal__box coffre-question coffre-batchedit">
        <h2>
          Modifier la sélection ({items.length} élément{items.length > 1 ? 's' : ''})
        </h2>
        <p className="muted small">
          Seuls les champs changés s’appliquent ; « mixte » reste tel quel. Les fichiers suivent
          leur route. Tu pourras annuler.
        </p>
        <BatchBlock
          count={items.length}
          values={v}
          summary={summary}
          onChange={setV}
          preview={items
            .slice(0, 4)
            .map((i) => ({ before: i.name, after: names.get(i.id) ?? i.name }))}
          arrival
        />
        {someToComplete && (
          <label className="small">
            <input
              type="checkbox"
              checked={complete}
              onChange={(e) => setComplete(e.target.checked)}
            />{' '}
            Marquer leurs fiches comme vérifiées (plus « à compléter »)
          </label>
        )}
        <div className="coffre-treedialog__buttons">
          <Button disabled={!changes || busy} onClick={() => void apply()} data-coffre-batch-apply>
            Appliquer à {items.length}
          </Button>
          <Button variant="secondary" onClick={props.onClose}>
            Annuler
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The bar above a list: select, all, « Modifier la sélection… », the dialog. */
export function SelectBar(props: {
  sel: ReturnType<typeof useSelection>;
  shown: readonly ItemDto[];
  /** More actions on the selection (« Archiver la sélection »). */
  extra?: React.ReactNode;
}) {
  const { sel, shown } = props;
  const [editing, setEditing] = useState(false);
  const chosen = shown.filter((i) => sel.ids.has(i.id));
  return (
    <div className="coffre-selectbar" data-coffre-selectbar>
      {sel.selecting ? (
        <>
          <span>
            {chosen.length} sélectionné{chosen.length > 1 ? 's' : ''}
          </span>
          <Button
            variant="secondary"
            small
            onClick={() => sel.setIds(new Set(shown.map((i) => i.id)))}
          >
            Tout
          </Button>
          <Button small disabled={!chosen.length} onClick={() => setEditing(true)}>
            Modifier la sélection…
          </Button>
          {props.extra}
          <Button variant="secondary" small onClick={sel.clear}>
            Terminer
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          small
          title="Ou Ctrl+clic / Maj+clic sur les éléments"
          onClick={() => sel.setSelecting(true)}
        >
          Sélectionner…
        </Button>
      )}
      {editing && <BatchEdit items={chosen} onClose={() => setEditing(false)} onDone={sel.clear} />}
    </div>
  );
}
