// v0.49.0 (MODULES.md §5.6 bis): a route that STARTS a background task and
// answers at once with its id ({ jobId }) — never a request that waits for
// the end. The page follows the task (the panel of the tasks, waitForJob).
import type {
  JobDefinitionOptions,
  JobRunContext,
  ModuleContext,
  RouteRequest,
} from '@hub/sdk/core';

export function taskRoute<I, R>(
  ctx: ModuleContext,
  spec: {
    method?: 'post' | 'delete';
    route: string;
    type: string;
    /** The task's input, read from the request (checks first: errors answer at once). */
    input: (request: RouteRequest) => I;
    title: (input: I) => string;
    run: (job: JobRunContext<I>) => Promise<R>;
    options?: JobDefinitionOptions;
  },
): void {
  ctx.jobs.define<I, R>(spec.type, spec.run, spec.options);
  ctx.routes[spec.method ?? 'post'](spec.route, (request) => {
    const input = spec.input(request);
    const job = ctx.jobs.enqueue(spec.type, input, { title: spec.title(input) });
    return { jobId: job.id };
  });
}
