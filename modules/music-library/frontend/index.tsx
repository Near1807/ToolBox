// Frontend of music-library: library grid, track page, home widget.
import { defineFrontendModule, formatDuration, useApi, useModule } from '@hub/sdk/frontend';
import { LibraryPage } from './LibraryPage';
import { TrackPage } from './TrackPage';
import './library.css';

function HomeWidget() {
  const module = useModule();
  const summary = useApi<{ count: number; totalDurationSec: number }>(module.url('/summary'));
  if (!summary.data) return null;
  const { count, totalDurationSec } = summary.data;
  return (
    <span className="muted">
      {count === 0
        ? 'Aucun morceau pour l’instant'
        : `${count} morceau${count > 1 ? 'x' : ''} · ${formatDuration(totalDurationSec)}`}
    </span>
  );
}

export default defineFrontendModule({
  pages: [
    { path: '', component: LibraryPage },
    { path: 'tracks/:trackId', component: TrackPage },
  ],
  HomeWidget,
});
