// Frontend of youtube-stats: the statistics page (4 levels + théories + données)
// and a home widget.
import { defineFrontendModule, useApi, useModule } from '@hub/sdk/frontend';
import { fmtInt } from './charts';
import { StatsPage } from './StatsPage';
import type { OverviewData } from './types';
import './stats.css';

function HomeWidget() {
  const module = useModule();
  const { data } = useApi<OverviewData>(module.url('/overview?period=28'));
  if (!data) return null;
  return (
    <div className="small">
      {data.mode === 'demo' && <p className="ys-demo-chip">DONNÉES DE DÉMO</p>}
      <p>
        <strong className="num">{fmtInt(data.key.subscribers)}</strong> abonnés ·{' '}
        <strong className="num">{fmtInt(data.key.views)}</strong> vues sur 28 jours
      </p>
      {data.highlights[0] && <p className="muted">{data.highlights[0].text}</p>}
    </div>
  );
}

export default defineFrontendModule({
  pages: [{ path: '', component: StatsPage }],
  nav: { label: 'Stats YouTube' },
  HomeWidget,
});
