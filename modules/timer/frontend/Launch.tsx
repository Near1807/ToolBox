// « Lancer un timer », lent to the other modules (v0.36.0, ADR 0046,
// « timer.launch »; props typed in ../contract.ts): a short choice —
// « Durée du bloc », « Pomodoro » (25/5, 4 cycles), one of the presets —
// and « Associer » (the owner of the task or the event keeps the choice).
// It starts through the Timer's own API: linked to the task when there is
// one (« Tâche terminée ? » ticks it), else named after the event. One
// timer at a time: a running one is named, and stopped only after a
// confirmation.
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, ErrorMessage, errorMessage, Icon, useApi, useModule } from '@hub/sdk/frontend';
import type { TimerChoice, TimerLaunchProps } from '../contract';
import { DEFAULT_POMODORO, duration, type PlanConfig } from '../shared/plan';
import type { StateDto } from '../shared/types';

const choiceLabel = (choice: TimerChoice, blockMin: number) =>
  choice.kind === 'block'
    ? `durée du bloc (${duration(blockMin * 60)})`
    : choice.kind === 'pomodoro'
      ? `pomodoro ${DEFAULT_POMODORO.workMin}/${DEFAULT_POMODORO.breakMin}`
      : choice.name;

export function TimerLaunch(props: TimerLaunchProps) {
  const module = useModule();
  const { data, reload } = useApi<StateDto>(module.url('/state'));
  const [open, setOpen] = useState(false);
  const [associate, setAssociate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const running = data.session && data.session.status !== 'ended' ? data.session : null;
  const mine =
    running &&
    ((props.taskId && running.taskId === props.taskId) ||
      (props.subject && running.subject === props.subject));
  // A preset that no longer exists: back to the plain button.
  const preferred =
    props.preferred?.kind === 'preset' &&
    !data.presets.some(
      (p) => props.preferred?.kind === 'preset' && p.id === props.preferred.presetId,
    )
      ? null
      : (props.preferred ?? null);

  // The session's name: on a task, the Timer's own (the task's title shows next to it);
  // on an event, the event's title (« Répétition · Pomodoro 25/5 »).
  const configOf = (choice: TimerChoice): { config: PlanConfig; name: string | null } => {
    const named = (own: string | null) =>
      props.taskId ? own : own ? `${props.title} · ${own}` : props.title;
    if (choice.kind === 'block')
      return {
        config: { mode: 'simple', workMin: Math.max(1, props.blockMin) },
        name: named(null),
      };
    if (choice.kind === 'pomodoro')
      return {
        config: DEFAULT_POMODORO,
        name: named(`Pomodoro ${DEFAULT_POMODORO.workMin}/${DEFAULT_POMODORO.breakMin}`),
      };
    const preset = data.presets.find((p) => p.id === choice.presetId);
    return { config: preset!.config, name: named(preset!.name) };
  };

  const launch = async (choice: TimerChoice) => {
    setError(null);
    setMessage(null);
    if (running) {
      const ok = window.confirm(
        `Un timer est en cours (« ${running.name}${running.taskTitle ? ` · ${running.taskTitle}` : ''} »). L’arrêter et lancer celui-ci ?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      if (running) await module.api.post('/stop');
      const { config, name } = configOf(choice);
      await module.api.post('/start', {
        config,
        name,
        taskId: props.taskId ?? null,
        subject: props.taskId ? null : (props.subject ?? null),
      });
      if (associate && props.onPreferredChange) await props.onPreferredChange(choice);
      setOpen(false);
      setMessage(`Timer lancé : ${choiceLabel(choice, props.blockMin)}`);
      reload();
      props.onStarted?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const choices: TimerChoice[] = [
    { kind: 'block' },
    { kind: 'pomodoro' },
    ...data.presets.map((p): TimerChoice => ({ kind: 'preset', presetId: p.id, name: p.name })),
  ];

  return (
    <div className={`tm-launch${props.compact ? ' tm-launch--compact' : ''}`}>
      {mine ? (
        <span className="tm-launch__running small">
          <Icon name="timer" /> Son timer tourne · <Link to="/m/timer">ouvrir le Timer</Link>
        </span>
      ) : (
        <span className="ui-actions">
          {preferred ? (
            <Button small disabled={busy} onClick={() => void launch(preferred)}>
              <Icon name="timer" /> Lancer : {choiceLabel(preferred, props.blockMin)}
            </Button>
          ) : null}
          <Button
            small
            variant={preferred ? 'secondary' : 'primary'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name="timer" /> {preferred ? 'Autre timer…' : 'Lancer un timer'}
          </Button>
        </span>
      )}
      {open && !mine && (
        <div className="tm-launch__menu" role="menu">
          {running && (
            <p className="small tm-launch__busy">
              <Icon name="warning" /> En cours : « {running.name}
              {running.taskTitle ? ` · ${running.taskTitle}` : ''} » — il sera arrêté (avec
              confirmation).
            </p>
          )}
          {choices.map((choice) => (
            <button
              key={choice.kind === 'preset' ? choice.presetId : choice.kind}
              type="button"
              role="menuitem"
              className="tm-launch__choice"
              disabled={busy}
              onClick={() => void launch(choice)}
            >
              {choiceLabel(choice, props.blockMin)}
            </button>
          ))}
          {props.onPreferredChange && (
            <label className="small tm-launch__associate">
              <input
                type="checkbox"
                checked={associate}
                onChange={(e) => setAssociate(e.target.checked)}
              />{' '}
              Associer ce choix (le bouton le lancera en un clic)
            </label>
          )}
          {preferred && props.onPreferredChange && (
            <button
              type="button"
              className="tm-launch__unlink small"
              onClick={() =>
                void Promise.resolve(props.onPreferredChange!(null)).then(() => setOpen(false))
              }
            >
              Ne plus associer de timer
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="small muted tm-launch__done">
          {message} · <Link to="/m/timer">ouvrir le Timer</Link>
        </p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}
