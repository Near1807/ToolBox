// The Timer's notifications: their texts (the same on the PC, where the
// server shows them live, and on the phone, where the app schedules them in
// advance because its Worker sleeps in the background, ADR 0044), and the
// list of those still to come for a running session.
import { duration, PHASE_LABELS, phaseEnd, workCount, workSeconds, type Phase } from './plan';
import type { SessionDto } from './types';

export interface Notice {
  title: string;
  body: string;
}

/** The phase `index` starts (index ≥ 1). */
export function phaseNotice(phases: Phase[], index: number, taskTitle: string | null): Notice {
  const phase = phases[index]!;
  const work = phases.slice(0, index + 1).filter((p) => p.kind === 'work').length;
  return phase.kind === 'work'
    ? {
        title: `Au travail — ${duration(phase.seconds)}`,
        body: `Période ${work} sur ${workCount(phases)}${taskTitle ? ` · ${taskTitle}` : ''}`,
      }
    : {
        title: `${PHASE_LABELS[phase.kind]} — ${duration(phase.seconds)}`,
        body: `Période ${work} sur ${workCount(phases)} terminée.`,
      };
}

/** Every phase ran. */
export function endNotice(phases: Phase[], taskTitle: string | null): Notice {
  return {
    title: 'Session terminée',
    body: taskTitle
      ? `« ${taskTitle} » : ${duration(workSeconds(phases))} de travail. Tâche terminée ?`
      : `${duration(workSeconds(phases))} de travail.`,
  };
}

/**
 * The notifications still to come for a session, with their time (ms since
 * 1970): one at each phase change, one at the end. None when it is paused or
 * ended (a pause cancels them; a resume or « +5 min » gives a new list).
 */
export function upcomingNotices(
  session: SessionDto | null,
  now: number,
): (Notice & { at: number; key: string })[] {
  if (!session || session.status !== 'running') return [];
  const { phases } = session;
  const elapsed = session.elapsed + (now - Date.parse(session.at)) / 1000;
  const startedAt = now - elapsed * 1000;
  const out: (Notice & { at: number; key: string })[] = [];
  for (let i = 0; i < phases.length; i++) {
    const at = Math.round(startedAt + phaseEnd(phases, i) * 1000);
    if (at <= now) continue;
    const last = i === phases.length - 1;
    out.push({
      ...(last
        ? endNotice(phases, session.taskTitle)
        : phaseNotice(phases, i + 1, session.taskTitle)),
      at,
      key: `${session.id}:${i}`,
    });
  }
  return out;
}

// --- The ongoing notification on the phone (ADR 0044, v0.33.0) ---------------
// Like Android's Clock: shown during a session, in the shade and on the lock
// screen, the time left of the phase counting down by itself. The page gives
// the WHOLE plan (every phase still to come, its label, its end time) to the
// app's native plugin at start, resume and « +5 min »; the plugin moves from
// one phase to the next by itself (the Worker sleeps in the background).

/** « Travail · cycle 2 sur 4 », « Pause », « Pause longue », or the name of a simple timer. */
export function ongoingLabel(phases: Phase[], index: number, mode: string): string {
  const phase = phases[index];
  if (!phase) return 'Terminé';
  if (phase.kind !== 'work') return PHASE_LABELS[phase.kind];
  if (mode === 'simple') return 'Timer';
  const cycle = phases.slice(0, index + 1).filter((p) => p.kind === 'work').length;
  return `${PHASE_LABELS.work} · cycle ${cycle} sur ${workCount(phases)}`;
}

export interface OngoingStep {
  label: string;
  /** End of the phase (ms since 1970). */
  endsAt: number;
}

/** What the native plugin shows, for the whole session. */
export interface OngoingPlan {
  sessionId: string;
  /** The session's name (« Pomodoro 25/5 », a preset…). */
  name: string;
  status: 'running' | 'paused';
  /** Running: the phases still to come, in order (the first is the current one). */
  steps: OngoingStep[];
  /** Paused: the label of the phase and its time left (seconds, frozen). */
  label: string;
  remaining: number;
}

/** The plan of a running or paused session; null when there is nothing to show. */
export function ongoingPlan(session: SessionDto | null, now: number): OngoingPlan | null {
  if (!session || (session.status !== 'running' && session.status !== 'paused')) return null;
  const { phases } = session;
  const elapsed =
    session.elapsed + (session.status === 'running' ? (now - Date.parse(session.at)) / 1000 : 0);
  let index = phases.findIndex((_, i) => phaseEnd(phases, i) > elapsed);
  if (index < 0) return null;
  const remaining = phaseEnd(phases, index) - elapsed;
  const base = {
    sessionId: session.id,
    name: session.name,
    label: ongoingLabel(phases, index, session.mode),
    remaining: Math.max(0, Math.round(remaining)),
  };
  if (session.status === 'paused') return { ...base, status: 'paused', steps: [] };
  const startedAt = now - elapsed * 1000;
  const steps: OngoingStep[] = [];
  for (; index < phases.length; index++)
    steps.push({
      label: ongoingLabel(phases, index, session.mode),
      endsAt: Math.round(startedAt + phaseEnd(phases, index) * 1000),
    });
  return { ...base, status: 'running', steps };
}
