// The modules of the phone app, page side (ADR 0044): the PC's screens and
// home widget, plus the mobile layout (an ADDED .mobile.css, loaded only
// here). Same list as the Worker's (server-modules.ts). `place`: in the
// bottom bar, or behind « Plus ».
import type { FrontendModule, ModuleManifest } from '@hub/sdk/frontend';
import todoFrontend from '../../../modules/todo/frontend/index';
import todoManifest from '../../../modules/todo/module.json';
import '../../../modules/todo/frontend/todo.mobile.css';

export interface PageModule {
  manifest: ModuleManifest;
  frontend: FrontendModule;
  place: 'bar' | 'more';
}

/** In the order of the bottom bar: Courses, To-do, Sport; then Boîte à idées, Timer behind « Plus ». */
export const PAGE_MODULES: PageModule[] = [
  { manifest: todoManifest as ModuleManifest, frontend: todoFrontend, place: 'bar' },
];
