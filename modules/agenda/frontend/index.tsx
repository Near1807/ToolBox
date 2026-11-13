// The Agenda's pages: the bar on top, then the week (PC) or the day
// (phone), the month, the week type; layers, the detail of an event, a
// short guide. « Expérimental » until Thomas validates it.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Button,
  Card,
  defineFrontendModule,
  ErrorMessage,
  errorMessage,
  Lent,
  onPhone,
  Page,
  UndoToast,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import { addDays, dayLabel, mondayOf } from '../shared/time';
import type { AgendaEventDto, RangeDto } from '../shared/types';
import { minutesBetween } from '../shared/time';
import { spanLabel, type Span } from '../shared/drag';
import { appointmentPreview } from '../shared/parse';
import type { SlotKind } from './CreateSlot';
import { TaskPanel, type OpenTask } from './TaskPanel';
import {
  colorStyle,
  switchCategories,
  timerSubject,
  useRange,
  useSwitches,
  type Item,
} from './common';
import type { TimerChoice, TimerLaunchProps } from '../../timer/contract';
import { DEFAULT_OFF } from '../shared/categories';
import { DayView } from './DayView';
import { EventForm, EventPanel, type Undo } from './EventPanel';
import { GuidePage } from './Guide';
import { MonthView, monthGrid, monthTitle } from './MonthView';
import { QuickBar } from './QuickBar';
import { CategorySwitches, WeekView, type Drop } from './WeekView';
import { WeekTypeView } from './WeekTypeView';
import './agenda.css';

type View = 'week' | 'day' | 'month' | 'weekly';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function AgendaPage() {
  const module = useModule();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const phone = onPhone();
  const [view, setView] = useState<View>(phone ? 'day' : 'week');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today();
  const setDay = (d: string) => setParams({ date: d });
  const monday = mondayOf(day);
  // The day view reads its whole week too (the late tasks, the next days at a swipe).
  const period =
    view === 'month' ? monthGrid(day.slice(0, 7)) : { from: monday, to: addDays(monday, 6) };
  const { data, error, reload } = useRange(period.from, period.to);
  // v0.36.0: while a timer runs, the blocks follow it (a light refresh each minute).
  const timerOn = Boolean(data?.timer);
  useEffect(() => {
    if (!timerOn) return;
    const every = window.setInterval(reload, 60_000);
    return () => window.clearInterval(every);
  }, [timerOn, reload]);
  const layers = useSwitches(data?.categoriesOff ?? DEFAULT_OFF);
  const [selected, setSelected] = useState<AgendaEventDto | null>(null);
  const [selectedTask, setSelectedTask] = useState<OpenTask | null>(null);
  const [creating, setCreating] = useState(false);
  /** The last change: its message, and « Annuler » when it can be undone. */
  const [notice, setNotice] = useState<Undo | { message: string; run: null } | null>(null);

  const open = (item: Item) => {
    setSelected(null);
    setSelectedTask(null);
    if (item.source === 'foreign') navigate(item.event.open);
    else if (item.source === 'task')
      setSelectedTask({
        id: item.event.id,
        title: item.event.title,
        category: item.event.category,
      });
    else setSelected(item.event);
  };
  const changed = (u?: Undo) => {
    setSelected(null);
    setSelectedTask(null);
    setNotice(u ?? null);
    reload();
  };
  /** A drop in the week: ONE write, then « Annuler » (the previous values written back). */
  const drop = (d: Drop) => {
    const where = `${dayLabel(d.to.start.slice(0, 10), data?.today ?? day)} ${spanLabel(d.to)}`;
    let write: () => Promise<unknown>;
    let undo: () => Promise<unknown>;
    let title: string;
    if (d.kind === 'place') {
      const url = `/tasks/${d.task.id}/plan`;
      title = d.task.title;
      write = () => module.api.put(url, { plannedAt: d.to.start });
      undo = () => module.api.put(url, { plannedAt: null, durationMin: d.task.estimateMin });
    } else if (d.item.source === 'task') {
      const url = `/tasks/${d.item.event.id}/plan`;
      title = d.item.event.title;
      const field = (span: typeof d.to) =>
        d.kind === 'move'
          ? { plannedAt: span.start }
          : { durationMin: minutesBetween(span.start, span.end) };
      write = () => module.api.put(url, field(d.to));
      undo = () => module.api.put(url, field(d.from));
    } else if (d.item.source === 'own' && d.item.event.weekly) {
      // An occurrence of the week type: this time only (its exception).
      const w = d.item.event.weekly;
      const url = `/weekly/${w.id}/occurrences/${w.date}`;
      const move = (span: typeof d.to) => ({
        action: 'move',
        start: span.start,
        durationMin: minutesBetween(span.start, span.end),
      });
      title = d.item.event.title;
      write = () => module.api.put(url, move(d.to));
      undo = () => module.api.put(url, w.moved ? move(d.from) : { action: 'reset' });
    } else if (d.item.source === 'own') {
      const url = `/events/${d.item.event.id}`;
      title = d.item.event.title;
      write = () => module.api.patch(url, d.to);
      undo = () => module.api.patch(url, d.from);
    } else return;
    write().then(
      () => {
        setNotice({
          message: `« ${title} » ${d.kind === 'stretch' ? 'dure maintenant' : 'déplacé à'} ${where}`,
          run: undo,
        });
        reload();
      },
      (e: unknown) => {
        setNotice({ message: errorMessage(e), run: null });
        reload();
      },
    );
  };

  /** v0.36.0: tick a task from its block (the To-do's service), « Annuler » after. */
  const tick = (item: Item, done: boolean) => {
    if (item.source !== 'task') return;
    const url = `/tasks/${item.event.id}/done`;
    module.api.put(url, { done }).then(
      () => {
        setNotice({
          message: done
            ? `« ${item.event.title} » cochée`
            : `« ${item.event.title} » de nouveau à faire`,
          run: () => module.api.put(url, { done: !done }),
        });
        reload();
      },
      (e: unknown) => setNotice({ message: errorMessage(e), run: null }),
    );
  };

  /** v0.36.0: create in an empty slot, after the choice (« Tâche » / « Rendez-vous »). */
  const create = async (kind: SlotKind, title: string, span: Span) => {
    const where = `${dayLabel(span.start.slice(0, 10), data?.today ?? day)} ${spanLabel(span)}`;
    if (kind === 'task') {
      const made = await module.api.post<{ id: string; title: string }>('/tasks', {
        title,
        plannedAt: span.start,
        durationMin: minutesBetween(span.start, span.end),
      });
      setNotice({
        message: `Tâche « ${made.title} » prévue ${where}`,
        run: () => module.api.delete(`/tasks/${made.id}`),
      });
    } else {
      const made = await module.api.post<{ id: string; title: string }>('/events', {
        title,
        start: span.start,
        end: span.end,
      });
      setNotice({
        message: `Rendez-vous « ${made.title} » ${where}`,
        run: () => module.api.delete(`/events/${made.id}`),
      });
    }
    reload();
  };
  const openToPlace = (t: { id: string; title: string }) =>
    setSelectedTask({ id: t.id, title: t.title, category: 'Tâches' });

  const shift = (n: number) => {
    if (view !== 'month') return setDay(addDays(day, view === 'day' ? n : n * 7));
    const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1 + n, 1));
    setDay(d.toISOString().slice(0, 10));
  };

  return (
    <Page
      title="Agenda"
      subtitle={
        <span className="ag-subtitle">
          <span className="badge badge--warning" title="Pas encore validé à l’usage">
            Expérimental
          </span>{' '}
          <Link to="/m/agenda/guide">Le guide</Link>
        </span>
      }
    >
      {data && (
        <QuickBar
          today={data.today}
          todo={data.todo}
          onAdded={(a) => {
            setNotice(
              a.kind === 'task'
                ? {
                    message: a.plannedAt
                      ? `« ${a.title} » ajouté à la To-do, prévu ${dayLabel(a.plannedAt.slice(0, 10), data.today)} ${a.plannedAt.slice(11, 16)}`
                      : `« ${a.title} » ajouté à la To-do (à caser)`,
                    run: null,
                  }
                : {
                    message:
                      a.kind === 'weekly'
                        ? `« ${a.title} » ajouté à la semaine type`
                        : `« ${a.title} » ajouté`,
                    run: () =>
                      module.api.delete(
                        a.kind === 'weekly' ? `/weekly/${a.id}` : `/events/${a.id}`,
                      ),
                  },
            );
            reload();
          }}
        />
      )}
      <div className="ag-toolbar">
        <div className="ag-tabs" role="tablist">
          {(phone
            ? (['day', 'month', 'weekly'] as View[])
            : (['week', 'month', 'weekly'] as View[])
          ).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={`ag-tab${view === v ? ' ag-tab--on' : ''}`}
              onClick={() => {
                setSelected(null);
                setSelectedTask(null);
                setView(v);
              }}
            >
              {{ week: 'Semaine', day: 'Jour', month: 'Mois', weekly: 'Semaine type' }[v]}
            </button>
          ))}
        </div>
        {view !== 'weekly' && view !== 'day' && (
          <div className="ui-actions">
            <Button small variant="secondary" onClick={() => shift(-1)} aria-label="Précédent">
              ‹
            </Button>
            <Button small variant="secondary" onClick={() => setDay(today())}>
              Aujourd’hui
            </Button>
            <Button small variant="secondary" onClick={() => shift(1)} aria-label="Suivant">
              ›
            </Button>
            <strong className="ag-period">
              {view === 'month'
                ? monthTitle(day.slice(0, 7))
                : data &&
                  `Semaine du ${dayLabel(monday, data.today)} au ${dayLabel(addDays(monday, 6), data.today)}`}
            </strong>
          </div>
        )}
        {!phone && view !== 'weekly' && (
          <Button small variant="secondary" onClick={() => setCreating(!creating)}>
            {creating ? 'Fermer le formulaire' : 'Formulaire détaillé'}
          </Button>
        )}
      </div>
      {notice?.run && (
        <UndoToast
          message={notice.message}
          onUndo={() => {
            const run = notice.run!;
            setNotice(null);
            void run().then(reload);
          }}
          onDismiss={() => setNotice(null)}
        />
      )}
      {notice && !notice.run && (
        <p className="small ag-notice" role="status">
          {notice.message}{' '}
          <button type="button" className="ag-link" onClick={() => setNotice(null)}>
            OK
          </button>
        </p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {creating && data && (
        <Card title="Nouvel événement">
          <EventForm
            initial={{ start: `${day}T09:00`, end: `${day}T10:00`, allDay: false }}
            submitLabel="Ajouter"
            onCancel={() => setCreating(false)}
            onSubmit={async (fields) => {
              await module.api.post('/events', fields);
              setCreating(false);
              reload();
            }}
          />
        </Card>
      )}
      {selected && data && (
        <EventPanel
          // v0.36.0: « Lancer un timer » (lent by the Timer, absent without it)
          children={
            !selected.allDay && (
              <Lent<TimerLaunchProps>
                name="timer.launch"
                props={{
                  title: selected.title,
                  blockMin: minutesBetween(selected.start, selected.end),
                  subject: timerSubject(selected),
                  preferred: (selected.timerPref as TimerChoice | null) ?? null,
                  onPreferredChange: async (choice) => {
                    const url = selected.weekly
                      ? `/weekly/${selected.weekly.id}`
                      : `/events/${selected.id}`;
                    await module.api.patch(url, { timerPref: choice });
                    setSelected({ ...selected, timerPref: choice });
                    setNotice({
                      message: choice
                        ? `Timer associé à « ${selected.title} »${selected.weekly ? ' (toutes les semaines)' : ''}`
                        : 'Plus de timer associé',
                      run: () => module.api.patch(url, { timerPref: selected.timerPref }),
                    });
                    reload();
                  },
                  onStarted: reload,
                }}
              />
            )
          }
          key={`${selected.id}:${selected.start}`}
          event={selected}
          today={data.today}
          onClose={() => setSelected(null)}
          onChanged={changed}
          onWeekType={() => {
            setSelected(null);
            setView('weekly');
          }}
        />
      )}
      {selectedTask && data && (
        <TaskPanel
          key={selectedTask.id}
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          // The sheet stays open: the change shows in the week, with « Annuler ».
          onChanged={(u) => {
            setNotice(u);
            reload();
          }}
        />
      )}
      {data && view !== 'weekly' && (
        <CategorySwitches
          categories={switchCategories(data)}
          shown={layers.shown}
          onToggle={layers.toggle}
        />
      )}
      {data && view === 'week' && (
        <WeekView
          data={data}
          monday={monday}
          shown={layers.shown}
          onOpen={open}
          onDrop={phone ? undefined : drop}
          onTick={tick}
          onOpenTask={openToPlace}
          onCreate={create}
        />
      )}
      {data && view === 'day' && (
        <DayView
          data={data}
          day={day}
          shown={layers.shown}
          onDay={setDay}
          onOpen={open}
          onTick={tick}
          onOpenTask={openToPlace}
          onCreate={create}
        />
      )}
      {data && view === 'month' && (
        <MonthView
          data={data}
          month={day.slice(0, 7)}
          shown={layers.shown}
          onOpen={open}
          onDay={(d) => {
            setDay(d);
            setView(phone ? 'day' : 'week');
          }}
        />
      )}
      {data && view === 'weekly' && (
        <WeekTypeView weekly={data.weekly} today={data.today} onChanged={changed} />
      )}
    </Page>
  );
}

/** Home card: today and tomorrow. */
function HomeWidget() {
  const module = useModule();
  const { data } = useApi<RangeDto>(module.url('/today'));
  if (!data) return null;
  const items = [...data.events, ...data.foreign, ...data.tasks].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  const of = (d: string) =>
    items.filter((e) => e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d);
  const tomorrow = addDays(data.today, 1);
  return (
    <div className="ag-widget small">
      {[data.today, tomorrow].map((d) => (
        <div key={d}>
          <strong>{d === data.today ? 'Aujourd’hui' : 'Demain'}</strong>
          {of(d).length === 0 ? (
            <span className="muted"> · rien de prévu</span>
          ) : (
            <ul>
              {of(d)
                .slice(0, 4)
                .map((e) => (
                  <li key={e.id} style={colorStyle(e.category)}>
                    <span className="ag-dot" aria-hidden="true" />{' '}
                    {e.allDay ? 'journée' : e.start.slice(11)} · {e.title}
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default defineFrontendModule({
  // v0.36.0 (ADR 0046): « Rendez-vous » in the shell's « Ajouter » bar (the Agenda bar's rules).
  quickAdd: {
    label: 'Rendez-vous',
    icon: 'calendar-days',
    order: 2,
    placeholder: 'dentiste jeudi 14h 1h',
    preview: (text, today) => appointmentPreview(text, today),
    add: async (text, { api }) => {
      const r = await api.post<{
        kind: 'event' | 'weekly' | 'task';
        event?: { id: string; title: string; start: string };
        weekly?: { id: string; title: string };
      }>('/quick', { text });
      if (r.kind === 'weekly' && r.weekly)
        return {
          message: `« ${r.weekly.title} » ajouté à la semaine type`,
          open: '/m/agenda',
          undo: () => api.delete(`/weekly/${r.weekly!.id}`),
        };
      if (r.kind === 'event' && r.event)
        return {
          message: `« ${r.event.title} » ajouté à l’agenda`,
          open: `/m/agenda?date=${r.event.start.slice(0, 10)}`,
          undo: () => api.delete(`/events/${r.event!.id}`),
        };
      return { message: 'Ajouté', open: '/m/agenda' };
    },
  },
  pages: [
    { path: '', component: AgendaPage },
    { path: 'guide', component: GuidePage },
  ],
  HomeWidget,
});
