// The live channel to the PC (android/…/LiveChannelPlugin.java): a WebSocket
// with the pinned certificate and the device's token. The PC only says
// « changed »; the automatic synchronisation then runs a normal exchange.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { LiveConnect } from '../../../packages/phone/auto-sync';

interface LiveEvent {
  type: 'open' | 'message' | 'closed';
  generation: number;
  text: string;
  code: number;
}

const Native = registerPlugin<{
  open(o: { url: string; pin: string; token: string }): Promise<{ generation: number }>;
  close(): Promise<void>;
  addListener(event: 'live', handler: (e: LiveEvent) => void): Promise<PluginListenerHandle>;
}>('LiveChannel');

export const liveConnect: LiveConnect = (target, handlers) => {
  let generation = -1;
  let closed = false;
  let listener: PluginListenerHandle | null = null;
  /** Events that came before `open` answered with its number. */
  const early: LiveEvent[] = [];
  const handle = (e: LiveEvent) => {
    if (closed || e.generation !== generation) return;
    if (e.type === 'open') handlers.onOpen();
    else if (e.type === 'message') {
      try {
        if ((JSON.parse(e.text) as { type?: string }).type === 'changed') handlers.onChanged();
      } catch {
        // Not ours: ignored.
      }
    } else {
      closed = true;
      void listener?.remove();
      handlers.onClosed(e.code);
    }
  };
  void (async () => {
    listener = await Native.addListener('live', (e) => {
      if (generation === -1) early.push(e);
      else handle(e);
    });
    try {
      generation = (await Native.open(target)).generation;
      // Closed while it was opening: closed now.
      if (closed) {
        await Native.close();
        void listener.remove();
        return;
      }
      for (const e of early.splice(0)) handle(e);
    } catch {
      closed = true;
      void listener?.remove();
      handlers.onClosed(0);
    }
  })();
  return () => {
    if (closed) return;
    closed = true;
    void listener?.remove();
    void Native.close();
  };
};
