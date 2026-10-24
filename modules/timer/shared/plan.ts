// The program of a session (pure functions, shared by the backend and the
// interface, tested in tests/plan.test.ts): a list of phases, work and
// breaks, computed from the settings of a simple timer, a pomodoro or an
// incremental pomodoro (short work periods first, then longer, constant
// breaks). The state at a given instant is computed from the real time
// elapsed, never from a counter (see `stateAt`).

export type Mode = 'simple' | 'pomodoro' | 'incremental';
export type PhaseKind = 'work' | 'break' | 'long-break';

export interface Phase {
  kind: PhaseKind;
  /** Duration in seconds (can be extended while it runs). */
  seconds: number;
  /** Work period number (1, 2…); a break carries the number of the work before it. */
  cycle: number;
}

/** What the user sets (minutes). `cycles` or `totalMin` ends a pomodoro. */
export interface PlanConfig {
  mode: Mode;
  /** Simple timer and classic pomodoro: length of a work period. */
  workMin?: number;
  breakMin?: number;
  cycles?: number | null;
  totalMin?: number | null;
  /** Pomodoro: a longer break every `longBreakEvery` work periods (both optional). */
  longBreakMin?: number | null;
  longBreakEvery?: number | null;
  /** Incremental: first work period, growth per cycle (minutes or %), ceiling. */
  startMin?: number;
  stepMin?: number | null;
  stepPct?: number | null;
  maxMin?: number;
}

export const LIMITS = { minMin: 1, maxMin: 600, maxCycles: 50, maxTotalMin: 12 * 60 } as const;

/** The shortest last work period worth keeping when a total duration cuts it (minutes). */
export const MIN_LAST_WORK_MIN = 5;

const clampInt = (value: unknown, min: number, max: number): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/**
 * Checks and normalises a configuration; throws an Error in French when it
 * cannot make a program.
 */
export function normaliseConfig(input: PlanConfig): PlanConfig {
  const mode = input.mode;
  if (mode !== 'simple' && mode !== 'pomodoro' && mode !== 'incremental')
    throw new Error('Type de session inconnu');
  const minutes = (v: unknown, label: string, min: number = LIMITS.minMin) => {
    const n = clampInt(v, min, LIMITS.maxMin);
    if (n === null) throw new Error(`${label} : durée en minutes attendue`);
    return n;
  };
  if (mode === 'simple') return { mode, workMin: minutes(input.workMin, 'Durée') };
  const cycles =
    input.cycles === null || input.cycles === undefined
      ? null
      : clampInt(input.cycles, 1, LIMITS.maxCycles);
  const totalMin =
    input.totalMin === null || input.totalMin === undefined
      ? null
      : clampInt(input.totalMin, LIMITS.minMin, LIMITS.maxTotalMin);
  if (cycles === null && totalMin === null)
    throw new Error('Indique un nombre de cycles ou une durée totale');
  const breakMin = minutes(input.breakMin, 'Pause', 0);
  if (mode === 'pomodoro') {
    const every =
      input.longBreakEvery === null || input.longBreakEvery === undefined
        ? null
        : clampInt(input.longBreakEvery, 2, LIMITS.maxCycles);
    return {
      mode,
      workMin: minutes(input.workMin, 'Travail'),
      breakMin,
      cycles: totalMin === null ? cycles : null,
      totalMin,
      longBreakMin: every === null ? null : minutes(input.longBreakMin, 'Pause longue', 0),
      longBreakEvery: every,
    };
  }
  const startMin = minutes(input.startMin, 'Travail de départ');
  const maxMin = Math.max(startMin, minutes(input.maxMin, 'Travail maximal'));
  const stepPct =
    input.stepPct === null || input.stepPct === undefined ? null : clampInt(input.stepPct, 1, 300);
  const stepMin = stepPct !== null ? null : (clampInt(input.stepMin ?? 0, 0, LIMITS.maxMin) ?? 0);
  return {
    mode,
    startMin,
    stepMin,
    stepPct,
    maxMin,
    breakMin,
    cycles: totalMin === null ? cycles : null,
    totalMin,
  };
}

/** Work minutes of the n-th period (0-based) of an incremental pomodoro. */
export function incrementalWork(config: PlanConfig, n: number): number {
  const start = config.startMin!;
  const max = config.maxMin!;
  const raw =
    config.stepPct !== null && config.stepPct !== undefined
      ? Math.round(start * (1 + config.stepPct / 100) ** n)
      : start + (config.stepMin ?? 0) * n;
  return Math.min(max, Math.max(start, raw));
}

/**
 * The phases of a session. With a total duration, work periods are added
 * while they fit; the last one is shortened to end exactly on time when at
 * least MIN_LAST_WORK_MIN minutes remain for it, and a session never ends on
 * a break.
 */
export function buildPlan(input: PlanConfig): Phase[] {
  const config = normaliseConfig(input);
  if (config.mode === 'simple') return [{ kind: 'work', seconds: config.workMin! * 60, cycle: 1 }];
  const workOf = (n: number) =>
    config.mode === 'incremental' ? incrementalWork(config, n) : config.workMin!;
  const breakAfter = (cycle: number): Phase => {
    const long =
      config.mode === 'pomodoro' &&
      config.longBreakEvery !== null &&
      config.longBreakEvery !== undefined &&
      cycle % config.longBreakEvery === 0;
    return long
      ? { kind: 'long-break', seconds: config.longBreakMin! * 60, cycle }
      : { kind: 'break', seconds: config.breakMin! * 60, cycle };
  };
  const phases: Phase[] = [];
  if (config.totalMin === null || config.totalMin === undefined) {
    for (let n = 0; n < config.cycles!; n++) {
      if (n > 0) phases.push(breakAfter(n));
      phases.push({ kind: 'work', seconds: workOf(n) * 60, cycle: n + 1 });
    }
    return phases;
  }
  const total = config.totalMin * 60;
  let used = 0;
  for (let n = 0; n < LIMITS.maxCycles; n++) {
    const pause = n > 0 ? breakAfter(n) : null;
    const before = used + (pause?.seconds ?? 0);
    const left = total - before;
    if (left < MIN_LAST_WORK_MIN * 60 && n > 0) break;
    const work = Math.min(workOf(n) * 60, left);
    if (work <= 0) break;
    if (pause) phases.push(pause);
    phases.push({ kind: 'work', seconds: work, cycle: n + 1 });
    used = before + work;
    if (used >= total) break;
  }
  return phases;
}

export const totalSeconds = (phases: Phase[]) => phases.reduce((s, p) => s + p.seconds, 0);
export const workSeconds = (phases: Phase[]) =>
  phases.filter((p) => p.kind === 'work').reduce((s, p) => s + p.seconds, 0);
export const workCount = (phases: Phase[]) => phases.filter((p) => p.kind === 'work').length;

export interface PhaseState {
  /** Index of the current phase, or phases.length when the session is over. */
  index: number;
  phase: Phase | null;
  /** Seconds left in the current phase, and in the whole session. */
  remaining: number;
  remainingTotal: number;
  /** Active time elapsed (pauses excluded), and the part spent working. */
  elapsed: number;
  workDone: number;
  ended: boolean;
}

/**
 * Where a session stands after `elapsed` seconds of active time (the real
 * time since the start, minus the pauses).
 */
export function stateAt(phases: Phase[], elapsed: number): PhaseState {
  const total = totalSeconds(phases);
  const e = Math.max(0, elapsed);
  let start = 0;
  let workDone = 0;
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index]!;
    const end = start + phase.seconds;
    if (e < end) {
      if (phase.kind === 'work') workDone += e - start;
      return {
        index,
        phase,
        remaining: end - e,
        remainingTotal: total - e,
        elapsed: e,
        workDone,
        ended: false,
      };
    }
    if (phase.kind === 'work') workDone += phase.seconds;
    start = end;
  }
  return {
    index: phases.length,
    phase: null,
    remaining: 0,
    remainingTotal: 0,
    elapsed: Math.min(e, total),
    workDone,
    ended: true,
  };
}

/** Active seconds at which phase `index` ends (the next transition). */
export function phaseEnd(phases: Phase[], index: number): number {
  return totalSeconds(phases.slice(0, index + 1));
}

/** « 1:05:30 », « 27:00 », « 0:45 ». */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** « 1 h 05 », « 27 min », « 45 s ». */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

export const PHASE_LABELS: Record<PhaseKind, string> = {
  work: 'Travail',
  break: 'Pause',
  'long-break': 'Pause longue',
};

/**
 * The phase as the mini-timer and the home widget say it. The clock can pass
 * the end a moment before the backend marks the session ended: no phase then.
 */
export function phaseLabel(status: 'running' | 'paused' | 'ended', phase: Phase | null): string {
  if (status === 'ended' || !phase) return 'Terminé';
  if (status === 'paused') return 'En pause';
  return PHASE_LABELS[phase.kind];
}
