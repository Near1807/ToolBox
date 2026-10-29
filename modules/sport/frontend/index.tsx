// Sport: the week (by default) with drag-and-drop inside it, the month, the
// weekly template, a session's details (Fait / Pas fait, mood, comment, time,
// duration, day), sessions added by hand, the summary, export. Home card:
// today's sessions.
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
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import {
  addDays,
  endTime,
  mondayOf,
  MOODS,
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
          {props.week.mood !== null
            ? `${MOODS[Math.round(props.week.mood) - 1]} ${String(props.week.mood).replace('.', ',')}`
            : '—'}
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
        {s.mood && <span aria-label={`humeur ${s.mood}`}>{MOODS[s.mood - 1]}</span>}
      </span>
    </button>
  );
}

function SessionEditor(props: { session: Session; week: WeekDto; run: Run; onClose: () => void }) {
  const module = useModule();
  const { session: s } = props;
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
        </div>
        <div className="sp-moods" role="group" aria-label="Humeur">
          {MOODS.map((m, i) => (
            <button
              key={m}
              type="button"
              className={`sp-mood${s.mood === i + 1 ? ' sp-mood--on' : ''}`}
              aria-pressed={s.mood === i + 1}
              aria-label={`Humeur ${i + 1}`}
              onClick={() => void patch({ mood: s.mood === i + 1 ? null : i + 1 })}
            >
              {m}
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
  if (!data.data) return <p className="muted">Chargement…</p>;
  const m = data.data;
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
        <button
          key={w.week}
          type="button"
          className="sp-month__week"
          onClick={() => props.onWeek(w.week)}
          title="Ouvrir la semaine"
        >
          {w.days.map((d) => (
            <span
              key={d.date}
              className={`sp-month__day${d.date.slice(0, 7) !== m.month ? ' sp-month__day--out' : ''}${d.date === m.today ? ' sp-month__day--today' : ''}`}
            >
              <span className="small muted num">{Number(d.date.slice(8))}</span>
              {d.sessions.map((s) => (
                <span
                  key={s.id}
                  className={`sp-dot sp-dot--${s.status === 'planned' && s.date < m.today ? 'late' : s.status}`}
                  title={`${s.name} · ${STATUS[s.status].label}`}
                >
                  {s.name}
                </span>
              ))}
            </span>
          ))}
        </button>
      ))}
      <p className="small muted">
        Ce mois-ci : {m.summary.done} / {m.summary.planned} séances faites
        {m.summary.toValidate ? ` · ${m.summary.toValidate} à valider` : ''}
      </p>
    </div>
  );
}

function TemplateEditor(props: { template: TemplateItem[]; run: Run }) {
  const module = useModule();
  const [items, setItems] = useState(props.template);
  const [saved, setSaved] = useState(false);
  const set = (index: number, patch: Partial<TemplateItem>) => {
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
                  <div key={it.id || i} className="sp-row">
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
                      onClick={() => setItems(items.filter((_, j) => j !== i))}
                    >
                      Retirer
                    </Button>
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
                  items: items.map((it) => ({ ...it, id: it.id || undefined })),
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

function SportPage() {
  const module = useModule();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'week' | 'month' | 'template'>('week');
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
                  key={`${session.id}|${session.start}|${session.durationMin}|${session.comment}`}
                  session={session}
                  week={w}
                  run={run}
                  onClose={() => setSelected(null)}
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
              run={run}
            />
          )}
        </>
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
  if (!data) return null;
  if (!data.sessions.length) return <p className="small muted">Pas de séance aujourd’hui.</p>;
  return (
    <ul className="sp-home small">
      {data.sessions.map((s) => (
        <li key={s.id}>
          <strong>{s.name}</strong> · {s.start} · {s.durationMin} min{' '}
          {s.status !== 'planned' && (
            <StateBadge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StateBadge>
          )}
        </li>
      ))}
    </ul>
  );
}

export default defineFrontendModule({
  pages: [{ path: '', component: SportPage }],
  HomeWidget,
});
