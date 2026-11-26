// v0.45.0: the rangement window — opened as soon as files are dropped. The
// preview on the left, the sheet already filled on the right (what was
// guessed marked « deviné »); Entrée = Ranger; « Ranger plus tard » sends it
// to À ranger. Several files: the list, one proposal each; v0.48.0: « Pour
// tous » (one setting for the checked ones, exceptions per file), Entrée =
// « Ranger les cochés » (the unchecked ones to À ranger), one « Annuler ».
// Nothing is written before « Ranger » (and « Annuler » undoes it after).
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { announceJobs, Button, formatBytes, Icon, waitForJob } from '@hub/sdk/frontend';
import { extOf } from '../shared/kinds';
import type { ApplyResultDto, ItemDto } from '../shared/types';
import { setAsideText, useCoffre } from './frame';
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

/** A line of the list (fixed: a long list only draws what is in view). */
const ROW_HEIGHT = 58;
const VIRTUAL_FROM = 150;

const STATE_LABEL: Record<DepositEntry['state'], string> = {
  todo: '',
  done: 'rangé',
  later: 'plus tard',
  skipped: 'laissé',
};

/** Where the flight lands: the folder's tile, the À ranger counter, or the page. */
const targetOf = (item: ItemDto | undefined) =>
  (item?.folderId && document.querySelector(`[data-coffre-folder="${item.folderId}"]`)) ||
  (item?.folderId === null && document.querySelector('[data-coffre-pending]')) ||
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
  const listBox = useRef<HTMLOListElement>(null);
  const [listTop, setListTop] = useState(0);
  const [listHeight, setListHeight] = useState(600);
  const slice = useMemo(() => {
    if (entries.length <= VIRTUAL_FROM) return { from: 0, to: entries.length, before: 0, after: 0 };
    const height = listHeight;
    const from = Math.max(0, Math.floor(listTop / ROW_HEIGHT) - 10);
    const to = Math.min(entries.length, from + Math.ceil(height / ROW_HEIGHT) + 20);
    return { from, to, before: from, after: entries.length - to };
  }, [entries.length, listTop, listHeight]);
  const { onClose } = props;

  const update = (key: string, change: Partial<DepositEntry>) =>
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...change } : e)));
  // v0.48.0: « Pour tous » (several files): the checked ones, the exceptions per file.
  const [batch, setBatch] = useState<BatchValues>(emptyBatch);
  const changeBatch = (v: BatchValues) => {
    const reset = batch.template.trim() !== '' && v.template.trim() === '';
    setBatch(v);
    setEntries((list) => applyBatch(list, v, coffre.folders, undefined, reset));
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
      return checked ? applyBatch(next, batch, coffre.folders) : next;
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
        // v0.49.0: a background task — the window goes on (or closes) at once; the
        // panel of the tasks follows it; its message and « Annuler » come at the end.
        const { jobId } = await coffre.api.post<{ jobId: string }>('/deposit/apply', {
          entries: list.map((e) => applyEntry(e, isLater(e))),
        });
        const next = entries.map((e) =>
          list.some((l) => l.key === e.key)
            ? { ...e, state: isLater(e) ? ('later' as const) : ('done' as const) }
            : e,
        );
        setEntries(next);
        const left = next.findIndex((e) => e.state === 'todo');
        if (left < 0) onClose();
        else setCurrent(left);
        announceJobs();
        void waitForJob(jobId).then((job) => {
          const r = job.result as ApplyResultDto | null;
          const errors = job.details?.errorCount ?? 0;
          if (job.status === 'failed') {
            coffre.fail(new Error(job.error ?? 'Rangement impossible'));
            return;
          }
          if (!r) return;
          const n = r.created.length;
          const where = r.created[0]?.folderPath?.join(' › ') ?? 'À ranger';
          const message =
            job.status === 'cancelled'
              ? `Rangement annulé : ${n} élément${n > 1 ? 's' : ''} déjà rangé${n > 1 ? 's' : ''} (gardé${n > 1 ? 's' : ''}).`
              : n === 0
                ? errors
                  ? 'Rien de rangé.'
                  : 'Rien de rangé (déjà dans le Coffre).'
                : n === 1
                  ? `« ${r.created[0]!.name} » rangé dans ${where}.`
                  : later
                    ? `${n} éléments mis dans À ranger.`
                    : toArrival
                      ? `${n - toArrival} éléments rangés, ${toArrival} dans À ranger.`
                      : `${n} éléments rangés.`;
          coffre.notify(
            [
              message,
              r.skipped.length ? `${r.skipped.length} doublon(s) laissé(s) de côté.` : '',
              errors
                ? `${errors} erreur${errors > 1 ? 's' : ''} : ${errors > 1 ? 'ils restent' : 'il reste'} à leur place, la raison est dans le panneau des tâches.`
                : '',
            ]
              .filter(Boolean)
              .join(' '),
            r.undoId,
          );
          coffre.refresh();
          // The flight to its tile.
          const first = r.created[0];
          requestAnimationFrame(() =>
            fly(from, targetOf(first), first?.name ?? '', coffre.tools.animations),
          );
        }, coffre.fail);
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
      const item = await coffre.api.get<ItemDto>(`/files/${id}`);
      if (entry) update(entry.key, { state: 'skipped' });
      if (!many) onClose();
      coffre.preview([item], 0);
    } catch (error) {
      coffre.fail(error);
    }
  };

  const todo = entries.filter((e) => e.state === 'todo');
  const validAll = todo.filter((e) => !isHeldDuplicate(e));
  // v0.48.0: « Ranger les cochés » — the checked ones placed, the others to À ranger (one « Annuler »).
  const lot = validAll;
  const checkedCount = lot.filter((e) => e.checked).length;
  const summary = batchSummary(
    todo.filter((e) => e.checked),
    coffre.folders,
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
  const dup = entry.proposal.duplicate;
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
          <h2>{many ? `Ranger ${entries.length} éléments` : 'Ranger dans le Coffre'}</h2>
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
              pending
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
            <ol
              className="coffre-deposit__list"
              ref={listBox}
              onScroll={(ev) => {
                setListTop(ev.currentTarget.scrollTop);
                setListHeight(ev.currentTarget.clientHeight);
              }}
            >
              {/* v0.49.0: a long list (thousands of files) only draws the lines in view. */}
              {slice.before > 0 && (
                <li aria-hidden="true" style={{ height: slice.before * ROW_HEIGHT }} />
              )}
              {entries
                .slice(slice.from, slice.to)
                .map((e, k) => ({ e, i: slice.from + k }))
                .map(({ e, i }) => (
                  <li key={e.key} className="coffre-deposit__item" style={{ height: ROW_HEIGHT }}>
                    <input
                      type="checkbox"
                      className="coffre-deposit__check"
                      aria-label={`« Pour tous » s’applique à ${e.name}`}
                      title={
                        e.checked
                          ? 'Coché : « Pour tous » s’applique'
                          : 'Décoché : ira dans À ranger'
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
                            ? choiceLabel(e.choice, coffre.folders)
                            : 'À ranger (décoché)'}
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
              {slice.after > 0 && (
                <li aria-hidden="true" style={{ height: slice.after * ROW_HEIGHT }} />
              )}
            </ol>
          )}
          <div className="coffre-deposit__preview" ref={previewBox}>
            <div className="coffre-deposit__view">
              <ReaderView
                source={source}
                mode="full"
                icon={entry.proposal.isDirectory ? 'folder' : 'file'}
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
                  {dup.folderPath ? ` (${dup.folderPath.join(' › ')})` : ' (À ranger)'}
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
            {entry.proposal.isDirectory && (
              <FolderSummary
                entry={entry}
                onProjects={(projects) => update(entry.key, { projects })}
              />
            )}
            <Sheet
              choice={entry.choice}
              folder={entry.proposal.isDirectory}
              onChoice={(choice) => own(entry, 'route', { choice })}
              labels={entry.labels}
              onValues={(key, values) =>
                own(entry, key === 'nature' || key === 'origin' || key === 'year' ? key : 'free', {
                  labels: chooseValues(entry.labels, key, values),
                })
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
                title="Tous dans À ranger, à ranger plus tard"
              >
                Tout ranger plus tard
              </Button>
              <Button
                autoFocus
                disabled={busy || !lot.length}
                onClick={() => void apply(lot, (x) => !x.checked)}
                title="Entrée — les décochés vont dans À ranger ; un seul « Annuler » pour le lot"
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
                title="Il attend dans À ranger"
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

/**
 * v0.50.0: a dropped folder arrives as it is — what it holds (files, sub-folders,
 * size, its files already in the Coffre, the recreatable folders set aside) and
 * the sub-folders that look like code projects, « Projet » proposed (a box each,
 * the reason shown; a project inside a project: only the highest counts).
 */
function FolderSummary(props: { entry: DepositEntry; onProjects: (projects: string[]) => void }) {
  const p = props.entry.proposal;
  const hints = p.projects ?? [];
  const on = new Set(props.entry.projects);
  const covered = (rel: string) =>
    [...on].some((r) => r !== rel && (r === '' || rel.startsWith(`${r}/`)));
  return (
    <div className="coffre-foldersum" data-coffre-foldersum>
      <p className="small">
        Arrive <strong>tel quel</strong> : {p.fileCount.toLocaleString('fr-FR')} fichier
        {p.fileCount > 1 ? 's' : ''}, {p.folderCount} sous-dossier{p.folderCount > 1 ? 's' : ''},{' '}
        {formatBytes(p.size)}.
        {p.innerDuplicates ? ` ${p.innerDuplicates} déjà dans le Coffre (copiés quand même).` : ''}
      </p>
      {(p.setAside?.length ?? 0) > 0 && (
        <p className="muted small">Écartés (recréables) : {setAsideText(p.setAside ?? [])}.</p>
      )}
      {hints.length > 0 && (
        <fieldset className="coffre-foldersum__projects">
          <legend className="small">Projets proposés</legend>
          {hints.map((h) => (
            <label key={h.rel || '.'} className="small" data-coffre-project-hint={h.rel}>
              <input
                type="checkbox"
                checked={on.has(h.rel)}
                disabled={covered(h.rel)}
                onChange={(e) =>
                  props.onProjects(
                    e.target.checked ? [...on, h.rel] : [...on].filter((r) => r !== h.rel),
                  )
                }
              />{' '}
              <span className="coffre-kind coffre-kind--project">Projet</span> {h.rel || p.name}{' '}
              <span className="muted">
                ({h.reason}
                {covered(h.rel) ? ' ; dans un autre projet : seul le plus haut compte' : ''})
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
