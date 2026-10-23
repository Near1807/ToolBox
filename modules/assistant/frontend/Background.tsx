// Mounted once in the main window for the whole session: records when the
// backend says so (push-to-talk key, mic button) and plays the answer sentence
// by sentence as soon as each one is synthesised.
import { useEffect } from 'react';
import { errorMessage, openEventStream, useModule } from '@hub/sdk/frontend';
import type { SpeechEvent, StateEvent, TurnDto } from '../shared';
import { live } from './live';
import { Recorder } from './recorder';

export function Background() {
  const module = useModule();
  const { api } = module;
  const url = module.url('/events');

  useEffect(() => {
    const recorder = new Recorder();
    const queue: SpeechEvent[] = [];
    let playing: HTMLAudioElement | null = null;
    let ended: { turnId: number; count: number } | null = null;
    let played = 0;
    let currentTurn: number | null = null;

    const finishIfDone = () => {
      if (playing || queue.length > 0 || !ended) return;
      if (played >= ended.count) {
        void api.post('/speech/done', { turnId: ended.turnId }).catch(() => {});
        ended = null;
      }
    };
    const playNext = () => {
      if (playing) return;
      const next = queue.shift();
      if (!next) return finishIfDone();
      const audio = new Audio(next.url);
      playing = audio;
      const done = () => {
        if (playing !== audio) return;
        playing = null;
        if (next.turnId === currentTurn) played++;
        playNext();
      };
      audio.onended = done;
      audio.onerror = done;
      void audio.play().catch(done);
    };
    const stopAudio = () => {
      queue.length = 0;
      playing?.pause();
      playing = null;
      ended = null;
    };

    const close = openEventStream(url, {
      state: (data) => {
        live.state = data as StateEvent;
        live.emit();
      },
      turn: (data) => {
        const turn = data as TurnDto;
        live.turns.set(turn.id, turn);
        live.emit();
      },
      record: (data) => {
        const { action } = data as { action: 'start' | 'stop' | 'cancel' };
        if (action === 'start') {
          stopAudio();
          live.micError = null;
          recorder.start().catch((error: unknown) => {
            live.micError = `Micro indisponible : ${errorMessage(error)}`;
            live.emit();
            void api.post('/listen/cancel').catch(() => {});
          });
        } else if (action === 'cancel') {
          void recorder.cancel();
        } else if (recorder.active) {
          void recorder
            .stop()
            .then(({ audio }) => api.post('/turn/audio', { audio }))
            .catch((error: unknown) => {
              live.micError = errorMessage(error);
              live.emit();
            });
        }
      },
      speech: (data) => {
        const speech = data as SpeechEvent;
        if (speech.turnId !== currentTurn) {
          currentTurn = speech.turnId;
          played = 0;
        }
        queue.push(speech);
        playNext();
      },
      'speech-end': (data) => {
        ended = data as { turnId: number; count: number };
        finishIfDone();
      },
      'speech-stop': () => stopAudio(),
    });
    return () => {
      close();
      stopAudio();
      void recorder.cancel();
    };
  }, [api, url]);

  return null;
}
