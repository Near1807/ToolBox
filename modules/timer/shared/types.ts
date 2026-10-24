// Shapes of the Timer's API answers (shared by the backend and the page).
import type { Mode, Phase, PhaseKind, PlanConfig } from './plan';

export type SessionStatus = 'running' | 'paused' | 'ended';

/** The session in progress (running, paused, or ended and waiting for « Tâche terminée ? »). */
export interface SessionDto {
  id: number;
  mode: Mode;
  /** Preset name, or « Timer 27 min ». */
  name: string;
  config: PlanConfig;
  phases: Phase[];
  status: SessionStatus;
  taskId: number | null;
  taskTitle: string | null;
  startedAt: string;
  /** Active seconds elapsed at `at` (pauses excluded); add the time since `at` while running. */
  elapsed: number;
  at: string;
}

export interface PresetDto {
  id: number;
  name: string;
  config: PlanConfig;
}

export interface HistoryDto {
  id: number;
  name: string;
  mode: Mode;
  taskId: number | null;
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

export interface StateDto {
  session: SessionDto | null;
  presets: PresetDto[];
  /** The To-do is there: tasks can be linked. */
  todo: boolean;
  tasks: { id: number; title: string }[];
  history: HistoryDto[];
  /** Total work per task (recorded sessions), most worked on first. */
  perTask: { taskId: number; title: string; seconds: number }[];
  settings: { sound: string; volume: number };
}

/** Sent to the page and the indicator on each change (server-sent events). */
export interface TransitionEvent {
  /** The phase that starts, or null when the session ends. */
  kind: PhaseKind | null;
  sound: string;
  volume: number;
}
