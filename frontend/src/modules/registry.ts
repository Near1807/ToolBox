// Build-time discovery of module frontends (docs/decisions/0005). Folders
// starting with "_" are examples: their id is the folder name without "_".
import type { FrontendModule } from '@hub/sdk/frontend';

const found = import.meta.glob<FrontendModule>('../../../modules/*/frontend/index.tsx', {
  eager: true,
  import: 'default',
});

export const moduleFrontends = new Map<string, FrontendModule>(
  Object.entries(found).map(([file, frontend]) => {
    const folder = file.split('/').at(-3) ?? '';
    return [folder.replace(/^_/, ''), frontend];
  }),
);
