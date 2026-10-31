// Sport: the week (by default) with drag-and-drop inside it, the month, the
// weekly template, a session's details (Fait / Pas fait, mood, comment, time,
// duration, day, exercises), sessions added by hand (deletable), the
// exercise library, the summary, export. A click on a session (week, month,
// home card) shows its exercises. Home card: today's sessions.
import { useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  defineFrontendModule,
  ErrorMessage,
  errorMessage,
  Page,
  StateBadge,
  UndoToast,
  useApi,
  useModule,
  Icon,
} from '@hub/sdk/frontend';
import {
  formatLine,
  fold,
  type Exercise,
  type ExerciseLineDto,
  type ExerciseLineInput,
} from '../shared/exercises';
import {
  addDays,
  endTime,
  mondayOf,
  MOOD_LABELS,
  WEEKDAYS,
  type Session,
  type Summary,
  type TemplateItem,
  type Weekday,
} from '../shared/plan';
import type { MonthDto, WeekDto } from '../shared/types';
import './sport.css';

const dayLabel = (date: string, long = false) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(
    'fr-FR',
    long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' },
  );
const STATUS: Record<
  Session['status'],
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  planned: { label: 'prévue', tone: 'neutral' },
  done: { label: 'faite', tone: 'success' },
  missed: { label: 'pas faite', tone: 'danger' },
  cancelled: { label: 'annulée', tone: 'neutral' },
};

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

/** The exercises of a session, read only (the quick view). */
function ExerciseLines(props: { lines: ExerciseLineDto[]; empty?: string }) {
  if (!props.lines.length)
    return <p className="small muted">{props.empty ?? 'Pas d’exercice noté.'}</p>;
  return (
    <ol className="sp-exercises">
      {props.lines.map((l, i) => (
        <li key={i}>
          <strong>{l.name}</strong>
          {formatLine(l) && <span className="muted"> · {formatLine(l)}</span>}
        </li>
      ))}
    </ol>
  );
}

const LIBRARY_LIST = 'sport-exercise-library';

/** Names of the library, offered while typing (autocompletion). */
function LibraryOptions(props: { library: Exercise[] }) {
  return (
    <datalist id={LIBRARY_LIST}>
      {props.library.map((e) => (
        <option key={e.id} value={e.name} />
      ))}
    </datalist>
  );
}

/**
 * An ordered list of exercises, edited: a name from the library (or a new
 * one, added to the library when saved), sets × reps, load, rest, note.
 */
function ExerciseLinesEditor(props: {
  lines: ExerciseLineInput[];
  library: Exercise[];
  onChange: (lines: ExerciseLineInput[]) => void;
}) {
  const { lines } = props;
  const set = (i: number, patch: Partial<ExerciseLineInput>) =>
    props.onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const swap = (i: number, j: number) => {
    const next = [...lines];
    [next[i], next[j]] = [next[j]!, next[i]!];
    props.onChange(next);
  };
  return (
    <div className="sp-lines">
      {lines.map((l, i) => {
        const known = props.library.some((e) => fold(e.name) === fold(l.name ?? ''));
        return (
          <div key={i} className="sp-line">
            <span className="small muted num">{i + 1}.</span>
            <input
              className="input sp-line__name"
              list={LIBRARY_LIST}
              value={l.name ?? ''}
              placeholder="Exercice (ex. Squat)"
              aria-label={`Exercice ${i + 1}`}
              onChange={(e) => {
                const found = props.library.find((x) => fold(x.name) === fold(e.target.value));
                set(i, { name: e.target.value, exerciseId: found?.id });
              }}
            />
            <input
              className="input input--tiny num"
              type="number"
              min={1}
              max={50}
              value={l.sets ?? ''}
              placeholder="séries"
              aria-label="Séries"
              onChange={(e) => set(i, { sets: e.target.value ? Number(e.target.value) : null })}
            />
            <span className="small muted">×</span>
            <input
              className="input input--tiny"
              value={l.reps ?? ''}
              placeholder="répét."
              aria-label="Répétitions"
              onChange={(e) => set(i, { reps: e.target.value })}
            />
            <input
              className="input input--short"
              value={l.load ?? ''}
              placeholder="charge"
              aria-label="Charge"
              onChange={(e) => set(i, { load: e.target.value })}
            />
            <input
              className="input input--tiny num"
              type="number"
              min={0}
              max={3600}
              step={15}
              value={l.restSec ?? ''}
              placeholder="repos s"
              aria-label="Repos en secondes"
              onChange={(e) => set(i, { restSec: e.target.value ? Number(e.target.value) : null })}
            />
            <input
              className="input sp-line__note"
              value={l.note ?? ''}
              placeholder="note"
              aria-label="Note"
              onChange={(e) => set(i, { note: e.target.value })}
            />
            <span className="sp-line__tools">
              <button
                type="button"
                className="icon-button"
                aria-label="Monter"
                disabled={i === 0}
                onClick={() => swap(i, i - 1)}
              >
                <Icon name="arrow-up" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Descendre"
                disabled={i === lines.length - 1}
                onClick={() => swap(i, i + 1)}
              >
                <Icon name="arrow-down" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Retirer l’exercice"
                onClick={() => props.onChange(lines.filter((_, j) => j !== i))}
              >
                <Icon name="close" />
              </button>
            </span>
            {l.name?.trim() && !known && (
              <span className="small muted sp-line__new">
                nouvel exercice (ajouté à la bibliothèque)
              </span>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="sp-link small"
        onClick={() => props.onChange([...lines, { name: '', reps: '', load: '', note: '' }])}
      >
        + Exercice
      </button>
    </div>
  );
}

/** Lines ready to send: empty ones dropped. */
const linesToSend = (lines: ExerciseLineInput[]) => lines.filter((l) => l.name?.trim());

function SummaryCard(props: { week: Summary; month: Summary; streak: number }) {
  const ratio = (s: Summary) => `${s.done} / ${s.planned}`;
  return (
    <div className="sp-summary">
      <div>
        <span className="sp-summary__value num">{ratio(props.week)}</span>
        <span className="small muted">séances cette semaine</span>
      </div>
      <div>
        <span className="sp-summary__value num">{ratio(props.month)}</span>
        <span className="small muted">ce mois-ci</span>
      </div>
      <div>
        <span className="sp-summary__value num">{props.streak}</span>
        <span className="small muted">
          semaine{props.streak > 1 ? 's' : ''} complète{props.streak > 1 ? 's' : ''} d’affilée
        </span>
      </div>
      <div>
        <span className="sp-summary__value">
          {props.week.mood !== null ? (
            <>
              <Icon
                name={`mood-${Math.round(props.week.mood)}`}
                label={MOOD_LABELS[Math.round(props.week.mood) - 1]}
              />{' '}
              {String(props.week.mood).replace('.', ',')}
            </>
          ) : (
            '—'
          )}
        </span>
        <span className="small muted">humeur moyenne (semaine)</span>
      </div>
      {props.week.toValidate > 0 && (
        <div className="sp-summary__late">
          <span className="sp-summary__value num">{props.week.toValidate}</span>
          <span className="small">à valider (passées)</span>
        </div>
      )}
    </div>
  );
}

function SessionCard(props: {
  session: Session;
  today: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { session: s } = props;
  const late = s.status === 'planned' && s.date < props.today;
  return (
    <button
      type="button"
      draggable={s.status !== 'cancelled'}
      onDragStart={(e) => e.dataTransfer.setData('text/sport-session', s.id)}
      className={`sp-session sp-session--${s.status}${late ? ' sp-session--late' : ''}${props.selected ? ' sp-session--selected' : ''}`}
      onClick={props.onSelect}
      title="Cliquer pour valider ou modifier ; glisser vers un autre jour de la semaine"
    >
      <span className="sp-session__name">{s.name}</span>
      <span className="small muted num">
        {s.start}–{endTime(s.start, s.durationMin)}
      </span>
      <span className="sp-session__state">
        {late ? (
          <StateBadge tone="warning">à valider</StateBadge>
        ) : (
          <StateBadge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StateBadge>
        )}
        {s.mood && <Icon name={`mood-${s.mood}`} label={`Humeur : ${MOOD_LABELS[s.mood - 1]}`} />}
      </span>
    </button>
  );
}

function SessionEditor(props: {
  session: Session;
  week: WeekDto;
  library: Exercise[];
  run: Run;
  onClose: () => void;
  onDeleted: (s: Session) => void;
}) {
  const module = useModule();
  const { session: s } = props;
  const [lines, setLines] = useState<ExerciseLineInput[] | null>(null);
  const [comment, setComment] = useState(s.comment);
  const [start, setStart] = useState(s.start);
  const [duration, setDuration] = useState(String(s.durationMin));
  const patch = (body: object) => props.run(() => module.api.patch(`/sessions/${s.id}`, body));
  return (
    <Card
      title={`${s.name} · ${dayLabel(s.date, true)}`}
      actions={
        <Button variant="secondary" small onClick={props.onClose}>
          Fermer
        </Button>
      }
    >
      <div className="sp-editor">
        <section className="sp-editor__exercises" aria-label="Exercices">
          {lines === null ? (
            <>
              <ExerciseLines lines={s.exercises} />
              <Button small variant="secondary" onClick={() => setLines(s.exercises)}>
                {s.exercises.length ? 'Modifier les exercices' : 'Ajouter des exercices'} de cette
                séance
              </Button>
            </>
          ) : (
            <>
              <ExerciseLinesEditor lines={lines} library={props.library} onChange={setLines} />
              <div className="ui-actions">
                <Button
                  small
                  onClick={() =>
                    void patch({ exercises: linesToSend(lines) }).then((ok) => ok && setLines(null))
                  }
                >
                  Enregistrer pour cette séance
                </Button>
                <Button small variant="secondary" onClick={() => setLines(null)}>
                  Annuler
                </Button>
              </div>
              <p className="small muted">
                Vaut pour cette séance seulement : la semaine type ne change pas.
              </p>
            </>
          )}
        </section>
        <div className="ui-actions">
          <Button
            small
            variant={s.status === 'done' ? 'primary' : 'secondary'}
            onClick={() => void patch({ status: 'done' })}
          >
            Fait
          </Button>
          <Button
            small
            variant={s.status === 'missed' ? 'primary' : 'secondary'}
            onClick={() => void patch({ status: 'missed' })}
          >
            Pas fait
          </Button>
          {s.status !== 'planned' && (
            <Button small variant="secondary" onClick={() => void patch({ status: 'planned' })}>
              {s.status === 'cancelled' ? 'Rétablir' : 'Remettre à « prévue »'}
            </Button>
          )}
          {s.status !== 'cancelled' && (
            <Button small variant="danger" onClick={() => void patch({ status: 'cancelled' })}>
              Annuler la séance
            </Button>
          )}
          {s.templateId === null && (
            <Button
              small
              variant="danger"
              onClick={() => {
                if (
                  !window.confirm(
                    `Supprimer la séance « ${s.name} » du ${dayLabel(s.date, true)} ?\n\nTu pourras l’annuler juste après.`,
                  )
                )
                  return;
                void props
                  .run(() => module.api.delete(`/sessions/${s.id}`))
                  .then((ok) => ok && props.onDeleted(s));
              }}
            >
              Supprimer (ajoutée à la main)
            </Button>
          )}
        </div>
        <div className="sp-moods" role="group" aria-label="Humeur">
          {MOOD_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              className={`sp-mood${s.mood === i + 1 ? ' sp-mood--on' : ''}`}
              aria-pressed={s.mood === i + 1}
              aria-label={`Humeur : ${label}`}
              title={label}
              onClick={() => void patch({ mood: s.mood === i + 1 ? null : i + 1 })}
            >
              <Icon name={`mood-${i + 1}`} size={22} />
            </button>
          ))}
        </div>
        <textarea
          className="input"
          rows={3}
          value={comment}
          placeholder="Commentaire libre (sensations, charges, douleurs…)"
          aria-label="Commentaire"
          onChange={(e) => setComment(e.target.value)}
          onBlur={() => comment !== s.comment && void patch({ comment })}
        />
        <div className="sp-row">
          <label className="small">
            Début{' '}
            <input
              className="input input--short"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="small">
            Durée{' '}
            <input
              className="input input--short num"
              type="number"
              min={5}
              max={600}
              step={5}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />{' '}
            min
          </label>
          <Button
            small
            variant="secondary"
            disabled={start === s.start && Number(duration) === s.durationMin}
            onClick={() => void patch({ start, durationMin: Number(duration) })}
          >
            Enregistrer pour cette séance
          </Button>
          <label className="small">
            Déplacer au{' '}
            <select
              className="input input--short"
              value={s.date}
              onChange={(e) => void patch({ date: e.target.value })}
            >
              {props.week.days.map((d, i) => (
                <option key={d.date} value={d.date}>
                  {WEEKDAYS[i]} {dayLabel(d.date)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="small muted">
          Heure, durée et jour changés ici valent pour cette séance seulement ; la semaine type n’y
          touche plus.
        </p>
      </div>
    </Card>
  );
}

function AddSession(props: { date: string; run: Run; onDone: () => void }) {
  const module = useModule();
  const [name, setName] = useState('');
  const [start, setStart] = useState('18:00');
  const [duration, setDuration] = useState('60');
  return (
    <form
      className="sp-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void props
          .run(() =>
            module.api.post('/sessions', {
              date: props.date,
              name,
              start,
              durationMin: Number(duration),
            }),
          )
          .then((ok) => ok && props.onDone());
      }}
    >
      <input
        className="input"
        autoFocus
        placeholder="Nom (ex. Course)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Nom de la séance"
      />
      <input
        className="input"
        type="time"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        aria-label="Début"
      />
      <input
        className="input num"
        type="number"
        min={5}
        max={600}
        step={5}
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        aria-label="Durée en minutes"
      />
      <div className="ui-actions">
        <Button small type="submit" disabled={!name.trim()}>
          Ajouter
        </Button>
        <Button small variant="secondary" type="button" onClick={props.onDone}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function WeekView(props: {
  week: WeekDto;
  run: Run;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const module = useModule();
  const [adding, setAdding] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = (event: DragEvent, date: string) => {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData('text/sport-session');
    const s = props.week.days.flatMap((d) => d.sessions).find((x) => x.id === id);
    if (s && s.date !== date) void props.run(() => module.api.patch(`/sessions/${id}`, { date }));
  };
  return (
    <div className="sp-week">
      {props.week.days.map((day, i) => (
        <section
          key={day.date}
          className={`sp-day${day.date === props.week.today ? ' sp-day--today' : ''}${over === day.date ? ' sp-day--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(day.date);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => drop(e, day.date)}
          aria-label={`${WEEKDAYS[i]} ${dayLabel(day.date)}`}
        >
          <header className="sp-day__head">
            <strong>{WEEKDAYS[i]}</strong>
            <span className="small muted">{dayLabel(day.date)}</span>
          </header>
          {day.sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              today={props.week.today}
              selected={props.selected === s.id}
              onSelect={() => props.onSelect(props.selected === s.id ? null : s.id)}
            />
          ))}
          {adding === day.date ? (
            <AddSession date={day.date} run={props.run} onDone={() => setAdding(null)} />
          ) : (
            <button
              type="button"
              className="sp-day__add"
              onClick={() => setAdding(day.date)}
              aria-label={`Ajouter une séance ${WEEKDAYS[i]}`}
            >
              + Séance
            </button>
          )}
        </section>
      ))}
    </div>
  );
}

function MonthView(props: { month: string; onWeek: (monday: string) => void }) {
  const module = useModule();
  const data = useApi<MonthDto>(module.url(`/month?month=${props.month}`));
  const [peek, setPeek] = useState<string | null>(null);
  if (!data.data) return <p className="muted">Chargement…</p>;
  const m = data.data;
  const peeked = m.weeks
    .flatMap((w) => w.days.flatMap((d) => d.sessions))
    .find((s) => s.id === peek);
  return (
    <div className="sp-month">
      <div className="sp-month__head">
        {WEEKDAYS.map((d) => (
          <span key={d} className="small muted">
            {d.slice(0, 3)}
          </span>
        ))}
      </div>
      {m.weeks.map((w) => (
        <div key={w.week} className="sp-month__week">
          {w.days.map((d) => (
            <span
              key={d.date}
              className={`sp-month__day${d.date.slice(0, 7) !== m.month ? ' sp-month__day--out' : ''}${d.date === m.today ? ' sp-month__day--today' : ''}`}
            >
              <span className="small muted num">{Number(d.date.slice(8))}</span>
              {d.sessions.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={`sp-dot sp-dot--${s.status === 'planned' && s.date < m.today ? 'late' : s.status}${peek === s.id ? ' sp-dot--on' : ''}`}
                  title={`${s.name} · ${STATUS[s.status].label} (cliquer : exercices)`}
                  onClick={() => setPeek(peek === s.id ? null : s.id)}
                >
                  {s.name}
                </button>
              ))}
            </span>
          ))}
          <button
            type="button"
            className="sp-month__open icon-button"
            onClick={() => props.onWeek(w.week)}
            title="Ouvrir la semaine"
            aria-label={`Ouvrir la semaine du ${dayLabel(w.week)}`}
          >
            ›
          </button>
        </div>
      ))}
      {peeked && (
        <Card
          title={`${peeked.name} · ${dayLabel(peeked.date, true)} · ${peeked.start}`}
          actions={
            <Button small variant="secondary" onClick={() => props.onWeek(mondayOf(peeked.date))}>
              Ouvrir la semaine
            </Button>
          }
        >
          <ExerciseLines lines={peeked.exercises} />
          {peeked.comment && <p className="small">Commentaire : {peeked.comment}</p>}
        </Card>
      )}
      <p className="small muted">
        Ce mois-ci : {m.summary.done} / {m.summary.planned} séances faites
        {m.summary.toValidate ? ` · ${m.summary.toValidate} à valider` : ''}
      </p>
    </div>
  );
}

function TemplateEditor(props: { template: TemplateItem[]; library: Exercise[]; run: Run }) {
  const module = useModule();
  const [items, setItems] = useState<
    (Omit<TemplateItem, 'exercises'> & { exercises: ExerciseLineInput[] })[]
  >(props.template);
  const [open, setOpen] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (index: number, patch: Partial<(typeof items)[number]>) => {
    setSaved(false);
    setItems(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };
  return (
    <Card title="Semaine type">
      <p className="muted small">
        Tes séances de chaque jour. Elle remplit les semaines à venir ; une modification vaut à
        partir de demain et ne touche ni le passé, ni les séances validées ou changées à la main.
      </p>
      {WEEKDAYS.map((day, d) => (
        <div key={day} className="sp-template__day">
          <strong className="sp-template__label">{day}</strong>
          <div className="sp-template__items">
            {items.map(
              (it, i) =>
                it.weekday === d + 1 && (
                  <div key={it.id || i} className="sp-template__item">
                    <div className="sp-row">
                      <input
                        className="input"
                        value={it.name}
                        placeholder="Nom (ex. Dos + abdos)"
                        aria-label={`Nom de la séance du ${day}`}
                        onChange={(e) => set(i, { name: e.target.value })}
                      />
                      <input
                        className="input input--short"
                        type="time"
                        value={it.start}
                        aria-label="Début"
                        onChange={(e) => set(i, { start: e.target.value })}
                      />
                      <input
                        className="input input--short num"
                        type="number"
                        min={5}
                        max={600}
                        step={5}
                        value={it.durationMin}
                        aria-label="Durée en minutes"
                        onChange={(e) => set(i, { durationMin: Number(e.target.value) })}
                      />
                      <span className="small muted">min</span>
                      <Button
                        variant="secondary"
                        small
                        aria-expanded={open === i}
                        onClick={() => setOpen(open === i ? null : i)}
                      >
                        Exercices ({linesToSend(it.exercises).length})
                      </Button>
                      <Button
                        variant="secondary"
                        small
                        onClick={() => {
                          setOpen(null);
                          setItems(items.filter((_, j) => j !== i));
                        }}
                      >
                        Retirer
                      </Button>
                    </div>
                    {open === i && (
                      <ExerciseLinesEditor
                        lines={it.exercises}
                        library={props.library}
                        onChange={(exercises) => set(i, { exercises })}
                      />
                    )}
                  </div>
                ),
            )}
            <button
              type="button"
              className="sp-link small"
              onClick={() =>
                setItems([
                  ...items,
                  {
                    id: '',
                    weekday: (d + 1) as Weekday,
                    name: '',
                    start: '18:00',
                    durationMin: 60,
                    exercises: [],
                  },
                ])
              }
            >
              + Ajouter une séance le {day.toLowerCase()}
            </button>
          </div>
        </div>
      ))}
      <div className="ui-actions">
        <Button
          disabled={items.some((it) => !it.name.trim())}
          onClick={() =>
            void props
              .run(() =>
                module.api.put('/template', {
                  items: items.map((it) => ({
                    ...it,
                    id: it.id || undefined,
                    exercises: linesToSend(it.exercises),
                  })),
                }),
              )
              .then((ok) => setSaved(ok))
          }
        >
          Enregistrer la semaine type
        </Button>
        {saved && <span className="small muted">Enregistrée : appliquée à partir de demain.</span>}
      </div>
    </Card>
  );
}

/** The exercise library: add, rename, note, merge two duplicates, delete one no session uses. */
function Library(props: { library: Exercise[]; run: Run; onDeleted: (e: Exercise) => void }) {
  const module = useModule();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; note: string } | null>(null);
  const [merge, setMerge] = useState<{ from: string; into: string } | null>(null);
  const similar = props.library.filter((e) => name.trim() && fold(e.name).includes(fold(name)));
  const shown = props.library.filter((e) => fold(e.name).includes(fold(query)));
  return (
    <Card title="Bibliothèque d’exercices">
      <form
        className="sp-row"
        onSubmit={(e) => {
          e.preventDefault();
          void props
            .run(() => module.api.post('/exercises', { name }))
            .then((ok) => ok && setName(''));
        }}
      >
        <input
          className="input"
          value={name}
          placeholder="Nouvel exercice (ex. Tractions)"
          aria-label="Nouvel exercice"
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          small
          type="submit"
          disabled={!name.trim() || similar.some((x) => fold(x.name) === fold(name))}
        >
          Ajouter
        </Button>
        {similar.length > 0 && (
          <span className="small muted">Déjà là : {similar.map((x) => x.name).join(', ')}</span>
        )}
      </form>
      <p className="small muted">
        Les exercices tapés dans une séance arrivent ici tout seuls. Deux noms pour le même exercice
        : « Fusionner » remplace l’un par l’autre partout (semaine type et séances, passées
        comprises).
      </p>
      {props.library.length > 6 && (
        <input
          className="input"
          type="search"
          value={query}
          placeholder="Chercher un exercice"
          aria-label="Chercher un exercice"
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {!props.library.length && <p className="muted">Pas encore d’exercice.</p>}
      <ul className="sp-library">
        {shown.map((e) => (
          <li key={e.id}>
            {editing?.id === e.id ? (
              <form
                className="sp-row"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void props
                    .run(() =>
                      module.api.patch(`/exercises/${e.id}`, {
                        name: editing.name,
                        note: editing.note,
                      }),
                    )
                    .then((ok) => ok && setEditing(null));
                }}
              >
                <input
                  className="input"
                  value={editing.name}
                  aria-label="Nom"
                  onChange={(ev) => setEditing({ ...editing, name: ev.target.value })}
                />
                <input
                  className="input sp-line__note"
                  value={editing.note}
                  placeholder="Note (réglage de la machine, consigne…)"
                  aria-label="Note"
                  onChange={(ev) => setEditing({ ...editing, note: ev.target.value })}
                />
                <Button small type="submit">
                  Enregistrer
                </Button>
                <Button small variant="secondary" type="button" onClick={() => setEditing(null)}>
                  Annuler
                </Button>
              </form>
            ) : merge?.from === e.id ? (
              <div className="sp-row">
                <span>
                  Remplacer <strong>{e.name}</strong> partout par
                </span>
                <select
                  className="input input--short"
                  value={merge.into}
                  aria-label="Exercice gardé"
                  onChange={(ev) => setMerge({ ...merge, into: ev.target.value })}
                >
                  <option value="">choisir…</option>
                  {props.library
                    .filter((x) => x.id !== e.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
                <Button
                  small
                  disabled={!merge.into}
                  onClick={() =>
                    void props
                      .run(() => module.api.post('/exercises/merge', merge))
                      .then((ok) => ok && setMerge(null))
                  }
                >
                  Fusionner
                </Button>
                <Button small variant="secondary" onClick={() => setMerge(null)}>
                  Annuler
                </Button>
              </div>
            ) : (
              <div className="sp-row">
                <strong>{e.name}</strong>
                {e.note && <span className="small muted">{e.note}</span>}
                <span className="small muted">
                  {e.uses ? `utilisé ${e.uses} fois` : 'inutilisé'}
                </span>
                <span className="sp-library__tools">
                  <Button
                    small
                    variant="secondary"
                    onClick={() => setEditing({ id: e.id, name: e.name, note: e.note })}
                  >
                    Modifier
                  </Button>
                  {props.library.length > 1 && (
                    <Button
                      small
                      variant="secondary"
                      onClick={() => setMerge({ from: e.id, into: '' })}
                    >
                      Fusionner…
                    </Button>
                  )}
                  {e.uses === 0 && (
                    <Button
                      small
                      variant="danger"
                      onClick={() =>
                        void props
                          .run(() => module.api.delete(`/exercises/${e.id}`))
                          .then((ok) => ok && props.onDeleted(e))
                      }
                    >
                      Supprimer
                    </Button>
                  )}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

type Undo = { message: string; restore: string };

function SportPage() {
  const module = useModule();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'week' | 'month' | 'template' | 'exercises'>('week');
  const [undo, setUndo] = useState<Undo | null>(null);
  const library = useApi<{ exercises: Exercise[] }>(module.url('/exercises'));
  const exercises = library.data?.exercises ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const start = params.get('week') ?? '';
  const data = useApi<WeekDto>(module.url(`/week${start ? `?start=${start}` : ''}`));
  const w = data.data;
  const [month, setMonth] = useState<string | null>(null);
  const shownMonth = month ?? (w ? addDays(w.week, 3).slice(0, 7) : null);
  const run: Run = async (action) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      data.reload();
      library.reload();
    }
  };
  const goWeek = (monday: string) => {
    setSelected(null);
    setParams({ week: monday });
    setTab('week');
  };
  const exportMonth = async (format: 'csv' | 'md') => {
    if (!shownMonth) return;
    setNotice(null);
    await run(async () => {
      const last = new Date(
        Date.UTC(Number(shownMonth.slice(0, 4)), Number(shownMonth.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
      const r = await module.api.post<{ path?: string; count?: number }>('/export', {
        format,
        from: `${shownMonth}-01`,
        to: last,
      });
      setNotice(
        r.path
          ? `${r.count} séance(s) exportée(s) : ${r.path}`
          : 'Export annulé : rien n’a été enregistré.',
      );
    });
  };
  const session = w?.days.flatMap((d) => d.sessions).find((s) => s.id === selected) ?? null;

  return (
    <Page
      title="Sport"
      subtitle="Ta semaine type, tes séances validées, ton bilan."
      actions={
        <>
          <Button variant="secondary" onClick={() => void exportMonth('csv')}>
            Exporter le mois (CSV)…
          </Button>
          <Button variant="secondary" onClick={() => void exportMonth('md')}>
            (Markdown)…
          </Button>
        </>
      }
    >
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {data.error && <ErrorMessage>{data.error}</ErrorMessage>}
      {notice && <p className="small muted">{notice}</p>}
      {w && (
        <>
          <SummaryCard week={w.summary} month={w.month} streak={w.streak} />
          <nav className="sp-tabs" role="tablist">
            {(
              [
                ['week', 'Semaine'],
                ['month', 'Mois'],
                ['template', 'Semaine type'],
                ['exercises', 'Exercices'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === 'week' && (
            <>
              <div className="sp-row sp-nav">
                <Button variant="secondary" small onClick={() => goWeek(addDays(w.week, -7))}>
                  ‹ Semaine précédente
                </Button>
                <strong>Semaine du {dayLabel(w.week, true)}</strong>
                <Button variant="secondary" small onClick={() => goWeek(addDays(w.week, 7))}>
                  Semaine suivante ›
                </Button>
                {w.week !== mondayOf(w.today) && (
                  <Button variant="secondary" small onClick={() => goWeek(mondayOf(w.today))}>
                    Cette semaine
                  </Button>
                )}
              </div>
              {w.template.length === 0 && (
                <p className="muted">
                  Pas encore de semaine type : remplis-la dans l’onglet « Semaine type », ou ajoute
                  des séances jour par jour.
                </p>
              )}
              <WeekView week={w} run={run} selected={selected} onSelect={setSelected} />
              {session && (
                <SessionEditor
                  key={`${session.id}|${session.start}|${session.durationMin}|${session.comment}|${JSON.stringify(session.exercises)}`}
                  session={session}
                  week={w}
                  library={exercises}
                  run={run}
                  onClose={() => setSelected(null)}
                  onDeleted={(d) => {
                    setSelected(null);
                    setUndo({
                      message: `Séance supprimée : « ${d.name} »`,
                      restore: `/sessions/${d.id}/restore`,
                    });
                  }}
                />
              )}
            </>
          )}
          {tab === 'month' && shownMonth && (
            <>
              <div className="sp-row sp-nav">
                <Button
                  variant="secondary"
                  small
                  onClick={() => setMonth(addMonth(shownMonth, -1))}
                >
                  ‹
                </Button>
                <strong>
                  {new Date(`${shownMonth}-15T12:00:00`).toLocaleDateString('fr-FR', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </strong>
                <Button variant="secondary" small onClick={() => setMonth(addMonth(shownMonth, 1))}>
                  ›
                </Button>
              </div>
              <MonthView month={shownMonth} onWeek={goWeek} />
            </>
          )}
          {tab === 'template' && (
            <TemplateEditor
              key={w.template.map((t) => t.id).join()}
              template={w.template}
              library={exercises}
              run={run}
            />
          )}
          {tab === 'exercises' && (
            <Library
              library={exercises}
              run={run}
              onDeleted={(e) =>
                setUndo({
                  message: `Exercice supprimé : « ${e.name} »`,
                  restore: `/exercises/${e.id}/restore`,
                })
              }
            />
          )}
          <LibraryOptions library={exercises} />
        </>
      )}
      {undo && (
        <UndoToast
          message={undo.message}
          onUndo={() => void run(() => module.api.post(undo.restore))}
          onDismiss={() => setUndo(null)}
        />
      )}
    </Page>
  );
}

function addMonth(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function HomeWidget() {
  const module = useModule();
  const { data } = useApi<{ today: string; sessions: Session[] }>(module.url('/home'));
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  if (!data.sessions.length) return <p className="small muted">Pas de séance aujourd’hui.</p>;
  return (
    <ul className="sp-home small">
      {data.sessions.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className="sp-home__session"
            aria-expanded={open === s.id}
            title="Voir les exercices"
            onClick={(e) => {
              // The home card is a link to the module: this click only opens the list.
              e.preventDefault();
              e.stopPropagation();
              setOpen(open === s.id ? null : s.id);
            }}
          >
            <strong>{s.name}</strong> · {s.start} · {s.durationMin} min
            {s.exercises.length > 0 &&
              ` · ${s.exercises.length} exercice${s.exercises.length > 1 ? 's' : ''}`}
          </button>{' '}
          {s.status !== 'planned' && (
            <StateBadge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StateBadge>
          )}
          {open === s.id && <ExerciseLines lines={s.exercises} />}
        </li>
      ))}
    </ul>
  );
}

export default defineFrontendModule({
  pages: [{ path: '', component: SportPage }],
  HomeWidget,
});
