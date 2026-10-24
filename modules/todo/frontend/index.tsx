// Page and home widget of the To-do module.
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Card,
  confirmDelete,
  defineFrontendModule,
  EmptyState,
  ErrorMessage,
  errorMessage,
  Page,
  StateBadge,
  UndoToast,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import {
  daysBetween,
  formatDue,
  localToday,
  parseDue,
  shortDate,
  slashDate,
  splitQuickAdd,
} from '../dates';
import { cleanTags, type TaskDto, type TasksResponse } from '../shared';
import './todo.css';

const LIBRARY_TRACK = (id: number) => `/m/music-library/tracks/${id}`;

interface Undo {
  message: string;
  run: () => Promise<unknown>;
}

function DueBadge(props: { task: TaskDto; today: string }) {
  const { task, today } = props;
  if (!task.due) return null;
  const label = formatDue(task.due, today);
  if (task.done) return <span className="small muted">{label}</span>;
  const late = daysBetween(task.due, today);
  if (late > 0) {
    return (
      <StateBadge tone="danger" title={shortDate(task.due, today)}>
        En retard · {label}
      </StateBadge>
    );
  }
  if (late === 0) return <StateBadge tone="warning">Aujourd’hui</StateBadge>;
  return (
    <StateBadge tone={late >= -2 ? 'accent' : 'neutral'} title={shortDate(task.due, today)}>
      {label}
    </StateBadge>
  );
}

/** « finir le mix #mix vendredi » + Entrée. */
function QuickAdd(props: { data: TasksResponse; onAdded: (task: TaskDto) => void }) {
  const module = useModule();
  const [text, setText] = useState('');
  const [ignoreDate, setIgnoreDate] = useState(false);
  const [trackId, setTrackId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const today = props.data.today;
  const parsed = useMemo(() => {
    const split = splitQuickAdd(text, today);
    return ignoreDate
      ? {
          ...split,
          title: split.dueText ? `${split.title} ${split.dueText}` : split.title,
          due: null,
        }
      : split;
  }, [text, today, ignoreDate]);

  const submit = async () => {
    if (!parsed.title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = await module.api.post<TaskDto>('/tasks', {
        title: parsed.title,
        tags: parsed.tags,
        due: parsed.due,
        trackId: trackId ? Number(trackId) : null,
      });
      setText('');
      setIgnoreDate(false);
      props.onAdded(task);
      input.current?.focus();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addTag = (tag: string) => {
    setText((t) => `${t.trimEnd()} #${tag} `.trimStart());
    input.current?.focus();
  };

  return (
    <Card title="Nouvelle tâche">
      <form
        className="td-add"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={input}
          className="input td-add__input"
          value={text}
          autoFocus
          placeholder="finir le mix #mix vendredi — puis Entrée"
          aria-label="Nouvelle tâche"
          onChange={(e) => {
            setText(e.target.value);
            setIgnoreDate(false);
          }}
        />
        {props.data.library && props.data.tracks.length > 0 && (
          <select
            className="input input--short"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            aria-label="Morceau"
          >
            <option value="">Aucun morceau</option>
            {props.data.tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" disabled={!parsed.title.trim() || busy}>
          Ajouter
        </Button>
      </form>
      {text.trim() && (
        <div className="td-preview small">
          <span className="muted">Sera ajouté :</span> <strong>{parsed.title || '…'}</strong>
          {parsed.tags.map((t) => (
            <span key={t} className="td-tag">
              #{t}
            </span>
          ))}
          {parsed.due && (
            <span className="td-preview__due">
              <StateBadge tone="accent">{formatDue(parsed.due, today)}</StateBadge>
              <button type="button" className="td-link" onClick={() => setIgnoreDate(true)}>
                ce n’est pas une date
              </button>
            </span>
          )}
        </div>
      )}
      {props.data.tags.length > 0 && (
        <div className="td-suggest small">
          <span className="muted">Tags :</span>
          {props.data.tags.slice(0, 12).map((t) => (
            <button
              key={t.name}
              type="button"
              className="td-tag td-tag--button"
              onClick={() => addTag(t.name)}
            >
              #{t.name}
            </button>
          ))}
        </div>
      )}
      <p className="small muted td-help">
        Écris « #tag » pour un tag et termine par l’échéance si besoin : « demain », « vendredi », «
        dans 3 jours », « le 12 novembre ».
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Card>
  );
}

/** Time spent on a task: « 45 min », « 2 h 05 ». */
function spentText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}

function TaskRow(props: {
  task: TaskDto;
  data: TasksResponse;
  onChange: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
  onTag: (tag: string) => void;
}) {
  const { task, data } = props;
  const [editing, setEditing] = useState<null | 'title' | 'details'>(null);
  const [title, setTitle] = useState(task.title);
  const [tags, setTags] = useState(task.tags.join(', '));
  const [due, setDue] = useState(task.due ? slashDate(task.due) : '');
  const [trackId, setTrackId] = useState(task.track ? String(task.track.id) : '');
  const [error, setError] = useState<string | null>(null);
  const dueValue = due.trim() ? parseDue(due, data.today) : null;
  const late = task.due && !task.done && task.due < data.today;

  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try {
      await props.onChange(patch);
      setEditing(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const startDetails = () => {
    setTags(task.tags.join(', '));
    setDue(task.due ? slashDate(task.due) : '');
    setTrackId(task.track ? String(task.track.id) : '');
    setEditing('details');
  };

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void save({ title });
    if (e.key === 'Escape') {
      setTitle(task.title);
      setEditing(null);
    }
  };

  return (
    <li className={`td-task${task.done ? ' td-task--done' : ''}${late ? ' td-task--late' : ''}`}>
      <input
        type="checkbox"
        className="td-task__check"
        checked={task.done}
        aria-label={task.done ? 'Marquer à faire' : 'Marquer comme faite'}
        onChange={(e) => void props.onChange({ done: e.target.checked })}
      />
      <div className="td-task__main">
        {editing === 'title' ? (
          <input
            className="input td-task__title-input"
            value={title}
            autoFocus
            aria-label="Titre"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onTitleKey}
            onBlur={() =>
              title.trim() && title !== task.title ? void save({ title }) : setEditing(null)
            }
          />
        ) : (
          <button
            type="button"
            className="td-task__title"
            title="Cliquer pour modifier"
            onClick={() => {
              setTitle(task.title);
              setEditing('title');
            }}
          >
            {task.title}
          </button>
        )}
        <div className="td-task__meta small">
          <DueBadge task={task} today={data.today} />
          {task.tags.map((t) => (
            <button
              key={t}
              type="button"
              className="td-tag td-tag--button"
              onClick={() => props.onTag(t)}
            >
              #{t}
            </button>
          ))}
          {task.track && (
            <Link className="td-track" to={LIBRARY_TRACK(task.track.id)}>
              ♪ {task.track.title}
            </Link>
          )}
          {task.timeSpent > 0 && (
            <span className="td-time" title="Temps de travail enregistré par le Timer">
              ⏱ {spentText(task.timeSpent)}
            </span>
          )}
          <span className="faint">
            créée le {shortDate(task.createdAt.slice(0, 10), data.today)}
          </span>
        </div>
        {editing === 'details' && (
          <form
            className="td-details"
            onSubmit={(e) => {
              e.preventDefault();
              if (due.trim() && !dueValue) return setError(`Échéance pas comprise : « ${due} »`);
              void save({
                tags: cleanTags(tags.split(',')),
                due: dueValue,
                trackId: trackId ? Number(trackId) : null,
              });
            }}
          >
            <label className="small">
              Tags
              <input
                className="input"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="mix, studio"
              />
            </label>
            <label className="small">
              Échéance
              <input
                className="input"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                placeholder="vendredi, le 12/11…"
              />
              <span className={dueValue || !due.trim() ? 'muted' : 'error'}>
                {due.trim()
                  ? dueValue
                    ? `→ ${shortDate(dueValue, data.today)}`
                    : 'pas comprise'
                  : 'aucune'}
              </span>
            </label>
            {data.library && (
              <label className="small">
                Morceau
                <select
                  className="input"
                  value={trackId}
                  onChange={(e) => setTrackId(e.target.value)}
                >
                  <option value="">Aucun</option>
                  {data.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="td-details__actions">
              <Button type="submit" small>
                Enregistrer
              </Button>
              <Button variant="secondary" small onClick={() => setEditing(null)}>
                Annuler
              </Button>
            </div>
          </form>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
      <div className="td-task__actions">
        {data.timer && !task.done && (
          <Link
            className="icon-button"
            title="Lancer un timer sur cette tâche"
            aria-label="Lancer un timer"
            to={`/m/timer?task=${task.id}`}
          >
            ⏱
          </Link>
        )}
        <button
          type="button"
          className="icon-button"
          title="Tags, échéance, morceau"
          aria-label="Modifier"
          onClick={startDetails}
        >
          ✎
        </button>
        <button
          type="button"
          className="icon-button"
          title="Supprimer"
          aria-label="Supprimer"
          onClick={props.onDelete}
        >
          🗑
        </button>
      </div>
    </li>
  );
}

function TodoPage() {
  const module = useModule();
  const { data, error, reload } = useApi<TasksResponse>(module.url('/tasks'));
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [tag, setTag] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const dismiss = useCallback(() => setUndo(null), []);

  if (error)
    return (
      <Page title="To-do">
        <ErrorMessage>{error}</ErrorMessage>
      </Page>
    );
  if (!data)
    return (
      <Page title="To-do">
        <p className="muted">Chargement…</p>
      </Page>
    );

  const open = data.tasks.filter((t) => !t.done);
  const done = data.tasks.filter((t) => t.done);
  const shown = (tab === 'open' ? open : done).filter((t) => !tag || t.tags.includes(tag));
  const late = open.filter((t) => t.due && t.due < data.today).length;
  const dueToday = open.filter((t) => t.due === data.today).length;

  const act = async (run: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await run();
    } catch (e) {
      setActionError(errorMessage(e));
    }
    reload();
  };

  return (
    <Page
      title="To-do"
      subtitle={
        <>
          {open.length} à faire
          {dueToday > 0 && <> · {dueToday} aujourd’hui</>}
          {late > 0 && <span className="td-late-count"> · {late} en retard</span>}
        </>
      }
    >
      <QuickAdd
        data={data}
        onAdded={(task) => {
          reload();
          setUndo({
            message: `« ${task.title} » ajoutée.`,
            run: () => module.api.delete(`/tasks/${task.id}`),
          });
        }}
      />
      <Card
        title={
          <div className="td-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'open'}
              className={tab === 'open' ? 'td-tab td-tab--active' : 'td-tab'}
              onClick={() => setTab('open')}
            >
              À faire <span className="num">{open.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'done'}
              className={tab === 'done' ? 'td-tab td-tab--active' : 'td-tab'}
              onClick={() => setTab('done')}
            >
              Faites <span className="num">{done.length}</span>
            </button>
          </div>
        }
        actions={
          data.tags.length > 0 && (
            <select
              className="input input--short"
              value={tag ?? ''}
              onChange={(e) => setTag(e.target.value || null)}
              aria-label="Filtrer par tag"
            >
              <option value="">Tous les tags</option>
              {data.tags.map((t) => (
                <option key={t.name} value={t.name}>
                  #{t.name} ({t.count})
                </option>
              ))}
            </select>
          )
        }
      >
        {tag && (
          <p className="small">
            Filtre : <span className="td-tag">#{tag}</span>{' '}
            <button type="button" className="td-link" onClick={() => setTag(null)}>
              retirer
            </button>
          </p>
        )}
        {actionError && <ErrorMessage>{actionError}</ErrorMessage>}
        {shown.length === 0 ? (
          <EmptyState title={tab === 'open' ? 'Rien à faire' : 'Aucune tâche faite'}>
            {tab === 'open' &&
              !tag &&
              'Ajoute une tâche ci-dessus, ou demande à l’assistant : « ajoute finir le mix pour vendredi ».'}
          </EmptyState>
        ) : (
          <ul className="td-list">
            {shown.map((task) => (
              <TaskRow
                key={`${task.id}-${task.title}-${task.due}-${task.done}-${task.tags.join()}-${task.track?.id}`}
                task={task}
                data={data}
                onTag={(t) => setTag(t)}
                onChange={async (patch) => {
                  await module.api.patch(`/tasks/${task.id}`, patch);
                  reload();
                }}
                onDelete={() => {
                  if (!confirmDelete(`la tâche « ${task.title} »`)) return;
                  void act(async () => {
                    await module.api.delete(`/tasks/${task.id}`);
                    setUndo({
                      message: `« ${task.title} » supprimée.`,
                      run: () => module.api.post(`/tasks/${task.id}/restore`),
                    });
                  });
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      {undo && (
        <UndoToast message={undo.message} onUndo={() => void act(undo.run)} onDismiss={dismiss} />
      )}
    </Page>
  );
}

/** Home card: « à faire aujourd'hui » (late ones included). */
function HomeWidget() {
  const module = useModule();
  const { data } = useApi<{ today: string; open: number; due: TaskDto[] }>(module.url('/today'));
  if (!data) return null;
  const today = data.today ?? localToday();
  if (data.due.length === 0) {
    return <p className="small muted">Rien pour aujourd’hui · {data.open} à faire en tout</p>;
  }
  return (
    <div className="small">
      <p>
        <strong className="num">{data.due.length}</strong> à faire aujourd’hui
      </p>
      <ul className="td-widget">
        {data.due.slice(0, 4).map((t) => (
          <li key={t.id} className={t.due && t.due < today ? 'td-widget--late' : undefined}>
            {t.title}
            {t.due && t.due < today && <span> · en retard</span>}
          </li>
        ))}
        {data.due.length > 4 && <li className="muted">… et {data.due.length - 4} autre(s)</li>}
      </ul>
    </div>
  );
}

export default defineFrontendModule({
  pages: [{ path: '', component: TodoPage }],
  HomeWidget,
});
