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
