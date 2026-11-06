// The modules of the phone app, page side (ADR 0044): the PC's screens and
// home widget, plus the mobile layout (an ADDED .mobile.css, loaded only
// here). Same list as the Worker's (server-modules.ts). `place`: in the
// bottom bar, or behind « Plus ».
import type { ComponentType } from 'react';
import type { FrontendModule, ModuleManifest } from '@hub/sdk/frontend';
import coursesFrontend from '../../../modules/courses/frontend/index';
import coursesManifest from '../../../modules/courses/module.json';
import '../../../modules/courses/frontend/courses.mobile.css';
import ideasFrontend from '../../../modules/ideas/frontend/index';
import ideasManifest from '../../../modules/ideas/module.json';
import '../../../modules/ideas/frontend/ideas.mobile.css';
import sportFrontend from '../../../modules/sport/frontend/index';
import sportManifest from '../../../modules/sport/module.json';
import '../../../modules/sport/frontend/sport.mobile.css';
import timerFrontend from '../../../modules/timer/frontend/index';
import timerManifest from '../../../modules/timer/module.json';
import '../../../modules/timer/frontend/timer.mobile.css';
import { TimerPhoneNotes } from './TimerPhone';
import todoFrontend from '../../../modules/todo/frontend/index';
import todoManifest from '../../../modules/todo/module.json';
import '../../../modules/todo/frontend/todo.mobile.css';

export interface PageModule {
  manifest: ModuleManifest;
  frontend: FrontendModule;
  place: 'bar' | 'more';
  /** Shown above the module's pages, on the phone only (permissions, guides). */
  extra?: ComponentType;
}

/** In the order of the bottom bar: Courses, To-do, Sport; then Boîte à idées, Timer behind « Plus ». */
export const PAGE_MODULES: PageModule[] = [
  { manifest: coursesManifest as ModuleManifest, frontend: coursesFrontend, place: 'bar' },
  { manifest: todoManifest as ModuleManifest, frontend: todoFrontend, place: 'bar' },
  { manifest: sportManifest as ModuleManifest, frontend: sportFrontend, place: 'bar' },
  { manifest: ideasManifest as ModuleManifest, frontend: ideasFrontend, place: 'more' },
  {
    manifest: timerManifest as ModuleManifest,
    frontend: timerFrontend,
    place: 'more',
    extra: TimerPhoneNotes,
  },
];

/**
 * Settings that mean nothing on the phone, not shown in its Réglages (the PC
 * keeps them): the Timer's floating window.
 */
export const PHONE_HIDDEN_SETTINGS: Record<string, string[]> = {
  timer: ['overlay', 'overlayQuestion', 'overlayTransitions'],
};

/** The phone's words for a setting written for the PC (« Notification Windows »). */
export const PHONE_SETTING_LABELS: Record<string, string> = {
  'timer.notify': 'Notification à chaque changement de phase (programmée à l’avance)',
};
