// v0.45.0: the rangement window — opened as soon as files are dropped. The
// preview on the left, the sheet already filled on the right (what was
// guessed marked « deviné »); Entrée = Ranger; « Ranger plus tard » sends it
// to Arrivée. Several files: the list, one proposal each; v0.48.0: « Pour
// tous » (one setting for the checked ones, exceptions per file), Entrée =
// « Ranger les cochés » (the unchecked ones to Arrivée), one « Annuler ».
// Nothing is written before « Ranger » (and « Annuler » undoes it after).
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, formatBytes, Icon } from '@hub/sdk/frontend';
import { extOf } from '../shared/kinds';
import type { ItemDto } from '../shared/types';
import { useCoffre } from './frame';
import { fly } from './fly';
import {
  applyBatch,
  applyEntry,
  batchSummary,
  choiceLabel,
  chooseValues,
  emptyBatch,
  isHeldDuplicate,
  markException,
  uncheck,
  type BatchValues,
  type DepositEntry,
} from './logic';
import { BatchBlock } from './BatchBlock';
import type { BatchField } from '../shared/batch';
import { ReaderView } from './ReaderView';
import { Sheet } from './Sheet';

interface Applied {
  created: ItemDto[];
  skipped: { path: string }[];
  undoId: string | null;
}

const STATE_LABEL: Record<DepositEntry['state'], string> = {
  todo: '',
  done: 'rangé',
  later: 'plus tard',
  skipped: 'laissé',
};

/** Where the flight lands: the context's tile, the Arrivée counter, or the page. */
const targetOf = (item: ItemDto | undefined) =>
  (item?.contextId && document.querySelector(`[data-coffre-context="${item.contextId}"]`)) ||
  (item?.arrival && document.querySelector('[data-coffre-arrival]')) ||
  document.querySelector('[data-coffre-page]');

export function Deposit(props: { entries: DepositEntry[]; onClose: () => void }) {
  const coffre = useCoffre();
  const [entries, setEntries] = useState(props.entries);
  // v0.47.0: more files arriving while the window is open (sent by Windows a moment
  // later): added at the end, the ones already there untouched.
  const [given, setGiven] = useState(props.entries);
  if (props.entries !== given) {
    setGiven(props.entries);
    const known = new Set(entries.map((e) => e.proposal.path));
    const added = props.entries.filter((e) => !known.has(e.proposal.path));
    if (added.length) setEntries([...entries, ...added]);
  }
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const previewBox = useRef<HTMLDivElement>(null);
  const entry = entries[current];
  const many = entries.length > 1;
  const { onClose } = props;

  const update = (key: string, change: Partial<DepositEntry>) =>
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...change } : e)));
  // v0.48.0: « Pour tous » (several files): the checked ones, the exceptions per file.
  const [batch, setBatch] = useState<BatchValues>(emptyBatch);
  const changeBatch = (v: BatchValues) => {
    const reset = batch.template.trim() !== '' && v.template.trim() === '';
    setBatch(v);
    setEntries((list) => applyBatch(list, v, coffre.contexts, undefined, reset));
  };
  /** A file's own change: an exception to « Pour tous » for that field. */
  const own = (e: DepositEntry, field: BatchField, change: Partial<DepositEntry>) =>
    update(e.key, { ...change, exceptions: many ? markException(e, field, batch) : e.exceptions });
  const setChecked = (keys: string[], checked: boolean) =>
    setEntries((list) => {
      const next = list.map((e) =>
        keys.includes(e.key) ? (checked ? { ...e, checked } : uncheck(e)) : e,
      );
      // Newly checked: « Pour tous » applies to them too.
      return checked ? applyBatch(next, batch, coffre.contexts) : next;
    });

  const source = useMemo(
    () =>
      entry
        ? {
            name: entry.proposal.name,
            ext: entry.proposal.isDirectory ? '' : extOf(entry.proposal.name),
            size: entry.proposal.size,
            url: null,
            blob: entry.file,
          }
        : null,
    [entry],
  );

  const apply = useCallback(
    async (list: DepositEntry[], laterFor: boolean | ((e: DepositEntry) => boolean)) => {
      if (!list.length || busy) return;
      const isLater = (e: DepositEntry) =>
        typeof laterFor === 'function' ? laterFor(e) : laterFor;
      const later = list.every(isLater);
      const toArrival = list.filter(isLater).length;
      setBusy(true);
      const from = previewBox.current?.getBoundingClientRect() ?? null;
      try {
        const r = await coffre.api.post<Applied>('/deposit/apply', {
          entries: list.map((e) => applyEntry(e, isLater(e))),
        });
        const skipped = new Set(r.skipped.map((s) => s.path));
        const next = entries.map((e) =>
          list.some((l) => l.key === e.key)
            ? {
                ...e,
                state: skipped.has(e.proposal.path)
                  ? ('skipped' as const)
                  : isLater(e)
                    ? ('later' as const)
                    : ('done' as const),
              }
            : e,
        );
        setEntries(next);
        const n = r.created.length;
        const where = r.created[0]?.contextPath?.join(' › ') ?? 'Arrivée';
        const message =
          n === 0
            ? 'Rien de rangé (déjà dans le Coffre).'
            : n === 1
              ? `« ${r.created[0]!.name} » rangé dans ${where}.`
              : later
                ? `${n} éléments mis dans Arrivée.`
                : toArrival
                  ? `${n - toArrival} éléments rangés, ${toArrival} dans Arrivée.`
                  : `${n} éléments rangés.`;
        coffre.notify(
          r.skipped.length
            ? `${message} ${r.skipped.length} doublon(s) laissé(s) de côté.`
            : message,
          r.undoId,
        );
        coffre.refresh();
        const left = next.findIndex((e) => e.state === 'todo');
        if (left < 0) onClose();
        else setCurrent(left);
        // After the window closed (or the next file shown): the flight to its tile.
        const first = r.created[0];
        requestAnimationFrame(() =>
          fly(from, targetOf(first), first?.name ?? '', coffre.tools.animations),
        );
      } catch (error) {
        coffre.fail(error);
      } finally {
        setBusy(false);
      }
    },
    [busy, coffre, entries, onClose],
  );

  const openExisting = async (id: string) => {
    try {
      const item = await coffre.api.get<ItemDto>(`/items/${id}`);
      if (entry) update(entry.key, { state: 'skipped' });
      if (!many) onClose();
      coffre.preview([item], 0);
    } catch (error) {
      coffre.fail(error);
    }
  };

  const todo = entries.filter((e) => e.state === 'todo');
  const validAll = todo.filter((e) => !isHeldDuplicate(e));
  // v0.48.0: « Ranger les cochés » — the checked ones placed, the others to Arrivée (one « Annuler »).
  const lot = validAll;
  const checkedCount = lot.filter((e) => e.checked).length;
  const summary = batchSummary(
    todo.filter((e) => e.checked),
    coffre.contexts,
  );
  const preview = todo
    .filter((e) => e.checked && !e.exceptions.includes('rename'))
    .slice(0, 4)
    .map((e) => ({ before: e.proposal.name, after: e.name }));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') return;
    if (target.closest('.coffre-picker')) return;
    e.preventDefault();
    if (many) {
      if (lot.length) void apply(lot, (x) => !x.checked);
    } else if (entry && entry.state === 'todo') void apply([entry], false);
  };

  if (!entry || !source) return null;
  const dup = entry.as !== 'link' ? entry.proposal.duplicate : null;
  return (
    <div
      className="coffre-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Ranger"
      onKeyDown={onKey}
    >
      <div className={`coffre-modal__box coffre-deposit${many ? ' coffre-deposit--many' : ''}`}>
        <header className="coffre-deposit__head">
          <h2>
            {many
              ? `Ranger ${entries.length} éléments`
              : entry.as === 'link'
                ? 'Ajouter un lien externe'
                : 'Ranger dans le Coffre'}
          </h2>
          <span className="muted">L’original ne bouge pas : le Coffre en garde une copie.</span>
          <button type="button" className="icon-button" aria-label="Fermer" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {many && (
          <div className="coffre-deposit__batch">
            <BatchBlock
              count={todo.filter((e) => e.checked).length}
              values={batch}
              summary={summary}
              onChange={changeBatch}
              preview={preview}
              arrival
            />
            <div className="coffre-deposit__checkall">
              <button
                type="button"
                className="coffre-linklike"
                onClick={() =>
                  setChecked(
                    todo.map((e) => e.key),
                    !todo.every((e) => e.checked),
                  )
                }
              >
                {todo.every((e) => e.checked) ? 'Tout décocher' : 'Tout cocher'}
              </button>
            </div>
          </div>
        )}
        <div className="coffre-deposit__body">
          {many && (
            <ol className="coffre-deposit__list">
              {entries.map((e, i) => (
                <li key={e.key} className="coffre-deposit__item">
                  <input
                    type="checkbox"
                    className="coffre-deposit__check"
                    aria-label={`« Pour tous » s’applique à ${e.name}`}
                    title={
                      e.checked ? 'Coché : « Pour tous » s’applique' : 'Décoché : ira dans Arrivée'
                    }
                    checked={e.checked}
                    disabled={e.state !== 'todo'}
                    onChange={(ev) => setChecked([e.key], ev.target.checked)}
                  />
                  <button
                    type="button"
                    className={`coffre-deposit__line${i === current ? ' coffre-deposit__line--on' : ''}`}
                    onClick={() => setCurrent(i)}
                  >
                    <span className="coffre-deposit__name">{e.name}</span>
                    <span className="coffre-deposit__where">
                      {isHeldDuplicate(e)
                        ? 'déjà dans le Coffre'
                        : e.checked || e.state !== 'todo'
                          ? choiceLabel(e.choice, coffre.contexts)
                          : 'Arrivée (décoché)'}
                    </span>
                    {e.exceptions.length > 0 && e.state === 'todo' && (
                      <span
                        className="coffre-deposit__exception"
                        title={`Changé pour ce fichier seulement : ${e.exceptions.join(', ')}`}
                      >
                        exception
                      </span>
                    )}
                    {e.state !== 'todo' && (
                      <span className={`coffre-state coffre-state--${e.state}`}>
                        {STATE_LABEL[e.state]}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="coffre-deposit__preview" ref={previewBox}>
            <div className="coffre-deposit__view">
              <ReaderView
                source={source}
                mode="full"
                icon={
                  entry.proposal.isDirectory
                    ? 'folder'
                    : entry.as === 'link'
                      ? 'external-link'
                      : 'file'
                }
                fallback={
                  <p className="muted">
                    {entry.proposal.isDirectory
                      ? `Dossier : ${entry.proposal.fileCount} fichier(s), ${formatBytes(entry.proposal.size)}`
                      : formatBytes(entry.proposal.size)}
                  </p>
                }
              />
            </div>
            <p className="coffre-deposit__path" title={entry.proposal.path}>
              {entry.proposal.path}
            </p>
          </div>
          <div className="coffre-deposit__sheet">
            {dup && (
              <div className="coffre-duplicate" role="alert">
                <p>
                  <strong>Déjà dans le Coffre :</strong> « {dup.name} »
                  {dup.contextPath ? ` (${dup.contextPath.join(' › ')})` : ' (Arrivée)'}
                </p>
                <div className="coffre-duplicate__actions">
                  <Button variant="secondary" small onClick={() => void openExisting(dup.id)}>
                    Ouvrir l’existant
                  </Button>
                  <Button
                    variant={entry.keepDuplicate ? 'primary' : 'secondary'}
                    small
                    aria-pressed={entry.keepDuplicate}
                    onClick={() => update(entry.key, { keepDuplicate: !entry.keepDuplicate })}
                  >
                    {entry.keepDuplicate ? 'Gardé quand même' : 'Garder quand même'}
                  </Button>
                </div>
              </div>
            )}
            <Sheet
              link={entry.as === 'link'}
              choice={entry.choice}
              onChoice={(choice) => own(entry, 'route', { choice })}
              attributes={entry.attributes}
              onValues={(key, values) =>
                own(
                  entry,
                  key === 'tag'
                    ? 'tags'
                    : key === 'nature' || key === 'origin' || key === 'year'
                      ? key
                      : 'tags',
                  { attributes: chooseValues(entry.attributes, key, values) },
                )
              }
            >
              <label className="coffre-sheet__row">
                <span className="coffre-sheet__label">Nom</span>
                <input
                  className="input coffre-sheet__name"
                  value={entry.name}
                  onChange={(e) => own(entry, 'rename', { name: e.target.value })}
                />
              </label>
            </Sheet>
          </div>
        </div>
        <footer className="coffre-deposit__foot">
          {many ? (
            <>
              <Button
                variant="secondary"
                disabled={busy || !lot.length}
                onClick={() => void apply(lot, true)}
                title="Tous dans Arrivée, à ranger plus tard"
              >
                Tout ranger plus tard
              </Button>
              <Button
                autoFocus
                disabled={busy || !lot.length}
                onClick={() => void apply(lot, (x) => !x.checked)}
                title="Entrée — les décochés vont dans Arrivée ; un seul « Annuler » pour le lot"
                data-coffre-range-lot
              >
                Ranger les cochés ({checkedCount})
                {lot.length > checkedCount ? ` · ${lot.length - checkedCount} plus tard` : ''}
              </Button>
            </>
          ) : entry.state !== 'todo' ? (
            <span className="muted">Celui-ci est fait ({STATE_LABEL[entry.state]}).</span>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void apply([entry], true)}
                title="Il attend dans Arrivée"
              >
                Ranger plus tard
              </Button>
              <Button
                autoFocus
                disabled={busy || (dup !== null && !entry.keepDuplicate)}
                onClick={() => void apply([entry], false)}
                title={
                  dup && !entry.keepDuplicate
                    ? 'Déjà dans le Coffre : « Garder quand même » d’abord'
                    : 'Entrée'
                }
              >
                Ranger
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
