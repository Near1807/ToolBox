// Live state of the assistant in the main window, fed by the one event stream
// opened by the Background component (the page subscribes here).
import type { StateEvent, TurnDto } from '../shared';

type Listener = () => void;

export const live = {
  state: { state: 'idle', text: null, toggle: false } as StateEvent,
  turns: new Map<number, TurnDto>(),
  micError: null as string | null,
  listeners: new Set<Listener>(),
  emit(): void {
    for (const listener of this.listeners) listener();
  },
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
};
