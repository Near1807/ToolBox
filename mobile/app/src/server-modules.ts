// The modules whose server code runs in the Worker (ADR 0044), in one place:
// the page's list (page-modules.ts) shows the same ones.
import type { ModuleManifest } from '@hub/sdk/core';
import coursesBackend from '../../../modules/courses/backend/index';
import coursesManifest from '../../../modules/courses/module.json';
import ideasBackend from '../../../modules/ideas/backend/index';
import ideasManifest from '../../../modules/ideas/module.json';
import sportBackend from '../../../modules/sport/backend/index';
import sportManifest from '../../../modules/sport/module.json';
import timerBackend from '../../../modules/timer/backend/index';
import timerManifest from '../../../modules/timer/module.json';
import todoBackend from '../../../modules/todo/backend/index';
import todoManifest from '../../../modules/todo/module.json';
import type { PhoneModule } from '../../../packages/phone/host';

export const SERVER_MODULES: PhoneModule[] = [
  { manifest: coursesManifest as ModuleManifest, backend: coursesBackend },
  { manifest: todoManifest as ModuleManifest, backend: todoBackend },
  { manifest: sportManifest as ModuleManifest, backend: sportBackend },
  { manifest: ideasManifest as ModuleManifest, backend: ideasBackend },
  { manifest: timerManifest as ModuleManifest, backend: timerBackend },
];
