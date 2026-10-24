// The Timer's page: choose a session (simple timer, pomodoro, incremental
// pomodoro, saved presets) with a preview of its cycles, follow it (ring,
// remaining time, phase), answer « Tâche terminée ? » at the end, and see the
// history and the time spent per task.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  confirmDelete,
  EmptyState,
  ErrorMessage,
  errorMessage,
  Page,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import {
  buildPlan,
  clock,
  duration,
  PHASE_LABELS,
  totalSeconds,
  workCount,
  workSeconds,
  type Mode,
  type Phase,
  type PhaseState,
  type PlanConfig,
} from '../shared/plan';
import type { SessionDto, StateDto } from '../shared/types';
import { useClock, useLiveSession } from './live';
import { Ring } from './Ring';

const QUICK = [10, 15, 20, 25, 30, 45, 60];
const MODES: { id: Mode; label: string }[] = [
  { id: 'simple', label: 'Timer simple' },
  { id: 'pomodoro', label: 'Pomodoro' },
  { id: 'incremental', label: 'Pomodoro incrémental' },
];
const time = (date: Date) =>
  date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function TimerPage() {
  const module = useModule();
  const [params, setParams] = useSearchParams();
  const live = useLiveSession();
  const data = useApi<StateDto>(
    module.url(`/state?s=${live.session?.id ?? ''}-${live.session?.status ?? ''}`),
  );
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{
    config: PlanConfig;
    name: string;
    taskId: number | null;
  } | null>(null);
  const [followUp, setFollowUp] = useState<SessionDto | null>(null);
  const s = data.data;
  const session = live.connected ? live.session : (s?.session ?? null);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      data.reload();
    }
  };
  const start = (config: PlanConfig, name: string | null, taskId: number | null) =>
    run(async () => {
      await module.api.post('/start', { config, name, taskId });
      setLast({ config, name: name ?? '', taskId });
      if (params.get('task')) setParams({});
    });
  const wantedTask = params.get('task') ? Number(params.get('task')) : null;

  return (
    <Page
      title="Timer"
      subtitle="Basé sur l’heure réelle : il continue si tu changes de page, et reprend après une fermeture de l’app."
    >
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {data.error && <ErrorMessage>{data.error}</ErrorMessage>}
      {session && live.state && session.status !== 'ended' && (
        <Running session={session} state={live.state} now={live.now} run={run} />
      )}
      {session?.status === 'ended' && (
        <Ended
          session={session}
          todo={s?.todo ?? false}
          run={run}
          onDeclined={() => setFollowUp(session)}
          onRestart={(config, name) => void start(config, name, session.taskId)}
        />
      )}
      {!session && followUp && (
        <Card>
          <h2>Pas encore terminée : « {followUp.taskTitle} »</h2>
          <Restart
            session={followUp}
            withTask
            onRestart={(config, name) => {
              setFollowUp(null);
              void start(config, name, followUp.taskId);
            }}
            onLater={() => setFollowUp(null)}
          />
        </Card>
      )}
      {!session && !followUp && s && (
        <Setup
          key={wantedTask ?? 'none'}
          state={s}
          initialTask={wantedTask}
          last={last}
          onStart={(config, name, taskId) => void start(config, name, taskId)}
          run={run}
        />
      )}
      {s && <History state={s} />}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// The session in progress
// ---------------------------------------------------------------------------

function Running(props: {
  session: SessionDto;
  state: PhaseState;
  now: number;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const module = useModule();
  const { session, state } = props;
  const phase = state.phase;
  const works = session.phases.filter((p) => p.kind === 'work').length;
  const workIndex = session.phases
    .slice(0, state.index + 1)
    .filter((p) => p.kind === 'work').length;
  const next = session.phases[state.index + 1] ?? null;
  const paused = session.status === 'paused';
  const end = new Date(props.now + state.remainingTotal * 1000);
  const onBreak = phase && phase.kind !== 'work';
  return (
    <Card>
      <div className="tm-running">
        <Ring
          size={300}
          progress={phase ? 1 - state.remaining / phase.seconds : 1}
          tone={onBreak ? 'break' : 'work'}
        >
          <div className="tm-phase">{phase ? PHASE_LABELS[phase.kind] : 'Terminé'}</div>
          <div className="tm-time num" aria-live="off">
            {clock(state.remaining)}
          </div>
          <div className="tm-sub">
            {paused ? 'En pause' : works > 1 ? `Période ${workIndex} sur ${works}` : session.name}
          </div>
        </Ring>
        <div className="tm-side">
          <h2>{session.name}</h2>
          {session.taskTitle && (
            <p className="tm-task">
              Tâche : <strong>{session.taskTitle}</strong>
            </p>
          )}
          <dl className="tm-facts">
            {session.phases.length > 1 && (
              <div>
                <dt>Reste en tout</dt>
                <dd className="num">{clock(state.remainingTotal)}</dd>
              </div>
            )}
            {next && (
              <div>
                <dt>Ensuite</dt>
                <dd>
                  {PHASE_LABELS[next.kind]} · {duration(next.seconds)}
                </dd>
              </div>
            )}
            <div>
              <dt>Fin {paused ? 'si tu reprends maintenant' : 'vers'}</dt>
              <dd className="num">{time(end)}</dd>
            </div>
          </dl>
          <div className="tm-actions">
            {paused ? (
              <Button onClick={() => void props.run(() => module.api.post('/resume'))}>
                Reprendre
              </Button>
            ) : (
              <Button onClick={() => void props.run(() => module.api.post('/pause'))}>Pause</Button>
            )}
            {onBreak && (
              <Button
                variant="secondary"
                onClick={() => void props.run(() => module.api.post('/skip'))}
              >
                Passer la pause
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void props.run(() => module.api.post('/extend', { minutes: 5 }))}
            >
              +5 min
            </Button>
            <Button
              variant="secondary"
              onClick={() => void props.run(() => module.api.post('/stop'))}
            >
              Arrêter
            </Button>
          </div>
        </div>
      </div>
      {session.phases.length > 1 && <Strip phases={session.phases} position={state.elapsed} />}
    </Card>
  );
}

/** « Tâche terminée ? » at the end (the session waits for the answer, even after a restart). */
function Ended(props: {
  session: SessionDto;
  todo: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
  onDeclined: () => void;
  onRestart: (config: PlanConfig, name: string | null) => void;
}) {
  const module = useModule();
  const { session } = props;
  const work = workSeconds(session.phases);
  const withTask = session.taskId !== null && props.todo;
  return (
    <Card>
      <div className="tm-ended" role="dialog" aria-label="Session terminée">
        <Ring size={160} progress={1} tone="work">
          <div className="tm-phase">Terminé</div>
        </Ring>
        <div className="tm-side">
          <h2>Session terminée</h2>
          <p className="muted">
            {session.name} · {duration(work)} de travail
          </p>
          {withTask ? (
            <>
              <p className="tm-question">
                Tâche terminée ? <strong>{session.taskTitle}</strong>
              </p>
              <div className="tm-actions">
                <Button
                  onClick={() => void props.run(() => module.api.post('/answer', { done: true }))}
                >
                  Oui, la cocher
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    props.onDeclined();
                    void props.run(() => module.api.post('/answer', { done: false }));
                  }}
                >
                  Non
                </Button>
              </div>
            </>
          ) : (
            <Restart
              session={session}
              withTask={false}
              onRestart={props.onRestart}
              onLater={() => void props.run(() => module.api.post('/dismiss'))}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

/** « Relancer une session » : same program, another length, or later. */
function Restart(props: {
  session: SessionDto;
  withTask: boolean;
  onRestart: (config: PlanConfig, name: string | null) => void;
  onLater: () => void;
}) {
  const [other, setOther] = useState('');
  const { session } = props;
  return (
    <div className="tm-restart">
      <p className="muted">
        Relancer une session{props.withTask ? ` sur « ${session.taskTitle} »` : ''} :
      </p>
      <div className="tm-actions">
        <Button onClick={() => props.onRestart(session.config, session.name)}>
          Même programme ({duration(totalSeconds(session.phases))})
        </Button>
        <label className="tm-inline">
          ou{' '}
          <input
            className="input input--short num"
            type="number"
            min={1}
            max={600}
            placeholder="min"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            aria-label="Autre durée en minutes"
          />{' '}
          min
        </label>
        <Button
          variant="secondary"
          disabled={!(Number(other) >= 1)}
          onClick={() => props.onRestart({ mode: 'simple', workMin: Number(other) }, null)}
        >
          Lancer
        </Button>
        <Button variant="secondary" onClick={props.onLater}>
          Plus tard
        </Button>
      </div>
    </div>
  );
}

/** The program as a strip: one block per phase, width ∝ duration, position marked. */
export function Strip(props: { phases: Phase[]; position?: number }) {
  const total = totalSeconds(props.phases);
  return (
    <div className="tm-strip" role="img" aria-label="Programme de la session">
      {props.phases.map((p, i) => (
        <span
          key={i}
          className={`tm-strip__block tm-strip__block--${p.kind}`}
          style={{ flexGrow: p.seconds }}
          title={`${PHASE_LABELS[p.kind]} · ${duration(p.seconds)}`}
        >
          {p.kind === 'work' && p.seconds / total > 0.05 ? Math.round(p.seconds / 60) : ''}
        </span>
      ))}
      {props.position !== undefined && (
        <i
          className="tm-strip__now"
          style={{ left: `${Math.min(100, (props.position / total) * 100)}%` }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Choosing a session
// ---------------------------------------------------------------------------

interface Form {
  minutes: string;
  workMin: string;
  breakMin: string;
  end: 'cycles' | 'total';
  cycles: string;
  totalMin: string;
  longBreak: boolean;
  longBreakMin: string;
  longBreakEvery: string;
  startMin: string;
  stepKind: 'min' | 'pct';
  step: string;
  maxMin: string;
}

const DEFAULT_FORM: Form = {
  minutes: '27',
  workMin: '25',
  breakMin: '5',
  end: 'cycles',
  cycles: '4',
  totalMin: '120',
  longBreak: false,
  longBreakMin: '15',
  longBreakEvery: '4',
  startMin: '5',
  stepKind: 'min',
  step: '3',
  maxMin: '25',
};

function configOf(mode: Mode, f: Form): PlanConfig {
  const n = (v: string) => Number(v.replace(',', '.'));
  const end =
    f.end === 'cycles'
      ? { cycles: n(f.cycles), totalMin: null }
      : { cycles: null, totalMin: n(f.totalMin) };
  if (mode === 'simple') return { mode, workMin: n(f.minutes) };
  if (mode === 'pomodoro')
    return {
      mode,
      workMin: n(f.workMin),
      breakMin: n(f.breakMin),
      ...end,
      longBreakMin: f.longBreak ? n(f.longBreakMin) : null,
      longBreakEvery: f.longBreak ? n(f.longBreakEvery) : null,
    };
  return {
    mode,
    startMin: n(f.startMin),
    stepMin: f.stepKind === 'min' ? n(f.step) : null,
    stepPct: f.stepKind === 'pct' ? n(f.step) : null,
    maxMin: n(f.maxMin),
    breakMin: n(f.breakMin),
    ...end,
  };
}

function formOf(config: PlanConfig): { mode: Mode; form: Form } {
  const s = (v: number | null | undefined, fallback: string) =>
    v === null || v === undefined ? fallback : String(v);
  return {
    mode: config.mode,
    form: {
      ...DEFAULT_FORM,
      minutes: s(config.mode === 'simple' ? config.workMin : null, DEFAULT_FORM.minutes),
      workMin: s(config.workMin, DEFAULT_FORM.workMin),
      breakMin: s(config.breakMin, DEFAULT_FORM.breakMin),
      end: config.totalMin ? 'total' : 'cycles',
      cycles: s(config.cycles, DEFAULT_FORM.cycles),
      totalMin: s(config.totalMin, DEFAULT_FORM.totalMin),
      longBreak: Boolean(config.longBreakEvery),
      longBreakMin: s(config.longBreakMin, DEFAULT_FORM.longBreakMin),
      longBreakEvery: s(config.longBreakEvery, DEFAULT_FORM.longBreakEvery),
      startMin: s(config.startMin, DEFAULT_FORM.startMin),
      stepKind: config.stepPct ? 'pct' : 'min',
      step: s(config.stepPct ?? config.stepMin, DEFAULT_FORM.step),
      maxMin: s(config.maxMin, DEFAULT_FORM.maxMin),
    },
  };
}

function Setup(props: {
  state: StateDto;
  initialTask: number | null;
  last: { config: PlanConfig; name: string; taskId: number | null } | null;
  onStart: (config: PlanConfig, name: string | null, taskId: number | null) => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const module = useModule();
  const [mode, setMode] = useState<Mode>('simple');
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [name, setName] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<number | null>(props.initialTask);
  const field = (key: keyof Form) => ({
    value: form[key] as string,
    onChange: (e: { target: { value: string } }) => {
      setForm({ ...form, [key]: e.target.value });
      setName(null);
    },
  });
  const config = configOf(mode, form);
  const plan = useMemo(() => {
    try {
      return { phases: buildPlan(config), error: null };
    } catch (error) {
      return { phases: [] as Phase[], error: (error as Error).message };
    }
    // The config is rebuilt from the form on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, form]);
  const tasks = props.state.tasks;
  const task = tasks.find((t) => t.id === taskId) ?? null;
  const load = (preset: { name: string; config: PlanConfig }) => {
    const loaded = formOf(preset.config);
    setMode(loaded.mode);
    setForm(loaded.form);
    setName(preset.name);
  };
  const save = () => {
    const presetName = window.prompt('Nom du préréglage (ex. « Démarrage doux 2 h »)', name ?? '');
    if (presetName?.trim())
      void props.run(() => module.api.post('/presets', { name: presetName, config }));
  };

  return (
    <>
      {props.state.todo && (
        <Card>
          <label className="tm-task-pick">
            Tâche de la To-do (facultatif){' '}
            <select
              className="input"
              value={taskId ?? ''}
              onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Aucune tâche —</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          {task && (
            <p className="muted small">
              À la fin : « Tâche terminée ? » ; « Oui » la coche dans la To-do.
            </p>
          )}
        </Card>
      )}
      <Card>
        <div className="tm-modes" role="tablist" aria-label="Type de session">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => {
                setMode(m.id);
                setName(null);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'simple' && (
          <>
            <p className="tm-label">Un clic pour lancer</p>
            <div className="tm-chips" aria-label="Durées">
              {QUICK.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="tm-chip"
                  aria-label={`${m} minutes`}
                  onClick={() => props.onStart({ mode: 'simple', workMin: m }, null, taskId)}
                >
                  <span className="tm-chip__main">{m}</span>
                  <span className="tm-chip__unit">min</span>
                </button>
              ))}
            </div>
            <div className="tm-form">
              <label>
                Autre durée{' '}
                <input
                  className="input input--short num"
                  type="number"
                  min={1}
                  max={600}
                  {...field('minutes')}
                />{' '}
                min
              </label>
              <Button
                disabled={Boolean(plan.error)}
                onClick={() => props.onStart(config, null, taskId)}
              >
                Démarrer
              </Button>
            </div>
          </>
        )}
        {mode !== 'simple' && (
          <div className="tm-form tm-form--grid">
            {mode === 'pomodoro' ? (
              <label>
                Travail{' '}
                <input
                  className="input input--short num"
                  type="number"
                  min={1}
                  {...field('workMin')}
                />{' '}
                min
              </label>
            ) : (
              <>
                <label>
                  Travail de départ{' '}
                  <input
                    className="input input--short num"
                    type="number"
                    min={1}
                    {...field('startMin')}
                  />{' '}
                  min
                </label>
                <label>
                  Progression{' '}
                  <input
                    className="input input--short num"
                    type="number"
                    min={0}
                    {...field('step')}
                  />{' '}
                  <select
                    className="input input--short"
                    value={form.stepKind}
                    onChange={(e) =>
                      setForm({ ...form, stepKind: e.target.value as 'min' | 'pct' })
                    }
                  >
                    <option value="min">min par cycle</option>
                    <option value="pct">% par cycle</option>
                  </select>
                </label>
                <label>
                  Travail maximal{' '}
                  <input
                    className="input input--short num"
                    type="number"
                    min={1}
                    {...field('maxMin')}
                  />{' '}
                  min
                </label>
              </>
            )}
            <label>
              Pause{' '}
              <input
                className="input input--short num"
                type="number"
                min={0}
                {...field('breakMin')}
              />{' '}
              min{mode === 'incremental' ? ' (constante)' : ''}
            </label>
            <fieldset className="tm-end">
              <legend>Fin</legend>
              <label>
                <input
                  type="radio"
                  checked={form.end === 'cycles'}
                  onChange={() => setForm({ ...form, end: 'cycles' })}
                />{' '}
                <input
                  className="input input--short num"
                  type="number"
                  min={1}
                  disabled={form.end !== 'cycles'}
                  {...field('cycles')}
                />{' '}
                cycles
              </label>
              <label>
                <input
                  type="radio"
                  checked={form.end === 'total'}
                  onChange={() => setForm({ ...form, end: 'total' })}
                />{' '}
                durée totale{' '}
                <input
                  className="input input--short num"
                  type="number"
                  min={5}
                  disabled={form.end !== 'total'}
                  {...field('totalMin')}
                />{' '}
                min
              </label>
            </fieldset>
            {mode === 'pomodoro' && (
              <label>
                <input
                  type="checkbox"
                  checked={form.longBreak}
                  onChange={(e) => setForm({ ...form, longBreak: e.target.checked })}
                />{' '}
                Pause longue de{' '}
                <input
                  className="input input--short num"
                  type="number"
                  min={1}
                  disabled={!form.longBreak}
                  {...field('longBreakMin')}
                />{' '}
                min tous les{' '}
                <input
                  className="input input--short num"
                  type="number"
                  min={2}
                  disabled={!form.longBreak}
                  {...field('longBreakEvery')}
                />{' '}
                cycles
              </label>
            )}
          </div>
        )}
        {mode !== 'simple' && <Preview phases={plan.phases} error={plan.error} />}
        {mode !== 'simple' && (
          <div className="tm-actions">
            <Button
              disabled={Boolean(plan.error)}
              onClick={() => props.onStart(config, name, taskId)}
            >
              Démarrer{name ? ` « ${name} »` : ''}
            </Button>
            <Button variant="secondary" disabled={Boolean(plan.error)} onClick={save}>
              Enregistrer comme préréglage…
            </Button>
          </div>
        )}
      </Card>
      <Card title="Préréglages">
        {props.state.presets.length === 0 ? (
          <EmptyState title="Aucun préréglage">
            Règle une session puis « Enregistrer comme préréglage… ».
          </EmptyState>
        ) : (
          <ul className="tm-presets">
            {props.state.presets.map((p) => {
              let phases: Phase[] = [];
              try {
                phases = buildPlan(p.config);
              } catch {
                // An unreadable preset is still listed, to be deleted.
              }
              return (
                <li key={p.id} className="tm-preset">
                  <div>
                    <strong>{p.name}</strong>
                    <div className="small muted">{summary(phases)}</div>
                  </div>
                  {phases.length > 1 && <Strip phases={phases} />}
                  <div className="tm-actions">
                    <Button small onClick={() => props.onStart(p.config, p.name, taskId)}>
                      Lancer
                    </Button>
                    <Button variant="secondary" small onClick={() => load(p)}>
                      Modifier
                    </Button>
                    <Button
                      variant="danger"
                      small
                      onClick={() =>
                        confirmDelete(`le préréglage « ${p.name} »`) &&
                        void props.run(() => module.api.delete(`/presets/${p.id}`))
                      }
                    >
                      Supprimer
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

/** « 7 périodes · 1 h 30 de travail · 2 h en tout ». */
function summary(phases: Phase[]): string {
  if (phases.length === 0) return '—';
  const n = workCount(phases);
  return `${n} période${n > 1 ? 's' : ''} · ${duration(workSeconds(phases))} de travail · ${duration(totalSeconds(phases))} en tout`;
}

/** What the session will be, before starting: the cycles and the estimated end. */
function Preview(props: { phases: Phase[]; error: string | null }) {
  const now = useClock();
  if (props.error) return <p className="error">{props.error}</p>;
  const works = props.phases
    .filter((p) => p.kind === 'work')
    .map((p) => Math.round(p.seconds / 60));
  const breaks = [
    ...new Set(
      props.phases.filter((p) => p.kind !== 'work').map((p) => Math.round(p.seconds / 60)),
    ),
  ];
  const end = new Date(now + totalSeconds(props.phases) * 1000);
  return (
    <div className="tm-preview">
      <h3>Aperçu</h3>
      <Strip phases={props.phases} />
      <p>
        Travail : <strong className="num">{works.join(' / ')}</strong> min
        {breaks.length > 0 && (
          <>
            {' '}
            · pause{breaks.length > 1 ? 's' : ''} :{' '}
            <strong className="num">{breaks.join(' / ')}</strong> min entre chaque
          </>
        )}
      </p>
      <p className="muted">
        {summary(props.phases)} · fin estimée vers <strong>{time(end)}</strong> si tu lances
        maintenant
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function History(props: { state: StateDto }) {
  const { history, perTask } = props.state;
  if (history.length === 0) return null;
  const day = (iso: string) =>
    new Date(iso).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  return (
    <div className="tm-history">
      {perTask.length > 0 && (
        <Card title="Temps passé par tâche">
          <ul className="list">
            {perTask.map((t) => (
              <li key={t.taskId} className="list__item">
                <span>{t.title}</span>
                <span className="num">{duration(t.seconds)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Historique">
        <table className="tm-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Session</th>
              <th>Tâche</th>
              <th className="num">Travail</th>
              <th>État</th>
              <th>Tâche terminée</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{day(h.startedAt)}</td>
                <td>{h.name}</td>
                <td>{h.taskTitle ?? <span className="muted">—</span>}</td>
                <td className="num">
                  {duration(h.workSec)}
                  {!h.completed && <span className="muted"> / {duration(h.plannedWorkSec)}</span>}
                </td>
                <td>{h.completed ? 'Terminée' : 'Arrêtée'}</td>
                <td>{h.taskDone === null ? '—' : h.taskDone ? 'Oui' : 'Non'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
