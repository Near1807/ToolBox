// The Agenda's pages: the bar on top, then the week (PC) or the day
// (phone), the month, the week type; layers, the detail of an event, a
// short guide. « Expérimental » until Thomas validates it.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Button,
  Card,
  defineFrontendModule,
  ErrorMessage,
  errorMessage,
  onPhone,
  Page,
  UndoToast,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import { addDays, dayLabel, mondayOf } from '../shared/time';
import type { AgendaEventDto, PlannedTaskDto, RangeDto } from '../shared/types';
import { minutesBetween } from '../shared/time';
import { spanLabel } from '../shared/drag';
import { TaskPanel } from './TaskPanel';
import { colorStyle, switchCategories, useRange, useSwitches, type Item } from './common';
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
  const layers = useSwitches(data?.categoriesOff ?? DEFAULT_OFF);
  const [selected, setSelected] = useState<AgendaEventDto | null>(null);
  const [selectedTask, setSelectedTask] = useState<PlannedTaskDto | null>(null);
  const [creating, setCreating] = useState(false);
  /** The last change: its message, and « Annuler » when it can be undone. */
  const [notice, setNotice] = useState<Undo | { message: string; run: null } | null>(null);

  const open = (item: Item) => {
    setSelected(null);
    setSelectedTask(null);
    if (item.source === 'foreign') navigate(item.event.open);
    else if (item.source === 'task') setSelectedTask(item.event);
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
                ? { message: `« ${a.title} » ajouté à la To-do (à caser)`, run: null }
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
          key={`${selectedTask.id}:${selectedTask.start}:${selectedTask.end}`}
          task={selectedTask}
          today={data.today}
          onClose={() => setSelectedTask(null)}
          onChanged={changed}
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
        />
      )}
      {data && view === 'day' && (
        <DayView data={data} day={day} shown={layers.shown} onDay={setDay} onOpen={open} />
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
  pages: [
    { path: '', component: AgendaPage },
    { path: 'guide', component: GuidePage },
  ],
  HomeWidget,
});
