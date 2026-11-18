// An Agenda as v0.42.0 wrote its data (migrations 1 to 6, the `category`
// text only, a category row with a random id): the starting point of the
// v0.43.0 upgrade tests (migration 7 on each device, then a sync). A shim, not
// the v0.42 code: only the writes the upgrade has to meet.
import path from 'node:path';
import { type ModuleContext, requestBody, SyncStore } from '@hub/sdk/core';
import { type DiscoveredModule, loadModuleFolder } from '@hub/sdk/testing';

export async function agendaV042(): Promise<DiscoveredModule> {
  const real = await loadModuleFolder(path.resolve(__dirname, '..', '..', 'modules', 'agenda'));
  const backend = real.backend!;
  return {
    ...real,
    backend: {
      ...backend,
      migrations: backend.migrations!.slice(0, 6),
      register(ctx: ModuleContext) {
        const store = new SyncStore(ctx.db);
        // An event, as v0.42 created it (no category_id, no kind).
        ctx.routes.post('/events', (request) => {
          const b = requestBody(request);
          return store.create('events', {
            title: String(b.title),
            start_at: String(b.start),
            end_at: String(b.end),
            all_day: b.allDay ? 1 : 0,
            location: null,
            note: null,
            category: String(b.category),
          });
        });
        // A category Thomas coloured in v0.42 (a row, random id).
        ctx.routes.post('/categories', (request) => {
          const b = requestBody(request);
          const name = String(b.name);
          return store.create('categories', {
            key: name.trim().toLowerCase(),
            name,
            color: b.color ? String(b.color) : null,
            shape: b.shape === 'deadline' ? 'deadline' : 'normal',
            counted: 1,
            shown: 1,
            sort: null,
            mine: b.mine ? 1 : 0,
          });
        });
      },
    },
  } as DiscoveredModule;
}
