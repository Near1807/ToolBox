// Frontend of the Timer: its page, the sound of the transitions (Background,
// mounted for the whole session), its panels of the floating window
// (Floating.tsx) and the home widget (session in progress, or quick start).
import { Link } from 'react-router';
import { api, Button, defineFrontendModule, useApi, useModule } from '@hub/sdk/frontend';
import { clock, phaseLabel } from '../shared/plan';
import type { StateDto } from '../shared/types';
import { useLiveSession } from './live';
import { playSound } from './sound';
import { Overlay } from './Floating';
import { TimerPage } from './TimerPage';
import './timer.css';

/** Plays the sound of each transition (once, from the main window). */
function Background() {
  useLiveSession((event) => playSound(event.sound, event.volume));
  return null;
}

function HomeWidget() {
  const module = useModule();
  const { session, state } = useLiveSession();
  const data = useApi<StateDto>(module.url('/state'));
  if (session && state) {
    return (
      <p className="tm-widget">
        <Link to={module.path()}>
          {session.status === 'ended'
            ? `${session.name} : terminé`
            : `${phaseLabel(session.status, state.phase)} · ${clock(state.remaining)}`}
        </Link>
        {session.taskTitle && <span className="small muted"> · {session.taskTitle}</span>}
      </p>
    );
  }
  const start = (body: object) =>
    void api.post(module.url('/start'), body).catch(() => {
      // The page says why (e.g. a timer already running).
    });
  return (
    <div className="tm-widget tm-actions">
      {[15, 25, 45].map((m) => (
        <Button
          key={m}
          small
          variant="secondary"
          onClick={() => start({ config: { mode: 'simple', workMin: m } })}
        >
          {m} min
        </Button>
      ))}
      {data.data?.presets.slice(0, 2).map((p) => (
        <Button
          key={p.id}
          small
          variant="secondary"
          onClick={() => start({ config: p.config, name: p.name })}
        >
          {p.name}
        </Button>
      ))}
    </div>
  );
}

export default defineFrontendModule({
  pages: [{ path: '', component: TimerPage }],
  HomeWidget,
  Background,
  Overlay,
});
