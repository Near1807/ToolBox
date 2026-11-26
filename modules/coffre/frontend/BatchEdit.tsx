// v0.48.0 (Expérimental): « Modifier la sélection » — elements already stored,
// chosen with Ctrl / Maj + clic or their boxes (in a folder, a view, the
// search), changed in one go with the same « Pour tous » block: route,
// nature, origin, year, free labels, a named set, rename. Every value is « choisi »; one
// « Annuler » for the lot.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Button } from '@hub/sdk/frontend';
import { batchNames } from '../shared/batch';
import type { ItemDto } from '../shared/types';
import { BatchBlock } from './BatchBlock';
import { SetPicker } from './Labels';
import { useCoffre } from './frame';
import { batchSummary, emptyBatch, type BatchValues, type FolderChoice } from './logic';

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

/** « Pour tous » for files already stored: POST /files/batch, one « Annuler ». */
export function BatchEdit(props: { items: ItemDto[]; onClose: () => void; onDone: () => void }) {
  const coffre = useCoffre();
  const [v, setV] = useState<BatchValues>(emptyBatch);
  const [busy, setBusy] = useState(false);
  const { items } = props;
  const summary = useMemo(
    () =>
      batchSummary(
        items.map((i) => ({
          choice: (i.folderId
            ? { kind: 'existing', id: i.folderId, origin: 'chosen', reason: null }
            : null) as FolderChoice,
          labels: i.labels,
        })),
        coffre.folders,
      ),
    [items, coffre.folders],
  );
  const folderName = (i: ItemDto): string | null => {
    const r = v.route;
    if (r === undefined) return i.folderPath?.[i.folderPath.length - 1] ?? null;
    if (!r) return null;
    if (r.kind === 'new') return r.path[r.path.length - 1] ?? null;
    return coffre.folders.find((c) => c.id === r.id)?.name ?? null;
  };
  const names = useMemo(
    () =>
      v.template.trim()
        ? batchNames(
            items.map((i) => ({ key: i.id, name: i.name, folder: folderName(i) })),
            v.template,
          )
        : new Map<string, string>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- folderName reads v and the folders
    [items, v, coffre.folders],
  );
  const changes =
    v.route !== undefined ||
    v.nature !== undefined ||
    v.origin !== undefined ||
    v.year !== undefined ||
    v.freeAdd.length > 0 ||
    v.freeRemove.length > 0 ||
    (v.add?.length ?? 0) > 0 ||
    names.size > 0;

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
            ? { later: true }
            : v.route.kind === 'new'
              ? { newFolder: v.route.path }
              : { folderId: v.route.id };
      const r = await coffre.api.post<{ undoId: string }>('/files/batch', {
        ids: items.map((i) => i.id),
        ...route,
        set,
        freeAdd: v.freeAdd,
        freeRemove: v.freeRemove,
        add: v.add ?? [],
        names: Object.fromEntries(names),
      });
      coffre.notify(
        `${items.length} fichier${items.length > 1 ? 's' : ''} modifié${items.length > 1 ? 's' : ''}.`,
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
          Modifier la sélection ({items.length} fichier{items.length > 1 ? 's' : ''})
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
          pending
        />
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
  const coffre = useCoffre();
  const [editing, setEditing] = useState(false);
  const chosen = shown.filter((i) => sel.ids.has(i.id));
  // Ctrl+Maj+V pastes on the selection.
  useEffect(() => {
    if (chosen.length) coffre.setTargets(chosen);
  }, [chosen, coffre]);
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
          {/* v0.50.0: the labels copied (Ctrl+Maj+C), or a named set, pasted on the selection. */}
          <Button
            variant="secondary"
            small
            disabled={!chosen.length || !coffre.copied}
            title={coffre.copied ? 'Ctrl+Maj+V' : 'Copie d’abord les étiquettes d’un fichier'}
            onClick={() => coffre.pasteLabels(chosen)}
          >
            Coller les étiquettes…
          </Button>
          {chosen.length > 0 && <SetPicker onPick={(s) => coffre.pasteLabels(chosen, s.labels)} />}
          {props.extra}
          <Button variant="secondary" small onClick={sel.clear}>
            Terminer
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          small
          title="Ou Ctrl+clic / Maj+clic sur les fichiers"
          onClick={() => sel.setSelecting(true)}
        >
          Sélectionner…
        </Button>
      )}
      {editing && <BatchEdit items={chosen} onClose={() => setEditing(false)} onDone={sel.clear} />}
    </div>
  );
}
