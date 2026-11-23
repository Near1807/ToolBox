// v0.45.0: the rangement window — opened as soon as files are dropped. The
// preview on the left, the sheet already filled on the right (what was
// guessed marked « deviné »); Entrée = Ranger; « Ranger plus tard » sends it
// to Arrivée. Several files: the list, one proposal each, « Tout valider ».
// Nothing is written before « Ranger » (and « Annuler » undoes it after).
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, formatBytes, Icon } from '@hub/sdk/frontend';
import { extOf } from '../shared/kinds';
import type { ItemDto } from '../shared/types';
import { useCoffre } from './frame';
import { fly } from './fly';
import { applyEntry, choiceLabel, chooseValues, isHeldDuplicate, type DepositEntry } from './logic';
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
    async (list: DepositEntry[], later: boolean) => {
      if (!list.length || busy) return;
      setBusy(true);
      const from = previewBox.current?.getBoundingClientRect() ?? null;
      try {
        const r = await coffre.api.post<Applied>('/deposit/apply', {
          entries: list.map((e) => applyEntry(e, later)),
        });
        const skipped = new Set(r.skipped.map((s) => s.path));
        const next = entries.map((e) =>
          list.some((l) => l.key === e.key)
            ? {
                ...e,
                state: skipped.has(e.proposal.path)
                  ? ('skipped' as const)
                  : later
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
              : `${n} éléments rangés${later ? ' dans Arrivée' : ''}.`;
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
    if (entry && entry.state === 'todo') void apply([entry], false);
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
        <div className="coffre-deposit__body">
          {many && (
            <ol className="coffre-deposit__list">
              {entries.map((e, i) => (
                <li key={e.key}>
                  <button
                    type="button"
                    className={`coffre-deposit__line${i === current ? ' coffre-deposit__line--on' : ''}`}
                    onClick={() => setCurrent(i)}
                  >
                    <span className="coffre-deposit__name">{e.name}</span>
                    <span className="coffre-deposit__where">
                      {isHeldDuplicate(e)
                        ? 'déjà dans le Coffre'
                        : choiceLabel(e.choice, coffre.contexts)}
                    </span>
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
              onChoice={(choice) => update(entry.key, { choice })}
              attributes={entry.attributes}
              onValues={(key, values) =>
                update(entry.key, { attributes: chooseValues(entry.attributes, key, values) })
              }
            >
              <label className="coffre-sheet__row">
                <span className="coffre-sheet__label">Nom</span>
                <input
                  className="input coffre-sheet__name"
                  value={entry.name}
                  onChange={(e) => update(entry.key, { name: e.target.value })}
                />
              </label>
            </Sheet>
          </div>
        </div>
        <footer className="coffre-deposit__foot">
          {entry.state !== 'todo' ? (
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
          {many && (
            <Button
              variant="secondary"
              disabled={busy || !validAll.length}
              onClick={() => void apply(validAll, false)}
              title="Chacun selon sa proposition (sans proposition : dans Arrivée)"
            >
              Tout valider ({validAll.length})
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
