// v0.43.0: « Convertir en tâche » / « Convertir en rendez-vous » — one write
// each, on a click; the « Annuler » it returns puts back EXACTLY the state of
// before (the element converted comes back from its tombstone, the one made
// is deleted). The associated timer follows (the server copies it).
import type { Undo } from './EventPanel';

interface Api {
  post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
  delete: (url: string) => Promise<unknown>;
}

/** An event of the Agenda → a task of the To-do (planned at its time, or due on its day). */
export async function convertEventToTask(
  api: Api,
  event: { id: string; title: string },
): Promise<Undo> {
  const r = await api.post<{ task: { id: string }; eventId: string }>(
    `/events/${event.id}/to-task`,
  );
  return {
    message: `« ${event.title} » est maintenant une tâche de la To-do`,
    run: async () => {
      await api.delete(`/tasks/${r.task.id}`);
      await api.post(`/events/${r.eventId}/restore`);
    },
  };
}

/** A task of the To-do → an event (at its planned time, or all day on its due date). */
export async function convertTaskToEvent(
  api: Api,
  task: { id: string; title: string },
): Promise<Undo> {
  const r = await api.post<{ event: { id: string }; taskId: string }>(`/tasks/${task.id}/to-event`);
  return {
    message: `« ${task.title} » est maintenant un rendez-vous`,
    run: async () => {
      await api.delete(`/events/${r.event.id}`);
      await api.post(`/tasks/${r.taskId}/restore`);
    },
  };
}
