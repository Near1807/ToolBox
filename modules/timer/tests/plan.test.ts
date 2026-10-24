// The program of a session: simple timer, pomodoro, incremental pomodoro
// (progression, ceiling, total duration), and the state at an instant.
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  clock,
  duration,
  incrementalWork,
  normaliseConfig,
  phaseEnd,
  stateAt,
  totalSeconds,
  workCount,
  workSeconds,
} from '../shared/plan';

const minutes = (phases: { kind: string; seconds: number }[]) =>
  phases.map((p) => `${p.kind === 'work' ? 'T' : p.kind === 'break' ? 'P' : 'L'}${p.seconds / 60}`);

describe('simple timer', () => {
  it('one work period of the chosen length', () => {
    expect(minutes(buildPlan({ mode: 'simple', workMin: 27 }))).toEqual(['T27']);
  });
  it('refuses a missing length', () => {
    expect(() => buildPlan({ mode: 'simple' })).toThrow(/minutes/);
  });
});

describe('pomodoro', () => {
  it('a number of cycles, no break after the last work period', () => {
    expect(minutes(buildPlan({ mode: 'pomodoro', workMin: 25, breakMin: 5, cycles: 3 }))).toEqual([
      'T25',
      'P5',
      'T25',
      'P5',
      'T25',
    ]);
  });
  it('a long break every N cycles', () => {
    const plan = buildPlan({
      mode: 'pomodoro',
      workMin: 25,
      breakMin: 5,
      cycles: 5,
      longBreakEvery: 2,
      longBreakMin: 15,
    });
    expect(minutes(plan)).toEqual(['T25', 'P5', 'T25', 'L15', 'T25', 'P5', 'T25', 'L15', 'T25']);
  });
  it('a total duration: full periods while they fit, never ending on a break', () => {
    const plan = buildPlan({ mode: 'pomodoro', workMin: 25, breakMin: 5, totalMin: 120 });
    expect(minutes(plan)).toEqual(['T25', 'P5', 'T25', 'P5', 'T25', 'P5', 'T25']);
    expect(totalSeconds(plan)).toBe(115 * 60);
  });
  it('the last period is shortened to end on time when 5 min or more remain', () => {
    const plan = buildPlan({ mode: 'pomodoro', workMin: 25, breakMin: 5, totalMin: 100 });
    expect(minutes(plan)).toEqual(['T25', 'P5', 'T25', 'P5', 'T25', 'P5', 'T10']);
    expect(totalSeconds(plan)).toBe(100 * 60);
  });
  it('needs a number of cycles or a total', () => {
    expect(() => buildPlan({ mode: 'pomodoro', workMin: 25, breakMin: 5 })).toThrow(/cycles/);
  });
});

describe('incremental pomodoro', () => {
  it('starts short and grows by minutes per cycle, up to the ceiling', () => {
    const plan = buildPlan({
      mode: 'incremental',
      startMin: 5,
      stepMin: 3,
      maxMin: 15,
      breakMin: 5,
      cycles: 6,
    });
    expect(minutes(plan)).toEqual([
      'T5',
      'P5',
      'T8',
      'P5',
      'T11',
      'P5',
      'T14',
      'P5',
      'T15',
      'P5',
      'T15',
    ]);
    expect(workCount(plan)).toBe(6);
  });
  it('« Démarrage doux 2 h » : 5 / 8 / 11 / 14 / 17 / 20 / 15 min of work, constant breaks', () => {
    const plan = buildPlan({
      mode: 'incremental',
      startMin: 5,
      stepMin: 3,
      maxMin: 25,
      breakMin: 5,
      totalMin: 120,
    });
    expect(minutes(plan).filter((p) => p.startsWith('T'))).toEqual([
      'T5',
      'T8',
      'T11',
      'T14',
      'T17',
      'T20',
      'T15',
    ]);
    expect(minutes(plan).filter((p) => p.startsWith('P'))).toEqual(Array(6).fill('P5'));
    expect(totalSeconds(plan)).toBe(120 * 60);
    expect(workSeconds(plan)).toBe(90 * 60);
  });
  it('grows by a percentage, rounded to the minute, never above the ceiling', () => {
    const config = normaliseConfig({
      mode: 'incremental',
      startMin: 10,
      stepPct: 50,
      maxMin: 30,
      breakMin: 5,
      cycles: 5,
    });
    expect([0, 1, 2, 3, 4].map((n) => incrementalWork(config, n))).toEqual([10, 15, 23, 30, 30]);
  });
  it('a ceiling below the start is raised to the start', () => {
    const plan = buildPlan({
      mode: 'incremental',
      startMin: 10,
      stepMin: 5,
      maxMin: 5,
      breakMin: 5,
      cycles: 2,
    });
    expect(minutes(plan)).toEqual(['T10', 'P5', 'T10']);
  });
});

describe('state at an instant (from the real time elapsed)', () => {
  const plan = buildPlan({ mode: 'pomodoro', workMin: 25, breakMin: 5, cycles: 2 });
  it('in the first work period', () => {
    const s = stateAt(plan, 60);
    expect(s).toMatchObject({ index: 0, remaining: 24 * 60, workDone: 60, ended: false });
    expect(s.remainingTotal).toBe(54 * 60);
  });
  it('in the break, then in the second period, then over', () => {
    expect(stateAt(plan, 26 * 60)).toMatchObject({ index: 1, remaining: 4 * 60, workDone: 1500 });
    expect(stateAt(plan, 31 * 60)).toMatchObject({ index: 2, workDone: 26 * 60 });
    expect(stateAt(plan, 99 * 60)).toMatchObject({ ended: true, workDone: 50 * 60 });
  });
  it('the end of each phase', () => {
    expect([0, 1, 2].map((i) => phaseEnd(plan, i) / 60)).toEqual([25, 30, 55]);
  });
});

describe('formatting', () => {
  it('clock and durations', () => {
    expect(clock(27 * 60)).toBe('27:00');
    expect(clock(3930)).toBe('1:05:30');
    expect(clock(44.2)).toBe('0:45');
    expect(duration(45)).toBe('45 s');
    expect(duration(27 * 60)).toBe('27 min');
    expect(duration(125 * 60)).toBe('2 h 05');
  });
});
