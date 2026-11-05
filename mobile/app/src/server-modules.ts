// The modules whose server code runs in the Worker (ADR 0044), in one place:
// the page's list (page-modules.ts) shows the same ones.
import type { ModuleManifest } from '@hub/sdk/core';
import todoBackend from '../../../modules/todo/backend/index';
import todoManifest from '../../../modules/todo/module.json';
import type { PhoneModule } from '../../../packages/phone/host';

export const SERVER_MODULES: PhoneModule[] = [
  { manifest: todoManifest as ModuleManifest, backend: todoBackend },
];
