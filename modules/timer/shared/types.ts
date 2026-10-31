// Shapes of the Timer's API answers (shared by the backend and the page).
import type { Mode, Phase, PhaseKind, PlanConfig } from './plan';

export type SessionStatus = 'running' | 'paused' | 'ended';

/** The session in progress (running, paused, or ended and waiting for « Tâche terminée ? »). */
export interface SessionDto {
  id: string;
  mode: Mode;
  /** Preset name, or « Timer 27 min ». */
  name: string;
  config: PlanConfig;
  phases: Phase[];
  status: SessionStatus;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: string;
  /** Active seconds elapsed at `at` (pauses excluded); add the time since `at` while running. */
  elapsed: number;
  at: string;
}

export interface PresetDto {
  id: string;
  name: string;
  config: PlanConfig;
}

export interface HistoryDto {
  id: string;
  name: string;
  mode: Mode;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Seconds of work actually done, and planned. */
  workSec: number;
  plannedWorkSec: number;
  /** True when every phase ran; false when stopped early. */
  completed: boolean;
  /** « Tâche terminée ? » : true (« Oui »), false (« Non »), null (no answer, or no task). */
  taskDone: boolean | null;
}

export interface StateDto extends LiveDto {
  presets: PresetDto[];
  /** The To-do is there: tasks can be linked. */
  todo: boolean;
  tasks: { id: string; title: string }[];
  history: HistoryDto[];
  /** Total work per task (recorded sessions), most worked on first. */
  perTask: { taskId: string; title: string; seconds: number }[];
  settings: { sound: string; volume: number };
}

/** Sent to the page and the floating window on each change (server-sent events). */
export interface TransitionEvent {
  /** The phase that starts, or null when the session ends. */
  kind: PhaseKind | null;
  sound: string;
  volume: number;
}

/** A short message of the floating window: « Pause — 5 min », « Tâche cochée… ». */
export interface ToastEvent {
  label: string;
  tone: 'work' | 'break' | 'done';
}

/** What the floating window shows (settings of the module). */
export interface FloatingDto {
  /** Mini-timer during a session. */
  timer: boolean;
  /** « Tâche terminée ? » and « Relancer » at the end. */
  question: boolean;
  /** Phase changes, a few seconds. */
  transitions: boolean;
}

/** The live state (event « session »). */
export interface LiveDto {
  session: SessionDto | null;
  /** After « Non » : the session to restart (same program), until « Plus tard ». */
  followUp: SessionDto | null;
  floating: FloatingDto;
}
